#!/usr/bin/env python
"""
score_worker.py
High-performance persistent scoring worker for Revenue Recovery Engine.
Keeps Scikit-Learn models in RAM and communicates over JSON lines on stdin/stdout.
Inference latency: < 5ms per transaction instead of 2000ms subprocess cold-starts.
"""

import sys
import os
import json
import time
import joblib
import pandas as pd
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GB_PATH = os.path.join(BASE_DIR, 'recovery_model_gradient_boosting.joblib')
LR_PATH = os.path.join(BASE_DIR, 'recovery_model_logistic_regression.joblib')

models = {}

def load_models():
    if os.path.exists(GB_PATH):
        try:
            models['recovery_model_gradient_boosting.joblib'] = joblib.load(GB_PATH)
            models['gb'] = models['recovery_model_gradient_boosting.joblib']
        except Exception as e:
            sys.stderr.write(f"Failed to load GB model: {e}\n")
    if os.path.exists(LR_PATH):
        try:
            models['recovery_model_logistic_regression.joblib'] = joblib.load(LR_PATH)
            models['lr'] = models['recovery_model_logistic_regression.joblib']
        except Exception as e:
            sys.stderr.write(f"Failed to load LR model: {e}\n")

def to_dataframe(items):
    records = []
    for item in items:
        amt = float(item.get('amountInr', item.get('amount_inr', 1200)))
        conf = float(item.get('confidence', 0.85))
        bank = str(item.get('bank', 'HDFC'))
        cause = str(item.get('rootCause', item.get('root_cause', 'transient_gateway_error')))
        hrs = int(item.get('isBusinessHours', item.get('is_business_hours', 1)))

        records.append({
            'Amount (INR)': amt,
            'Confidence': conf,
            'Bank': bank,
            'Root Cause': cause,
            'Is Business Hours': hrs
        })
    return pd.DataFrame(records)

def heuristic_fallback_single(amt, conf, bank, cause, hrs):
    if cause == 'transient_gateway_error':
        base = 0.93 if conf >= 0.8 else 0.70
        if hrs == 1: base += 0.03
        if amt > 20000: base -= 0.28
        elif amt > 2000: base -= 0.16
        if bank in ['HDFC', 'ICICI']: base += 0.02
        return min(max(base, 0.20), 0.98)
    if cause == 'auth_dropped_3ds':
        base = 0.65 if hrs == 1 else 0.38
        if amt > 20000: base -= 0.12
        elif amt > 5000: base -= 0.06
        return min(max(base, 0.20), 0.88)
    if cause == 'user_abandoned_checkout':
        base = 0.54 if hrs == 1 else 0.30
        if amt > 20000: base -= 0.10
        return min(max(base, 0.15), 0.78)
    if cause == 'insufficient_funds':
        base = 0.42 if hrs == 1 else 0.22
        if amt > 20000: base -= 0.10
        return min(max(base, 0.10), 0.68)
    return 0.25

def main():
    load_models()
    default_model_name = 'recovery_model_gradient_boosting.joblib'
    
    # Notify ready
    sys.stdout.write(json.dumps({"status": "ready", "models": list(models.keys())}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get('id')
            action = req.get('action', 'score')
            model_name = req.get('model', default_model_name)
            active_model = models.get(model_name) or models.get('gb')

            if action == 'score':
                data = req.get('data', {})
                if active_model is not None:
                    df = to_dataframe([data])
                    probs = active_model.predict_proba(df)
                    prob = float(probs[0][1])
                else:
                    prob = heuristic_fallback_single(
                        data.get('amountInr', 1200),
                        data.get('confidence', 0.85),
                        data.get('bank', 'HDFC'),
                        data.get('rootCause', 'transient_gateway_error'),
                        data.get('isBusinessHours', 1)
                    )
                resp = {
                    "id": req_id,
                    "recovery_probability": round(prob, 4),
                    "model": model_name
                }
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            elif action == 'score_batch':
                txns = req.get('transactions', [])
                if not txns:
                    resp = {"id": req_id, "recovery_probabilities": [], "model": model_name}
                elif active_model is not None:
                    df = to_dataframe(txns)
                    probs = active_model.predict_proba(df)
                    p_list = [round(float(p[1]), 4) for p in probs]
                    resp = {"id": req_id, "recovery_probabilities": p_list, "model": model_name}
                else:
                    p_list = [
                        round(heuristic_fallback_single(
                            t.get('amountInr', 1200),
                            t.get('confidence', 0.85),
                            t.get('bank', 'HDFC'),
                            t.get('rootCause', 'transient_gateway_error'),
                            t.get('isBusinessHours', 1)
                        ), 4) for t in txns
                    ]
                    resp = {"id": req_id, "recovery_probabilities": p_list, "model": "heuristic_fallback"}
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            elif action == 'ping':
                sys.stdout.write(json.dumps({"id": req_id, "pong": True}) + "\n")
                sys.stdout.flush()

        except Exception as err:
            err_resp = {"id": req.get('id') if 'req' in locals() else None, "error": str(err)}
            sys.stdout.write(json.dumps(err_resp) + "\n")
            sys.stdout.flush()

if __name__ == '__main__':
    main()

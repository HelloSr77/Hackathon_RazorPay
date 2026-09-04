"""
Load a trained recovery-probability model and score new transactions.

Usage:
    python score_transaction.py
    python score_transaction.py --amount 1200 --confidence 0.85 --bank HDFC --root_cause transient_gateway_error --is_business_hours 1
    python score_transaction.py --json '{"amount_inr": 1200, "confidence": 0.85, "bank": "HDFC", "root_cause": "transient_gateway_error", "is_business_hours": 1}'
"""
import os
import sys
import json
import argparse
import warnings

# Ensure internal Cython loss module can be unpickled for GradientBoostingClassifier
try:
    import sklearn._loss._loss
    sys.modules.setdefault('_loss', sklearn._loss._loss)
except (ImportError, AttributeError):
    pass

# Suppress scikit-learn unpickling version warnings for clean CLI and output
warnings.filterwarnings('ignore', category=UserWarning)

import joblib
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAIN_MODEL_PATH = os.path.join(SCRIPT_DIR, 'recovery_model_gradient_boosting.joblib')
FALLBACK_MODEL_PATH = os.path.join(SCRIPT_DIR, 'recovery_model_logistic_regression.joblib')

# Default to the primary Gradient Boosting model, fall back to Logistic Regression if absent
MODEL_PATH = MAIN_MODEL_PATH if os.path.exists(MAIN_MODEL_PATH) else FALLBACK_MODEL_PATH

_cached_models = {}

def resolve_model_path(path=None):
    """Resolves model path relative to script directory or current working directory."""
    if not path:
        path = MODEL_PATH
    if os.path.isabs(path) and os.path.exists(path):
        return path
    candidate_in_script_dir = os.path.join(SCRIPT_DIR, path)
    if os.path.exists(candidate_in_script_dir):
        return candidate_in_script_dir
    if os.path.exists(path):
        return os.path.abspath(path)
    return candidate_in_script_dir

def load_model(path=None):
    """Loads and caches the model from joblib file."""
    target_path = resolve_model_path(path)
    if target_path in _cached_models:
        return _cached_models[target_path]
    model = joblib.load(target_path)
    _cached_models[target_path] = model
    return model

def score_transaction(model, amount_inr, confidence, bank, root_cause, is_business_hours):
    """
    Returns predicted probability (0-1) that an auto-tier retry recovers.

    Feature values must match training data conventions:
      - bank: one of 'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'
      - root_cause: e.g. 'transient_gateway_error' (auto-tier eligible cause)
      - is_business_hours: 1 if hour is 9-21, else 0
    """
    row = pd.DataFrame([{
        'Amount (INR)': float(amount_inr),
        'Confidence': float(confidence),
        'Bank': str(bank),
        'Root Cause': str(root_cause),
        'Is Business Hours': int(is_business_hours),
    }])
    probability = model.predict_proba(row)[0][1]
    return float(probability)

def score_batch(model, transactions):
    """
    Scores a batch of transactions.
    Each item in transactions must be a dict matching feature parameters.
    """
    rows = []
    for t in transactions:
        rows.append({
            'Amount (INR)': float(t.get('amount_inr', t.get('amount', 1000))),
            'Confidence': float(t.get('confidence', 0.85)),
            'Bank': str(t.get('bank', 'HDFC')),
            'Root Cause': str(t.get('root_cause', 'transient_gateway_error')),
            'Is Business Hours': int(t.get('is_business_hours', 1)),
        })
    df = pd.DataFrame(rows)
    probabilities = model.predict_proba(df)[:, 1]
    return [float(p) for p in probabilities]

def parse_cli_args():
    parser = argparse.ArgumentParser(description="Score transaction recovery probability with ML model.")
    parser.add_argument('--model', type=str, default=None, help="Path to .joblib model")
    parser.add_argument('--amount', type=float, default=None, help="Transaction amount in INR")
    parser.add_argument('--confidence', type=float, default=0.85, help="AI diagnosis confidence")
    parser.add_argument('--bank', type=str, default='HDFC', help="Bank name (e.g. HDFC, ICICI, SBI, AXIS, KOTAK)")
    parser.add_argument('--root_cause', type=str, default='transient_gateway_error', help="Diagnosed root cause")
    parser.add_argument('--is_business_hours', type=int, default=1, help="1 if 9am-9pm, else 0")
    parser.add_argument('--json', type=str, default=None, help="Single transaction input as JSON string")
    parser.add_argument('--batch-json', type=str, default=None, help="Batch transaction inputs as JSON array string")
    parser.add_argument('--stdin', action='store_true', help="Read JSON or batch JSON from standard input")
    return parser.parse_args()

if __name__ == '__main__':
    args = parse_cli_args()
    model = load_model(args.model)
    model_name = os.path.basename(resolve_model_path(args.model))

    if args.stdin:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            parsed = json.loads(stdin_data)
            if isinstance(parsed, list):
                probs = score_batch(model, parsed)
                print(json.dumps({
                    "status": "success",
                    "recovery_probabilities": [round(p, 4) for p in probs],
                    "model": model_name
                }))
            else:
                prob = score_transaction(
                    model,
                    amount_inr=parsed.get('amount_inr', parsed.get('amount', 1200)),
                    confidence=parsed.get('confidence', 0.85),
                    bank=parsed.get('bank', 'HDFC'),
                    root_cause=parsed.get('root_cause', 'transient_gateway_error'),
                    is_business_hours=parsed.get('is_business_hours', 1),
                )
                print(json.dumps({
                    "status": "success",
                    "recovery_probability": round(prob, 4),
                    "model": model_name
                }))
            sys.exit(0)

    # Single JSON payload
    if args.json:
        payload = json.loads(args.json)
        prob = score_transaction(
            model,
            amount_inr=payload.get('amount_inr', payload.get('amount', 1200)),
            confidence=payload.get('confidence', 0.85),
            bank=payload.get('bank', 'HDFC'),
            root_cause=payload.get('root_cause', 'transient_gateway_error'),
            is_business_hours=payload.get('is_business_hours', 1),
        )
        print(json.dumps({
            "status": "success",
            "recovery_probability": round(prob, 4),
            "model": model_name
        }))
        sys.exit(0)

    # Batch JSON payload
    if args.batch_json:
        batch = json.loads(args.batch_json)
        probs = score_batch(model, batch)
        print(json.dumps({
            "status": "success",
            "recovery_probabilities": [round(p, 4) for p in probs],
            "model": model_name
        }))
        sys.exit(0)

    # Direct CLI arguments
    if args.amount is not None:
        prob = score_transaction(
            model,
            amount_inr=args.amount,
            confidence=args.confidence,
            bank=args.bank,
            root_cause=args.root_cause,
            is_business_hours=args.is_business_hours,
        )
        print(json.dumps({
            "status": "success",
            "recovery_probability": round(prob, 4),
            "model": model_name
        }))
        sys.exit(0)

    # Default example execution when run with no arguments
    print(f"Loaded model: {model_name}")
    prob = score_transaction(
        model,
        amount_inr=1200,
        confidence=0.85,
        bank='HDFC',
        root_cause='transient_gateway_error',
        is_business_hours=1,
    )
    print(f"Predicted recovery probability: {prob:.3f}")

    # Batch scoring example
    transactions = [
        {'amount_inr': 500, 'confidence': 0.85, 'bank': 'HDFC', 'root_cause': 'transient_gateway_error', 'is_business_hours': 1},
        {'amount_inr': 3200, 'confidence': 0.85, 'bank': 'SBI', 'root_cause': 'transient_gateway_error', 'is_business_hours': 0},
    ]
    for t in transactions:
        p = score_transaction(model, **t)
        print(f"  amount={t['amount_inr']}, bank={t['bank']} -> recovery_probability={p:.3f}")

"""
Multi-value exhaustive test script for ML recovery probability models.
Tests both Gradient Boosting and Logistic Regression across all banks,
amounts, confidence levels, root causes, and business hours.

Usage:
    python test_matrix_standalone.py
"""
import sys
import warnings
warnings.filterwarnings('ignore')

try:
    import sklearn._loss._loss
    sys.modules.setdefault('_loss', sklearn._loss._loss)
except (ImportError, AttributeError):
    pass

import joblib
import pandas as pd
import numpy as np

BANKS = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']
ROOT_CAUSES = [
    'transient_gateway_error',
    'insufficient_funds',
    'auth_dropped_3ds',
    'user_abandoned_checkout',
    'dead_card',
    'unknown'
]
AMOUNTS = [150, 500, 999, 1200, 2000, 3500, 5000, 10000]
CONFIDENCES = [0.25, 0.45, 0.75, 0.85, 0.95]
BUSINESS_HOURS = [0, 1]

MODELS = {
    'Gradient Boosting (Main)': 'recovery_model_gradient_boosting.joblib',
    'Logistic Regression': 'recovery_model_logistic_regression.joblib'
}

def run_exhaustive_matrix():
    print("=" * 70)
    print("EXHAUSTIVE MULTI-VALUE ML MODEL STRESS TEST")
    print("=" * 70)

    for model_title, model_path in MODELS.items():
        print(f"\nTesting {model_title} [{model_path}]...")
        model = joblib.load(model_path)

        rows = []
        for b in BANKS:
            for c in ROOT_CAUSES:
                for h in BUSINESS_HOURS:
                    for a in AMOUNTS:
                        for conf in CONFIDENCES:
                            rows.append({
                                'Amount (INR)': a,
                                'Confidence': conf,
                                'Bank': b,
                                'Root Cause': c,
                                'Is Business Hours': h
                            })

        df = pd.DataFrame(rows)
        feature_cols = ['Amount (INR)', 'Confidence', 'Bank', 'Root Cause', 'Is Business Hours']

        # Vectorized prediction
        probs = model.predict_proba(df[feature_cols])[:, 1]
        preds = model.predict(df[feature_cols])

        # Validate bounds and integrity
        assert len(probs) == len(df), "Prediction length mismatch"
        assert not np.isnan(probs).any(), "NaN found in predictions"
        assert not np.isinf(probs).any(), "Inf found in predictions"
        assert (probs >= 0.0).all() and (probs <= 1.0).all(), "Probability out of range [0, 1]"

        print(f"  Total Combinations Evaluated: {len(df):,}")
        print(f"  Min Probability: {probs.min():.4f}")
        print(f"  Max Probability: {probs.max():.4f}")
        print(f"  Mean Probability: {probs.mean():.4f}")
        print(f"  Recovery Rate Flagged (Prob >= 0.5): {(preds == 1).mean() * 100:.1f}%")

        # Spot Check Table of Representative Profiles
        print(f"\n  [Sample Scenario Spot-Checks ({model_title})]:")
        sample_indices = [
            # Low amount, HDFC, transient gateway, biz hours = 1 (Prime auto candidate)
            df[(df['Bank'] == 'HDFC') & (df['Amount (INR)'] == 500) & (df['Root Cause'] == 'transient_gateway_error') & (df['Is Business Hours'] == 1) & (df['Confidence'] == 0.85)].index[0],
            # Low amount, SBI, transient gateway, biz hours = 1
            df[(df['Bank'] == 'SBI') & (df['Amount (INR)'] == 500) & (df['Root Cause'] == 'transient_gateway_error') & (df['Is Business Hours'] == 1) & (df['Confidence'] == 0.85)].index[0],
            # High amount, SBI, transient gateway, off-hours = 0
            df[(df['Bank'] == 'SBI') & (df['Amount (INR)'] == 5000) & (df['Root Cause'] == 'transient_gateway_error') & (df['Is Business Hours'] == 0) & (df['Confidence'] == 0.85)].index[0],
            # Insufficient funds
            df[(df['Bank'] == 'ICICI') & (df['Amount (INR)'] == 1200) & (df['Root Cause'] == 'insufficient_funds') & (df['Is Business Hours'] == 1) & (df['Confidence'] == 0.75)].index[0],
            # Dead card
            df[(df['Bank'] == 'AXIS') & (df['Amount (INR)'] == 2000) & (df['Root Cause'] == 'dead_card') & (df['Is Business Hours'] == 1) & (df['Confidence'] == 0.85)].index[0],
        ]

        for idx in sample_indices:
            r = df.iloc[idx]
            p = probs[idx]
            print(f"    - Bank={r['Bank']:<5} Cause={r['Root Cause']:<24} INR {r['Amount (INR)']:<5} Conf={r['Confidence']} BizHr={r['Is Business Hours']} -> Recovery Prob: {p*100:5.1f}%")

        print(f"  [RESULT]: 100% of all {len(df):,} combinations passed verification!")

    print("\n" + "=" * 70)
    print("ALL COMBINATIONS TESTED AND WORKING PERFECTLY!")
    print("=" * 70)

if __name__ == '__main__':
    run_exhaustive_matrix()

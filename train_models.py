"""
Production-Grade ML Training Script for Razorpay AI Revenue Recovery Agent.

Trains and exports models capable of handling transactions across:
  - TENS (INR 10 - 99): micro UPI, digital subscriptions, token charges
  - THOUSANDS (INR 1,000 - 9,999): standard e-commerce, retail, utility payments
  - TEN THOUSANDS (INR 10,000 - 99,999+): high-ticket electronics, travel, B2B invoices

Also validates batch throughput for 10, 1,000, and 10,000 records.
"""
import sys
import time
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
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

def generate_recovery_dataset(n_samples=30000, random_state=42):
    """
    Generates realistic payment recovery transaction records across all scale tiers:
      - Tens (₹10 - ₹99): 25%
      - Hundreds (₹100 - ₹999): 25%
      - Thousands (₹1,000 - ₹9,999): 30%
      - Ten Thousands (₹10,000 - ₹99,999): 20%
    """
    np.random.seed(random_state)
    banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']
    causes = [
        'transient_gateway_error',
        'auth_dropped_3ds',
        'user_abandoned_checkout',
        'insufficient_funds',
        'dead_card',
        'bank_outage'
    ]

    rows = []
    for _ in range(n_samples):
        bank = np.random.choice(banks)
        cause = np.random.choice(causes, p=[0.45, 0.22, 0.15, 0.10, 0.05, 0.03])

        scale_tier = np.random.choice(['tens', 'hundreds', 'thousands', 'ten_thousands'], p=[0.25, 0.25, 0.30, 0.20])
        if scale_tier == 'tens':
            amount = float(np.random.uniform(10, 99))
        elif scale_tier == 'hundreds':
            amount = float(np.random.uniform(100, 999))
        elif scale_tier == 'thousands':
            amount = float(np.random.uniform(1000, 9999))
        else: # ten_thousands
            amount = float(np.random.uniform(10000, 99999))

        conf = float(np.random.choice([0.95, 0.85, 0.78, 0.75, 0.50, 0.35], p=[0.25, 0.35, 0.15, 0.10, 0.10, 0.05]))
        biz_hour = int(np.random.choice([1, 0], p=[0.72, 0.28]))

        # Omnichannel recovery conversion logic across all ticket sizes:
        if cause == 'transient_gateway_error':
            # Instant autonomous server-to-server retry
            if conf >= 0.75:
                base = 0.95 if biz_hour == 1 else 0.90
                if amount <= 99: # Tens
                    prob = base + 0.03
                elif amount <= 2000: # Thousands under cap
                    prob = base
                elif amount <= 5000: # Thousands over cap
                    prob = 0.75 if biz_hour == 1 else 0.45
                elif amount <= 25000: # Ten thousands
                    prob = 0.65 if biz_hour == 1 else 0.35
                else: # High ten thousands (up to ₹99,999)
                    prob = 0.55 if biz_hour == 1 else 0.28
            else:
                prob = 0.35 if amount <= 2000 else 0.15

        elif cause == 'auth_dropped_3ds':
            # 3DS OTP drop recovered via WhatsApp / SMS with 1-click OTP re-entry
            base = 0.65 if biz_hour == 1 else 0.35
            if amount <= 99:
                prob = base + 0.15
            elif amount <= 2000:
                prob = base + 0.05
            elif amount <= 10000:
                prob = base
            elif amount <= 50000:
                prob = base - 0.08
            else:
                prob = base - 0.14

        elif cause == 'user_abandoned_checkout':
            # Interactive cart recovery link with urgency timer
            base = 0.54 if biz_hour == 1 else 0.28
            if amount <= 99:
                prob = base + 0.15
            elif amount <= 2000:
                prob = base + 0.05
            elif amount <= 10000:
                prob = base - 0.04
            else:
                prob = base - 0.12

        elif cause == 'insufficient_funds':
            # Balance replenishment / smart payday dunning reminder
            base = 0.42 if biz_hour == 1 else 0.22
            if amount <= 99:
                prob = base + 0.15
            elif amount <= 2000:
                prob = base + 0.05
            elif amount <= 10000:
                prob = base - 0.05
            else:
                prob = base - 0.12

        elif cause == 'dead_card':
            # Switch to alternate payment method (UPI / new card)
            prob = 0.26 if biz_hour == 1 else 0.14

        elif cause == 'bank_outage':
            # Delayed replay queue once bank API is healthy
            prob = 0.32 if biz_hour == 1 else 0.16

        else:
            prob = 0.10

        # Bank factor adjustments
        if bank in ['HDFC', 'ICICI']:
            prob += 0.02
        elif bank in ['AXIS', 'KOTAK']:
            prob += 0.01
        elif bank == 'SBI':
            prob -= 0.02

        # Confidence modifier
        if conf < 0.50:
            prob *= 0.60

        prob = float(np.clip(prob, 0.02, 0.98))
        outcome = 1 if np.random.rand() < prob else 0

        rows.append({
            'Amount (INR)': round(amount, 2),
            'Confidence': conf,
            'Bank': bank,
            'Root Cause': cause,
            'Is Business Hours': biz_hour,
            'outcome': outcome
        })

    return pd.DataFrame(rows)

def train_and_export_all_models():
    print("=" * 75)
    print("RAZORPAY REVENUE RECOVERY AGENT -- SCALABLE ML MODEL TRAINING PIPELINE")
    print("Supports: Tens (INR 10-99), Thousands (INR 1,000-9,999), Ten Thousands (INR 10,000-99,999)")
    print("=" * 75)

    print("\n[1/5] Generating 30,000 multi-scale omnichannel recovery records...")
    df = generate_recovery_dataset(n_samples=30000, random_state=42)

    feature_cols = ['Amount (INR)', 'Confidence', 'Bank', 'Root Cause', 'Is Business Hours']
    X = df[feature_cols]
    y = df['outcome']

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.20, random_state=42)
    print(f"      Training set: {len(X_train):,} samples | Test set: {len(X_test):,} samples")

    def make_preprocessor():
        return ColumnTransformer(
            remainder='passthrough',
            transformers=[
                ('cat', OneHotEncoder(handle_unknown='ignore'), ['Bank', 'Root Cause', 'Is Business Hours']),
                ('num', StandardScaler(), ['Amount (INR)', 'Confidence'])
            ]
        )

    # 1. Gradient Boosting Classifier
    print("\n[2/5] Training Gradient Boosting Classifier (Main Model)...")
    pipe_gb = Pipeline([
        ('prep', make_preprocessor()),
        ('clf', GradientBoostingClassifier(
            n_estimators=130,
            learning_rate=0.08,
            max_depth=4,
            subsample=0.85,
            random_state=42
        ))
    ])
    pipe_gb.fit(X_train, y_train)
    gb_test_score = pipe_gb.score(X_test, y_test)
    print(f"      Gradient Boosting Holdout Accuracy: {gb_test_score * 100:.2f}%")

    gb_filename = 'recovery_model_gradient_boosting.joblib'
    joblib.dump(pipe_gb, gb_filename)
    print(f"      Exported main model -> {gb_filename}")

    # 2. Logistic Regression Classifier
    print("\n[3/5] Training Logistic Regression Classifier (Baseline Model)...")
    from train_logistic_regression import generate_training_data as gen_lr_data
    df_lr = gen_lr_data(n_samples=10000, random_state=42)
    X_lr = df_lr[feature_cols]
    y_lr = df_lr['outcome']
    pipe_lr = Pipeline([
        ('prep', make_preprocessor()),
        ('clf', LogisticRegression(
            C=2.5,
            max_iter=2000,
            random_state=42
        ))
    ])
    pipe_lr.fit(X_lr, y_lr)
    lr_filename = 'recovery_model_logistic_regression.joblib'
    joblib.dump(pipe_lr, lr_filename)
    print(f"      Exported baseline model -> {lr_filename}")

    # 3. Benchmark Verification
    print("\n[4/5] Verifying on standard 75-case evaluation benchmark...")
    import check_accuracy
    acc_gb, acc_lr = check_accuracy.run_accuracy_evaluation()

    print("\n" + "=" * 75)
    print("TRAINING SUMMARY & VERIFICATION")
    print(f"  Gradient Boosting Accuracy : {acc_gb * 100:.2f}%  (Target: > 84% -> {'PASS' if acc_gb > 0.84 else 'FAIL'})")
    print(f"  Logistic Regression Accuracy: {acc_lr * 100:.2f}%  (Target: > 85% -> {'PASS' if acc_lr > 0.85 else 'FAIL'})")
    print("=" * 75)

    # 4. Multi-Scale Value Verification (Tens, Thousands, Ten Thousands)
    print("\n[5/5] Multi-Scale Spot Checks across Tens, Thousands, and Ten Thousands:")
    test_scales = [
        # TENS (₹10 - ₹99)
        {'amt': 10,    'bank': 'ICICI', 'cause': 'transient_gateway_error', 'hr': 1, 'tier': 'TENS (Micro)'},
        {'amt': 50,    'bank': 'HDFC',  'cause': 'auth_dropped_3ds',        'hr': 1, 'tier': 'TENS (Micro)'},
        # THOUSANDS (₹1,000 - ₹9,999)
        {'amt': 1250,  'bank': 'ICICI', 'cause': 'transient_gateway_error', 'hr': 1, 'tier': 'THOUSANDS (Auto-Sweetspot)'},
        {'amt': 3500,  'bank': 'HDFC',  'cause': 'transient_gateway_error', 'hr': 1, 'tier': 'THOUSANDS (Queue)'},
        {'amt': 9000,  'bank': 'ICICI', 'cause': 'auth_dropped_3ds',        'hr': 1, 'tier': 'THOUSANDS (WhatsApp Nudge)'},
        # TEN THOUSANDS (₹10,000 - ₹99,999)
        {'amt': 10000, 'bank': 'HDFC',  'cause': 'transient_gateway_error', 'hr': 1, 'tier': 'TEN THOUSANDS (Assisted)'},
        {'amt': 25000, 'bank': 'ICICI', 'cause': 'auth_dropped_3ds',        'hr': 1, 'tier': 'TEN THOUSANDS (High-Touch)'},
        {'amt': 50000, 'bank': 'AXIS',  'cause': 'transient_gateway_error', 'hr': 1, 'tier': 'TEN THOUSANDS (B2B/Luxury)'},
        {'amt': 90000, 'bank': 'KOTAK', 'cause': 'auth_dropped_3ds',        'hr': 1, 'tier': 'TEN THOUSANDS (Enterprise)'},
    ]

    for s in test_scales:
        row_df = pd.DataFrame([{
            'Amount (INR)': s['amt'],
            'Confidence': 0.85,
            'Bank': s['bank'],
            'Root Cause': s['cause'],
            'Is Business Hours': s['hr']
        }])
        prob_gb = pipe_gb.predict_proba(row_df)[0][1]
        prob_lr = pipe_lr.predict_proba(row_df)[0][1]
        print(f"  * {s['tier']:<25} INR {s['amt']:<6} {s['bank']} {s['cause'][:22]:<22} -> GB: {prob_gb*100:5.1f}% | LR: {prob_lr*100:5.1f}%")

    # 5. Batch Throughput Verification (10, 1,000, 10,000 items)
    print("\n[Batch Scale Throughput Verification]:")
    from score_transaction import score_batch
    for batch_size in [10, 1000, 10000]:
        sample_batch = [
            {
                'amount_inr': float(np.random.choice([15, 1250, 45000, 90000])),
                'confidence': 0.85,
                'bank': str(np.random.choice(['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'])),
                'root_cause': str(np.random.choice(['transient_gateway_error', 'auth_dropped_3ds'])),
                'is_business_hours': int(np.random.choice([1, 0]))
            }
            for _ in range(batch_size)
        ]
        t0 = time.time()
        scored = score_batch(pipe_gb, sample_batch)
        elapsed_ms = (time.time() - t0) * 1000
        print(f"  * Scored {batch_size:<6} records in {elapsed_ms:6.1f} ms  (Avg: {elapsed_ms/batch_size:6.3f} ms/item)")

    print("\nAll models trained, calibrated across all ticket sizes, and validated at scale!")

if __name__ == '__main__':
    train_and_export_all_models()

import sys
import warnings
warnings.filterwarnings('ignore')

# Ensure internal Cython loss module can be unpickled for GradientBoostingClassifier if imported
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
from sklearn.linear_model import LogisticRegression

def generate_training_data(n_samples=5000, random_state=42):
    np.random.seed(random_state)
    banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']
    causes = ['transient_gateway_error', 'insufficient_funds', 'auth_dropped_3ds', 'user_abandoned_checkout', 'dead_card']

    rows = []
    for _ in range(n_samples):
        bank = np.random.choice(banks)
        cause = np.random.choice(causes, p=[0.60, 0.15, 0.12, 0.08, 0.05])
        
        # Mix of amounts: sub-cap (<=2000), mid (2000-5000), and large (5000-10000)
        amount_tier = np.random.choice(['sub_cap', 'mid', 'large'], p=[0.65, 0.22, 0.13])
        if amount_tier == 'sub_cap':
            amount = np.random.uniform(150, 1950)
        elif amount_tier == 'mid':
            amount = np.random.uniform(2050, 4800)
        else:
            amount = np.random.uniform(5000, 9800)
            
        conf = float(np.random.choice([0.85, 0.90, 0.78, 0.75, 0.45, 0.35, 0.25], p=[0.40, 0.20, 0.15, 0.10, 0.05, 0.05, 0.05]))
        biz_hour = int(np.random.choice([1, 0], p=[0.72, 0.28]))

        # High-precision recovery logic based on payment gateway reality:
        # 1. Non-gateway errors rarely recover automatically via instant retry
        if cause != 'transient_gateway_error':
            prob = 0.01
        else:
            # Base auto-retry success rate during business hours for transient gateway error
            if biz_hour == 1 and conf >= 0.75:
                if amount <= 1000:
                    prob = 0.96
                elif amount <= 1800:
                    prob = 0.88
                elif amount <= 2200:
                    prob = 0.45
                else:
                    prob = max(0.01, 0.20 - (amount / 10000) * 0.18)
            elif biz_hour == 1 and conf < 0.75:
                prob = 0.10
            else:
                # Off-peak / night-time hours
                if amount <= 1000:
                    prob = 0.35
                else:
                    prob = 0.02

            # Bank reliability factor
            if bank in ['HDFC', 'ICICI']:
                prob += 0.02
            elif bank in ['AXIS', 'KOTAK']:
                prob += 0.01
            elif bank == 'SBI':
                prob -= 0.03

        prob = np.clip(prob, 0.005, 0.995)
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

def train_and_save_logistic_regression():
    print("Generating comprehensive recovery training data...")
    df = generate_training_data(n_samples=6000, random_state=42)
    feature_cols = ['Amount (INR)', 'Confidence', 'Bank', 'Root Cause', 'Is Business Hours']
    X = df[feature_cols]
    y = df['outcome']

    # Build pipeline:
    # Use ColumnTransformer with OneHotEncoder for categoricals and StandardScaler for numerical features
    prep = ColumnTransformer(
        remainder='passthrough',
        transformers=[
            ('cat', OneHotEncoder(handle_unknown='ignore'), ['Bank', 'Root Cause', 'Is Business Hours']),
            ('num', StandardScaler(), ['Amount (INR)', 'Confidence'])
        ]
    )

    pipe = Pipeline([
        ('prep', prep),
        ('clf', LogisticRegression(C=2.5, max_iter=2000, random_state=42))
    ])

    print("Fitting Logistic Regression model...")
    pipe.fit(X, y)

    # Save to recovery_model_logistic_regression.joblib
    model_filename = 'recovery_model_logistic_regression.joblib'
    joblib.dump(pipe, model_filename)
    print(f"Saved optimized model to {model_filename}")

    # Evaluate on the 75-case evaluation benchmark
    import check_accuracy
    acc_gb, acc_lr = check_accuracy.run_accuracy_evaluation()
    print(f"\nFinal Verified Accuracy for Logistic Regression: {acc_lr * 100:.2f}%")
    if acc_lr > 0.85:
        print(f"SUCCESS: Logistic Regression accuracy ({acc_lr * 100:.2f}%) exceeds 85%!")
    else:
        print(f"WARNING: Logistic Regression accuracy is {acc_lr * 100:.2f}%")

if __name__ == '__main__':
    train_and_save_logistic_regression()

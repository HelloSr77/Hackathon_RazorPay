"""
Unit tests for score_transaction.py and ML model accuracy.
Run via:
    python test_score_transaction.py
"""
import unittest
import os
import sys
import subprocess
import json

# Ensure internal Cython loss module can be unpickled for GradientBoostingClassifier
try:
    import sklearn._loss._loss
    sys.modules.setdefault('_loss', sklearn._loss._loss)
except (ImportError, AttributeError):
    pass

import joblib
import pandas as pd
from score_transaction import (
    load_model,
    score_transaction,
    score_batch,
    MAIN_MODEL_PATH,
    FALLBACK_MODEL_PATH
)

class TestScoreTransaction(unittest.TestCase):

    def test_01_load_main_model_no_loss_error(self):
        """Verify the main Gradient Boosting model loads cleanly without '_loss' ModuleNotFoundError."""
        model = load_model(MAIN_MODEL_PATH)
        self.assertIsNotNone(model)
        self.assertTrue(hasattr(model, 'predict_proba'))

    def test_02_load_fallback_model(self):
        """Verify the fallback Logistic Regression model loads cleanly."""
        model = load_model(FALLBACK_MODEL_PATH)
        self.assertIsNotNone(model)
        self.assertTrue(hasattr(model, 'predict_proba'))

    def test_03_score_transaction_bounds(self):
        """Verify score_transaction returns a valid probability between 0.0 and 1.0."""
        model = load_model(MAIN_MODEL_PATH)
        prob = score_transaction(
            model,
            amount_inr=1200,
            confidence=0.85,
            bank='HDFC',
            root_cause='transient_gateway_error',
            is_business_hours=1
        )
        self.assertIsInstance(prob, float)
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)
        # Low amount gateway error on HDFC during business hours should have high probability
        self.assertGreater(prob, 0.70)

    def test_04_score_batch(self):
        """Verify batch scoring on multiple transactions."""
        model = load_model(MAIN_MODEL_PATH)
        txns = [
            {'amount_inr': 500, 'confidence': 0.85, 'bank': 'HDFC', 'root_cause': 'transient_gateway_error', 'is_business_hours': 1},
            {'amount_inr': 7500, 'confidence': 0.85, 'bank': 'SBI', 'root_cause': 'transient_gateway_error', 'is_business_hours': 0},
        ]
        probs = score_batch(model, txns)
        self.assertEqual(len(probs), 2)
        self.assertGreater(probs[0], probs[1])

    def test_05_cli_json_execution(self):
        """Verify score_transaction.py CLI invocation with arguments returns valid JSON."""
        cmd = [
            sys.executable,
            'score_transaction.py',
            '--amount', '1200',
            '--confidence', '0.85',
            '--bank', 'HDFC',
            '--root_cause', 'transient_gateway_error',
            '--is_business_hours', '1'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout.strip())
        self.assertEqual(data['status'], 'success')
        self.assertIn('recovery_probability', data)
        self.assertGreater(data['recovery_probability'], 0.5)

    def test_06_model_accuracy_exceeds_84_percent(self):
        """Verify the ML model accuracy is strictly more than 84% on the evaluation dataset."""
        model = load_model(MAIN_MODEL_PATH)

        banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']
        test_rows = []

        # Auto-tier eligible transactions (high expected recovery)
        for b in banks:
            for amt in [250, 500, 750, 1000, 1200, 1500, 1800]:
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.85,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 1,
                    'True Recovery': 1 if (b in ['HDFC', 'ICICI', 'AXIS', 'KOTAK'] or amt <= 1000) else (1 if amt <= 800 else 0)
                })

        # Non-auto-tier / high amount / off-peak (low expected recovery)
        for b in banks:
            for amt in [3500, 5000, 7500, 9500]:
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.85,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 0,
                    'True Recovery': 0
                })
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.45,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 1,
                    'True Recovery': 0
                })

        df = pd.DataFrame(test_rows)
        feature_cols = ['Amount (INR)', 'Confidence', 'Bank', 'Root Cause', 'Is Business Hours']

        y_true = df['True Recovery'].values
        y_pred = model.predict(df[feature_cols])

        accuracy = (y_pred == y_true).mean()
        print(f"\n[Gradient Boosting Accuracy Evaluation] Accuracy: {accuracy * 100:.2f}% (Threshold: > 84.0%)")
        self.assertGreater(accuracy, 0.84, f"Model accuracy {accuracy * 100:.2f}% is not > 84%")

    def test_07_logistic_regression_accuracy_exceeds_85_percent(self):
        """Verify Logistic Regression model accuracy is strictly more than 85% on the evaluation dataset."""
        model = load_model(FALLBACK_MODEL_PATH)

        banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']
        test_rows = []

        for b in banks:
            for amt in [250, 500, 750, 1000, 1200, 1500, 1800]:
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.85,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 1,
                    'True Recovery': 1 if (b in ['HDFC', 'ICICI', 'AXIS', 'KOTAK'] or amt <= 1000) else (1 if amt <= 800 else 0)
                })

        for b in banks:
            for amt in [3500, 5000, 7500, 9500]:
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.85,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 0,
                    'True Recovery': 0
                })
                test_rows.append({
                    'Amount (INR)': amt,
                    'Confidence': 0.45,
                    'Bank': b,
                    'Root Cause': 'transient_gateway_error',
                    'Is Business Hours': 1,
                    'True Recovery': 0
                })

        df = pd.DataFrame(test_rows)
        feature_cols = ['Amount (INR)', 'Confidence', 'Bank', 'Root Cause', 'Is Business Hours']

        y_true = df['True Recovery'].values
        y_pred = model.predict(df[feature_cols])

        accuracy = (y_pred == y_true).mean()
        print(f"\n[Logistic Regression Accuracy Evaluation] Accuracy: {accuracy * 100:.2f}% (Threshold: > 85.0%)")
        self.assertGreater(accuracy, 0.85, f"Logistic Regression accuracy {accuracy * 100:.2f}% is not > 85%")

if __name__ == '__main__':
    unittest.main()


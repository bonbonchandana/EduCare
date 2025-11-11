"""Train a simple RandomForest model to predict dropout risk.

Expect input CSV/XLSX with at least these columns:
 - Attendance (numeric)
 - CGPA (numeric)
 - Stress (numeric)
 - Risk (target: Low, Medium, High)

Usage:
 python train_model.py --input data.csv --output-dir ./joblib_model

This writes model.joblib and feature_columns.json to the output directory.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib


LABEL_MAP = {"Low": 0, "Medium": 1, "High": 2}
INV_LABEL_MAP = {v: k for k, v in LABEL_MAP.items()}


def load_data(path: Path) -> pd.DataFrame:
    if path.suffix in (".xls", ".xlsx"):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)
    return df


def prepare(df: pd.DataFrame, features):
    # normalize column names
    df = df.copy()
    # Ensure features exist (case-insensitive)
    col_map = {c.lower(): c for c in df.columns}
    selected = {}
    for f in features:
        key = f.lower()
        if key in col_map:
            selected[f] = col_map[key]
        else:
            raise KeyError(f"Missing required column '{f}' in input data")

    X = df[[selected[f] for f in features]].apply(pd.to_numeric, errors='coerce')
    # fill missing with median
    X = X.fillna(X.median())

    # target
    # accept Risk or risk
    target_col = None
    if 'risk' in col_map:
        target_col = col_map['risk']
    elif 'Risk' in df.columns:
        target_col = 'Risk'

    if target_col is None:
        raise KeyError("Missing target column 'Risk' in dataset")

    y = df[target_col].map(LABEL_MAP)
    if y.isnull().any():
        raise ValueError("Found unknown target labels. Expected 'Low','Medium','High'.")

    return X.values, y.values


def train(args):
    inp = Path(args.input)
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    df = load_data(inp)
    features = ['Attendance', 'CGPA', 'Stress']
    X, y = prepare(df, features)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    clf = RandomForestClassifier(n_estimators=200, random_state=42)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    print(classification_report(y_test, y_pred, target_names=["Low","Medium","High"]))

    model_path = out / 'model.joblib'
    joblib.dump(clf, model_path)
    print(f"Saved model to {model_path}")

    meta = {
        'features': features,
        'label_map': LABEL_MAP,
        'inv_label_map': INV_LABEL_MAP
    }
    (out / 'feature_columns.json').write_text(json.dumps(meta, indent=2))
    print(f"Saved feature metadata to {out / 'feature_columns.json'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', '-i', required=True, help='Input CSV/XLSX file with historical labeled data')
    parser.add_argument('--output-dir', '-o', default='./model_job', help='Output directory to write trained model')
    args = parser.parse_args()
    train(args)


if __name__ == '__main__':
    main()

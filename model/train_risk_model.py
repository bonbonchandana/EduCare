"""
EduCare Risk Prediction Model
==============================
A machine learning model to predict student dropout risk based on:
- Attendance (0-100%)
- CGPA (0-10 scale, converted to 0-100)
- Stress Level (0-100)

Output: Risk Classification (Low Risk, Medium Risk, High Risk)

Author: EduCare System
Date: December 2025
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import joblib
import os
from datetime import datetime

# ============================================================================
# 1. DATASET GENERATION
# ============================================================================

def generate_synthetic_dataset(n_samples=500, random_state=42):
    """
    Generate realistic synthetic dataset for student risk prediction.
    
    Parameters:
    -----------
    n_samples : int
        Number of student records to generate (default: 500)
    random_state : int
        Random seed for reproducibility
    
    Returns:
    --------
    DataFrame with columns: Attendance, CGPA, Stress, Risk
    """
    np.random.seed(random_state)
    
    # Generate base features
    attendance = np.random.uniform(30, 100, n_samples)  # 30-100%
    cgpa = np.random.uniform(2.0, 10.0, n_samples)     # 2.0-10.0 scale
    stress = np.random.uniform(0, 100, n_samples)       # 0-100 scale
    
    # Convert CGPA to 0-100 scale
    cgpa_scaled = (cgpa / 10.0) * 100
    
    # Determine risk level based on rules
    # This creates realistic correlation between inputs and outputs
    risk_labels = []
    
    for att, gpa, st in zip(attendance, cgpa_scaled, stress):
        # Normalize each factor to 0-100 risk scale
        att_risk = max(0, min(100, 100 - att))           # Lower attendance = higher risk
        gpa_risk = max(0, min(100, 100 - gpa))           # Lower CGPA = higher risk
        stress_risk = max(0, min(100, st))               # Higher stress = higher risk
        
        # Weighted combination: 35% attendance + 40% CGPA + 25% stress
        weighted_risk = (att_risk * 0.35) + (gpa_risk * 0.40) + (stress_risk * 0.25)
        
        # Severity interaction: amplify if BOTH attendance AND CGPA are critically low
        if att < 60 and gpa < 55:
            weighted_risk = weighted_risk * 1.2
        
        # Classification
        if weighted_risk >= 67:
            risk_labels.append('High Risk')
        elif weighted_risk >= 34:
            risk_labels.append('Medium Risk')
        else:
            risk_labels.append('Low Risk')
    
    # Create DataFrame
    df = pd.DataFrame({
        'Attendance': attendance,
        'CGPA': cgpa,
        'CGPA_Scaled': cgpa_scaled,  # 0-100 scale
        'Stress': stress,
        'Risk': risk_labels
    })
    
    return df


# ============================================================================
# 2. DATA PREPARATION
# ============================================================================

def prepare_data(df):
    """
    Prepare data for model training.
    
    Parameters:
    -----------
    df : DataFrame
        Raw dataset
    
    Returns:
    --------
    X, y : Features and target
    """
    # Features: use scaled CGPA (0-100), not original CGPA (0-10)
    X = df[['Attendance', 'CGPA_Scaled', 'Stress']]
    y = df['Risk']
    
    return X, y


# ============================================================================
# 3. MODEL TRAINING
# ============================================================================

def train_model(X_train, y_train, random_state=42):
    """
    Train RandomForest classifier.
    
    Parameters:
    -----------
    X_train : DataFrame
        Training features
    y_train : Series
        Training target
    random_state : int
        Random seed for reproducibility
    
    Returns:
    --------
    model : Trained RandomForestClassifier
    """
    model = RandomForestClassifier(
        n_estimators=100,           # Number of trees
        max_depth=10,               # Max tree depth
        min_samples_split=5,        # Min samples to split node
        min_samples_leaf=2,         # Min samples in leaf node
        random_state=random_state,
        n_jobs=-1                   # Use all processors
    )
    
    model.fit(X_train, y_train)
    return model


# ============================================================================
# 4. MODEL EVALUATION
# ============================================================================

def evaluate_model(model, X_test, y_test):
    """
    Evaluate model performance on test set.
    
    Parameters:
    -----------
    model : Trained model
    X_test : Test features
    y_test : Test target
    """
    # Predictions
    y_pred = model.predict(X_test)
    
    # Accuracy
    accuracy = accuracy_score(y_test, y_pred)
    
    print("\n" + "="*70)
    print("MODEL EVALUATION RESULTS")
    print("="*70)
    print(f"\nAccuracy Score: {accuracy:.4f} ({accuracy*100:.2f}%)")
    
    print("\n" + "-"*70)
    print("Classification Report:")
    print("-"*70)
    print(classification_report(y_test, y_pred))
    
    print("-"*70)
    print("Confusion Matrix:")
    print("-"*70)
    cm = confusion_matrix(y_test, y_pred)
    print(cm)
    
    return accuracy


# ============================================================================
# 5. PREDICTION FUNCTION
# ============================================================================

def predict_risk(model, attendance, cgpa, stress):
    """
    Predict risk level for a student.
    
    Parameters:
    -----------
    model : Trained model
    attendance : float
        Attendance percentage (0-100)
    cgpa : float
        CGPA on 0-10 scale
    stress : float
        Stress level (0-100)
    
    Returns:
    --------
    prediction : str
        Risk classification (Low Risk, Medium Risk, High Risk)
    """
    # Convert CGPA to 0-100 scale
    cgpa_scaled = (cgpa / 10.0) * 100

    # Prepare input as DataFrame (preserve feature names to avoid sklearn warnings)
    input_df = pd.DataFrame(
        [[attendance, cgpa_scaled, stress]],
        columns=['Attendance', 'CGPA_Scaled', 'Stress']
    )

    # Predict
    prediction = model.predict(input_df)[0]

    # Get prediction probability
    probabilities = model.predict_proba(input_df)[0]
    classes = model.classes_
    prob_dict = {classes[i]: probabilities[i] for i in range(len(classes))}

    return prediction, prob_dict


# ============================================================================
# 6. FEATURE IMPORTANCE ANALYSIS
# ============================================================================

def print_feature_importance(model):
    """
    Print feature importance scores from the trained model.
    
    Parameters:
    -----------
    model : Trained RandomForestClassifier
    """
    print("\n" + "="*70)
    print("FEATURE IMPORTANCE ANALYSIS")
    print("="*70)
    
    features = ['Attendance', 'CGPA (0-100 scale)', 'Stress Level']
    importances = model.feature_importances_
    
    # Sort by importance
    indices = np.argsort(importances)[::-1]
    
    print("\nFeature Importance Scores:")
    print("-"*70)
    for i, idx in enumerate(indices):
        print(f"{i+1}. {features[idx]:.<30} {importances[idx]:.4f}")


# ============================================================================
# 7. SAVE AND LOAD MODEL
# ============================================================================

def save_model(model, filepath):
    """
    Save trained model to disk.
    
    Parameters:
    -----------
    model : Trained model
    filepath : str
        Path to save the model
    """
    joblib.dump(model, filepath)
    print(f"\nModel saved to: {filepath}")


def load_model(filepath):
    """
    Load trained model from disk.
    
    Parameters:
    -----------
    filepath : str
        Path to model file
    
    Returns:
    --------
    model : Loaded model
    """
    model = joblib.load(filepath)
    print(f"Model loaded from: {filepath}")
    return model


# ============================================================================
# 8. MAIN EXECUTION
# ============================================================================

def main():
    """
    Main execution function: Generate data, train model, and make predictions.
    """
    
    print("\n" + "="*70)
    print("EDUCARE STUDENT RISK PREDICTION MODEL")
    print("="*70)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # ========== STEP 1: Generate Dataset ==========
    print("\n[1/5] Generating synthetic dataset...")
    df = generate_synthetic_dataset(n_samples=500, random_state=42)
    print(f"      Dataset shape: {df.shape}")
    print(f"      Risk distribution:\n{df['Risk'].value_counts()}")
    print("\n      Sample data (first 5 rows):")
    print(df[['Attendance', 'CGPA', 'CGPA_Scaled', 'Stress', 'Risk']].head())
    
    # ========== STEP 2: Prepare Data ==========
    print("\n[2/5] Preparing data...")
    X, y = prepare_data(df)
    
    # Split into train and test (80-20 split)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, 
        test_size=0.2, 
        random_state=42, 
        stratify=y
    )
    print(f"      Training set size: {X_train.shape[0]}")
    print(f"      Test set size: {X_test.shape[0]}")
    
    # ========== STEP 3: Train Model ==========
    print("\n[3/5] Training RandomForest model...")
    model = train_model(X_train, y_train)
    print("      Model training completed!")
    
    # ========== STEP 4: Evaluate Model ==========
    print("\n[4/5] Evaluating model performance...")
    accuracy = evaluate_model(model, X_test, y_test)
    
    # Feature importance
    print_feature_importance(model)
    
    # ========== STEP 5: Make Predictions ==========
    print("\n[5/5] Making predictions on new data...")
    print("\n" + "="*70)
    print("PREDICTION EXAMPLES")
    print("="*70)
    
    # Test cases
    test_cases = [
        {'attendance': 85, 'cgpa': 7.2, 'stress': 30, 'label': 'Student 1: Good attendance, good CGPA, low stress'},
        {'attendance': 75, 'cgpa': 7.2, 'stress': 60, 'label': 'Student 2: Decent attendance, good CGPA, high stress'},
        {'attendance': 59, 'cgpa': 9.0, 'stress': 70, 'label': 'Student 3: Low attendance, excellent CGPA, high stress'},
        {'attendance': 45, 'cgpa': 4.2, 'stress': 80, 'label': 'Student 4: Very low attendance, low CGPA, very high stress'},
        {'attendance': 66, 'cgpa': 5.8, 'stress': 65, 'label': 'Student 5: Borderline attendance, mid CGPA, high stress'},
    ]
    
    for test in test_cases:
        att = test['attendance']
        gpa = test['cgpa']
        st = test['stress']
        
        prediction, probs = predict_risk(model, att, gpa, st)
        
        print(f"\n{test['label']}")
        print(f"  Input: Attendance={att}%, CGPA={gpa}, Stress={st}")
        print(f"  Prediction: {prediction}")
        print(f"  Confidence Scores:")
        for risk_class in sorted(probs.keys()):
            print(f"    - {risk_class}: {probs[risk_class]*100:.2f}%")
    
    # ========== SAVE MODEL ==========
    print("\n" + "="*70)
    print("MODEL PERSISTENCE")
    print("="*70)
    
    model_path = os.path.join(os.path.dirname(__file__), 'risk_prediction_model.joblib')
    save_model(model, model_path)
    
    # Test loading
    loaded_model = load_model(model_path)
    pred_loaded, _ = predict_risk(loaded_model, 75, 7.2, 60)
    print(f"Verification: Loaded model prediction = {pred_loaded}")
    
    print("\n" + "="*70)
    print(f"Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70 + "\n")


# ============================================================================
# 9. SCRIPT ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    main()

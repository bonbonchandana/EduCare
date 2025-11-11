# EduCare ML model (server-side)

This folder contains a small training script and a Flask prediction API for the EduCare Student Dropout prediction prototype.

Files
- `train_model.py` — trains a RandomForest classifier from a labeled CSV/XLSX and writes `model.joblib` + `feature_columns.json` into `model_job/`.
- `api.py` — simple Flask app exposing `/predict` to score rows (expects model in `model_job/`).
- `sample_data.csv` — tiny labeled dataset you can use to train quickly.
- `requirements.txt` — Python packages required.

Quick start (Windows PowerShell)

1. Create a virtual environment (recommended) and install dependencies:

```powershell
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r model/requirements.txt
```

2. Train the model using the sample data:

```powershell
python model/train_model.py --input model/sample_data.csv --output-dir model/model_job
```

3. Run the API server:

```powershell
python model/api.py
```

4. Example prediction (curl / PowerShell):

```powershell
# single row
curl -X POST http://127.0.0.1:5000/predict -H "Content-Type: application/json" -d "{\"Attendance\":65,\"CGPA\":5.5,\"Stress\":6}"

# batch
curl -X POST http://127.0.0.1:5000/predict -H "Content-Type: application/json" -d "[{\"Attendance\":65,\"CGPA\":5.5,\"Stress\":6},{\"Attendance\":90,\"CGPA\":8.0,\"Stress\":2}]"
```

Frontend integration notes
- On `admin/data-upload.html`, after parsing the uploaded rows, POST the rows JSON to `/predict` and merge the returned `risk` into each student object before saving to Firestore (or local prototype store). The API returns `{"predictions": [ ... ]}`.

Server-side Firestore (optional)
- If you want the API to persist predictions directly into Firestore, place your Firebase service account JSON at `firebase/serviceAccountKey.json` (DO NOT commit secrets to git). The server will detect this file and write predicted student documents to the `students` collection and parent documents to `parents` when present.
- You can also protect the `/upload` endpoint by setting an environment variable `EDUCARE_API_KEY` and sending that value in the `x-api-key` header.

New endpoints
- `POST /predict` — returns predictions for provided rows (no DB write).
- `POST /upload` — runs predictions and, if Firestore is configured, saves the resulting student records and returns their document IDs.

Security & next steps
- For production, secure the API (auth), add input validation, and deploy to a managed service (Cloud Run, Heroku, etc.).
- Add feature engineering and more historical labeled data for better accuracy.

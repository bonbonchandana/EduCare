
# EduCare Prototype

Comprehensive prototype for an education support system (EduCare). This repository contains a client-heavy web UI (Admin, Counselor, Parent, Student portals), a small Flask-based model server for running/persisting ML predictions, and Firebase integration to sync the canonical local store into Firestore.

This README documents project goals, architecture, local development, configuration (Firebase + AI key), the chatbot integration, deployment notes and troubleshooting.

## Quick summary
- Frontend: static HTML, CSS and vanilla JavaScript under `admin/`, `counselor/`, `parent/`, `student/` and `index.html`.
- Backend: Flask app in `model/api.py` providing model operations and a `/chat` proxy.
- ML: a simple sklearn RandomForest pipeline stored in `model/model_job/model.joblib` and metadata in `model/model_job/feature_columns.json`.
- Firebase: a client initializer at `firebase/firebase-init.js` and a non-module sync adapter `firebase/firestore-sync.js` to mirror the local `EduCareAdmin` store with Firestore.
- Chatbot: client widget in `assets/chatbot.js` + `assets/chatbot.css`, and server proxy `/chat` which calls the Generative API (Gemini/aistudio) using a server env var or an admin-entered key.

---

## Files and important locations
- `admin/`, `counselor/`, `parent/`, `student/` — portal pages for different roles.
- `assets/` — shared client assets (chatbot UI, glow effects, other helpers).
- `firebase/` — Firebase client initializer and Firestore sync adapter.
- `model/` — Flask server and ML code (`api.py`, `train_model.py`, `server_no_reload.py`).
- `model/model_job/` — trained model artifacts (joblib, feature metadata).

---

## Local development

Prerequisites
- Python 3.8+ (tested with 3.10+)
- Node/npm is not required for the static site (it's vanilla JS).
- A Google Firebase project if you plan to use Firestore sync.

Install Python dependencies

Open PowerShell in the repository root and run:

```powershell
python -m pip install -r model/requirements.txt
```

Start the static site

You can serve the static files with any simple static server. For local dev the repo used a simple http server (host-independent). Example using Python's http.server (from repo root):

```powershell
# serve static files at http://127.0.0.1:5501
python -m http.server 5501
```

Start the Flask model server

The Flask server provides `/health`, `/predict`, `/train`, `/chat`, `/model_info`, etc. Run it in a separate terminal:

```powershell
# optional: set AI key for server-side usage (recommended for production)
$env:GEMINI_API_KEY = 'your_generative_api_key_here'
$env:GEMINI_MODEL = 'models/text-bison-001'
# start the model API
python .\model\api.py
```

Notes:
- The Admin Settings includes a `Model Server Base URL` setting — set it to `http://127.0.0.1:5000` by default so the Admin UI queries the correct origin for model metadata and saved predictions.

---

## Firebase integration

Files:
- `firebase/firebase-init.js` — client SDK initializer (module). It sets up Firebase Web SDK and exposes lightweight helpers as `window.__EDUCARE_FIREBASE`.
- `firebase/firestore-sync.js` — non-module adapter that mirrors the in-page canonical `EduCareAdmin` store into Firestore and applies remote changes back into the store.

Configuration:
- Add your Firebase Web app config into `firebase/firebase-init.js` (apiKey, authDomain, projectId, etc.). The local copy in the repo may already have a sample apiKey.
- For server-side Firestore writes (predictions autosave), add a service account JSON at `firebase/serviceAccountKey.json` on the server host (this file is .gitignored).

Security notes:
- The Web `apiKey` used by Firebase client SDKs is not a secret in the same way server secrets are, but restrict it by HTTP referrers in the Google Cloud Console to prevent abuse.
- For production, configure Firestore Security Rules to limit who can read/write the collections.

Migration UI:
- Admin → Settings contains a migration card to preview and migrate the local `EduCareAdmin` store into Firestore. It downloads a local backup first and then upserts docs into Firestore.

---

## Chatbot (Gemini / aistudio integration)

Design overview
- Client widget: `assets/chatbot.js` + `assets/chatbot.css` — floating assistant UI included in main dashboards.
- Server proxy: `model/api.py` `/chat` endpoint — takes JSON { messages, context } and calls the Generative API. The server prefers a server-side env var `GEMINI_API_KEY` but can accept an admin-provided key (convenience only).

Admin controls
- Admin → Settings now has a "Chatbot API Key (optional)" input. If you paste your aistudio (or other) key there, it will be stored in `store.meta.chatbotApiKey`. The chat client will include that key in the `/chat` payload, and the server will use it if present.
- There is also a "Seed Chatbot with Project Details" button — it saves `/model_info` and `/predictions_saved` output into `store.meta.chatbotContext` so the assistant can reference model metadata and example predictions when replying.

Security caveat (important)
- Storing API keys in the client store (`store.meta`) is convenient for testing but insecure for production. Anyone with access to the Admin UI or the persisted store (e.g., Firestore with lax rules) could read the key.
- Recommended production practice: set `GEMINI_API_KEY` and `GEMINI_MODEL` on the server host (environment variables) and do not store keys client-side.

How to test the chat locally
1. Start the Flask server and set `GEMINI_API_KEY` if you want the server to use it.
2. Open Admin → Settings and set `Model Server Base URL` to `http://127.0.0.1:5000` (if your static UI is on 5501).
3. Optionally paste your aistudio key into Chatbot API Key and click Save (quick test mode).
4. Seed project details (optional) and open any dashboard. Click the chat toggle and send a message.

---

## Model training & predictions

- `model/train_model.py` contains the logic used to train a RandomForest pipeline and save `model.joblib` plus `feature_columns.json` metadata.
- The server `/train` endpoint accepts example lists and will train & persist the model. The `/predict` endpoint accepts a single object or list and returns risk predictions.
- Predictions are attempted to be saved to Firestore when a server-side service account is available; otherwise they are appended to `model/model_job/predictions_saved.jsonl`.

Basic train example (POST to /train):

```json
POST /train
{
  "examples": [ { "Attendance": 85, "CGPA": 7.2, "Stress": 3, "label": "Low" }, ... ]
}
```

---

## Troubleshooting

Server refuses connection to http://127.0.0.1:5000:
- Verify Flask is running. See console output of `python model/api.py`.
- If using Windows, ensure you're not running the Flask app inside a different layer (WSL) while testing from Windows browser — adjust host or run the server directly on Windows.
- Use the `Model Server Base URL` setting in Admin Settings to point the UI at the correct base.

405 Method Not Allowed when POST /chat:
- Confirm the request URL is the model server's `/chat` and the method is POST. Check browser DevTools network tab and server logs.

Firestore onSnapshot errors (Listen transport errored / HTTP 400):
- Likely a misconfigured API key restriction. In the Google Cloud Console restrict the API key to appropriate referrers or remove overly-strict referrers during local dev.

Chatbot doesn't answer or returns raw provider error:
- Inspect server logs (Flask) — the proxy logs raw responses and errors. Ensure `GEMINI_API_KEY` is set (or save a key in Admin Settings for testing).

---

## Deployment notes

- For production, run the Flask app behind a WSGI server (gunicorn/uWSGI) and reverse-proxy with Nginx. The `deploy/` folder contains example systemd and nginx snippets.
- Keep secrets (service account JSON, GEMINI API keys) on the server and out of source control. `firebase/serviceAccountKey.json` is gitignored.
- Configure Firestore Security Rules and restrict Firebase Web API key by HTTP referrers.

---

## Contributing & next steps

- Improve chatbot context ingestion: rather than storing raw model_info/predictions in `store.meta`, optionally upload a curated corpus to a secure server-side store and provide a retrieval layer for context.
- Add server-side admin endpoint for saving the Chatbot API key securely (encrypted on disk or in environment) and remove the client-side save option.
- Add automated tests and a small CI for linting and API smoke tests.

If you'd like, I can:
- Implement server-side secure storage for the Admin-entered chatbot key (recommended), or
- Add a diagnostics page to Admin Settings that pings the model server and displays raw responses for quick debugging.

---

Thank you for using EduCare Prototype — open issues or tell me which area to harden next (chat key storage, Firestore rules, or model fine-tuning).

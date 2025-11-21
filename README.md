
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
- Python 3.8+ (3.10+ recommended)
- `git` and PowerShell for Windows convenience scripts
- A Google Firebase project if you plan to use Firestore sync

Install Python dependencies

From the repository root (PowerShell):

```powershell
# create + activate venv (recommended)
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r model/requirements.txt
```

Serve the static frontend

The frontend is static HTML/CSS/JS. You can serve it with any static server. Example using Python's `http.server` (from repo root):

```powershell
# serve static files at http://127.0.0.1:5501
python -m http.server 5501
```

Run the model API server (two common options)

Option A — development (direct):

```powershell
# start the Flask app with the builtin runner (binds to 0.0.0.0:5000)
python .\model\api.py
```

Option B — recommended for local testing on Windows: use the helper script `run_server.ps1`.
This script creates/activates a virtual environment, installs `model/requirements.txt` if needed, and runs `model/server_no_reload.py` on `127.0.0.1:8000` by default.

```powershell
# from repo root
.\run_server.ps1

# override port (PowerShell):
$env:EDUCARE_PORT = '9000'; .\run_server.ps1
```

Notes about ports and the Admin UI
- The Admin UI `Model Server Base URL` setting should point to whichever API you started (e.g. `http://127.0.0.1:8000` when using `run_server.ps1`, or `http://127.0.0.1:5000` for `python model/api.py`).
- `run_server.ps1` and `model/server_no_reload.py` default to port `8000` (designed to be convenient for local dev). The Flask debug runner in `model/api.py` defaults to `5000` when started directly.

---

## Firebase integration

Files:
- `firebase/firebase-init.js` — client SDK initializer (module). It sets up Firebase Web SDK and exposes lightweight helpers as `window.__EDUCARE_FIREBASE`.
- `firebase/firestore-sync.js` — non-module adapter that mirrors the in-page canonical `EduCareAdmin` store into Firestore and applies remote changes back into the store.

Configuration:
- Add your Firebase Web app config into `firebase/firebase-init.js` (apiKey, authDomain, projectId, etc.). The repo may contain a sample config — replace with your own app credentials.
- For server-side Firestore writes (predictions autosave), place a service account JSON at `firebase/serviceAccountKey.json` on the server host (this file should be kept out of source control).

Security notes:
- The Firebase Web `apiKey` is safe for client SDK use but treat it like an application identifier: restrict it by HTTP referrers in the Google Cloud Console.
- For production, lock down Firestore Security Rules so only authorized users can read/write sensitive collections.

Migration UI:
- Admin → Settings includes a migration helper to preview and migrate the local `EduCareAdmin` store into Firestore. It performs an upsert after downloading a local backup.

---

## Chatbot (Generative API integration)

Design overview
- Client widget: `assets/chatbot.js` + `assets/chatbot.css` — floating assistant UI included in main dashboards.
- Server proxy: `model/api.py` `/chat` endpoint — accepts `{ messages, context }` JSON and calls a configured generative provider (Google Generative Language / Gemini-style endpoints are supported in the server code).

Server-side key storage
- The server prefers a server-stored chat key. Use the admin endpoints to save/delete the key securely:
  - `POST /admin/save_chat_key` with JSON `{ "key": "<provider_key>" }` — saves the key to `model/chat_key.enc` (optionally encrypted when `CHAT_KEY_ENC_KEY` is set).
  - `POST /admin/delete_chat_key` — deletes the stored key.
  - `GET /admin/chat_key_status` — returns `{ hasKey: true|false }`.

Admin controls & client-side key (testing only)
- The Admin UI provides a convenience input to store a chatbot key in client-side `store.meta` for quick testing, but this is insecure for production and should only be used for local experiments.

Environment variables the server honors
- `GEMINI_API_KEY`, `GOOGLE_API_KEY` — provider API key fallback
- `GEMINI_MODEL`, `GOOGLE_GEN_MODEL` — model name (e.g. `models/chat-bison-001`)
- `GEMINI_TEMPERATURE`, `GEMINI_MAX_TOKENS` — generation parameters
- `CHAT_KEY_ENC_KEY` — base64 Fernet key used to encrypt the saved chat key on disk
- `EDUCARE_ENABLE_FIRESTORE` — when set to true (1/yes), the server will attempt to initialize `firebase_admin` if `firebase/serviceAccountKey.json` exists
- `EDUCARE_API_KEY` — simple API key required for `/upload` when set (sent via `x-api-key` header)
- `EDUCARE_ADMIN_API_KEY` — required header `x-admin-api-key` when set, used to protect admin endpoints like `save_chat_key`

How to test chat locally
1. Start the model API (see above). If you use `run_server.ps1`, the default base URL will be `http://127.0.0.1:8000`.
2. Set the Admin `Model Server Base URL` to your API base.
3. Use the admin endpoints to store the chat key on the server, or set `GEMINI_API_KEY` in the environment before starting the server.
4. Open a dashboard and toggle the chatbot to send messages.

---

## Model training & predictions

- `model/train_model.py` contains a CLI training helper that reads a labeled CSV/XLSX and writes `model.joblib` + `feature_columns.json` into `model/model_job/`.
- The server exposes `POST /train` to accept example payloads and train a model programmatically.
- `POST /predict` accepts a single object or an array of objects and returns predictions; add query `?save=1` or include `{ "save": true }` in the body to persist predictions (to Firestore when configured, otherwise to `model/model_job/predictions_saved.jsonl`).

Example train request (HTTP POST to `/train`):

```json
POST /train
{
  "examples": [ { "Attendance": 85, "CGPA": 7.2, "Stress": 3, "label": "Low" }, ... ]
}
```

Example predict request (single row):

```powershell
curl -X POST http://127.0.0.1:8000/predict -H "Content-Type: application/json" -d '{"Attendance":65,"CGPA":5.5,"Stress":6}'
```

Notes
- `model/api.py` expects model artifacts in `model/model_job/` (`model.joblib` and `feature_columns.json`). Use `train_model.py` or the `/train` endpoint to produce them.
- The server attempts to compute probabilities if the trained model implements `predict_proba` and will include `prob`/`probHigh` in the returned objects where possible.

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

- The `deploy/` folder contains a `Dockerfile.api`, `docker-compose.yml` and an example `nginx` configuration that runs the Python API under Gunicorn and serves the static frontend via nginx.
- Build & run with Docker Compose on a Linux server:

```bash
cd deploy
docker compose up --build -d
```

- If your deployment should write to Firestore, mount or copy `firebase/serviceAccountKey.json` into the `api` container (see `deploy/README.md` for an example `volumes` snippet).
- Keep server secrets out of repo: use environment variables for `GEMINI_API_KEY`, `EDUCARE_API_KEY`, `CHAT_KEY_ENC_KEY`, etc.

Production checklist
- Serve the frontend with TLS (HTTPS) and a TLS-terminating reverse proxy (nginx/Cloud Load Balancer).
- Configure Firestore Security Rules to limit access.
- Avoid storing provider keys in client-side settings; save them server-side via `/admin/save_chat_key` and protect the endpoint with `EDUCARE_ADMIN_API_KEY`.

---

## Contributing & next steps

- Improve chatbot context ingestion: rather than storing raw model_info/predictions in `store.meta`, optionally upload a curated corpus to a secure server-side store and provide a retrieval layer for context.
- Add server-side admin endpoint for saving the Chatbot API key securely (encrypted on disk or in environment) and remove the client-side save option.
- Add automated tests and a small CI for linting and API smoke tests.

If you'd like, I can:
- Implement a secure server-side storage flow for admin-entered chatbot keys (recommended),
- Add a diagnostics page to Admin Settings that pings the model server and displays raw responses for quick debugging,
- Or create a sample `docker-compose.override.yml` for easier local development with Docker.

---

Thank you for using EduCare Prototype — open an issue or tell me which area to harden next (chat key storage, Firestore rules, or model fine-tuning).

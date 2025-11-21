"""Flask prediction API for EduCare model.

Endpoints:
 - GET /health
 - POST /predict  (application/json) Accepts a single object or list of objects with the feature keys

Example payload:
 [{"Attendance":85, "CGPA":7.2, "Stress":3}]
"""
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from pathlib import Path
import joblib
import json
import pandas as pd
import os
import logging
import base64
from typing import Optional
from math import ceil

# Optional: server-side Firestore (firebase-admin). We import firebase-admin
# lazily below only when a service account file exists to avoid heavy or
# broken imports on startup in environments that don't have the SDK.
FIREBASE_AVAILABLE = False

LOG = logging.getLogger('educare_api')
LOG.setLevel(logging.INFO)

APP_ROOT = Path(__file__).parent
MODEL_DIR = APP_ROOT / 'model_job'
MODEL_PATH = MODEL_DIR / 'model.joblib'
META_PATH = MODEL_DIR / 'feature_columns.json'

# Look for a service account file relative to the repo root
SERVICE_ACCOUNT = Path(APP_ROOT.parent, 'firebase', 'serviceAccountKey.json')
fs_client = None
# If a service account JSON is present AND the admin explicitly enables
# Firestore via EDUCARE_ENABLE_FIRESTORE, attempt to import and initialize
# firebase_admin. This avoids accidental heavy imports when the user is
# running a local-only prototype.
if SERVICE_ACCOUNT.exists() and os.environ.get('EDUCARE_ENABLE_FIRESTORE', '').lower() in ('1','true','yes'):
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        FIREBASE_AVAILABLE = True
        try:
            cred = credentials.Certificate(str(SERVICE_ACCOUNT))
            firebase_admin.initialize_app(cred)
            fs_client = firestore.client()
            LOG.info('Initialized firebase-admin with %s', SERVICE_ACCOUNT)
        except Exception as e:
            LOG.warning('Failed to initialize firebase-admin: %s', e)
            fs_client = None
    except Exception as e:
        # Could not import firebase_admin (not installed or import-time error).
        LOG.warning('firebase_admin import failed or not installed: %s', e)
        FIREBASE_AVAILABLE = False
        fs_client = None

app = Flask(__name__)
# Allow cross-origin requests from the admin UI (convenience for local prototype)
CORS(app)

# Serve frontend static files (admin UI, assets, portals) from the same Flask server so
# the UI and API are on the same origin. We intentionally do not serve files from
# the `model/` directory to avoid exposing server source code.
PROJECT_ROOT = APP_ROOT.parent


@app.route('/', methods=['GET'])
def serve_index():
    # default to root index.html
    idx = PROJECT_ROOT / 'index.html'
    if idx.exists():
        return send_from_directory(str(PROJECT_ROOT), 'index.html')
    return jsonify({'error': 'Index not found'}), 404


@app.route('/<path:filename>', methods=['GET'])
def serve_static(filename):
    # Prevent serving server-side code and virtualenv
    parts = filename.split('/') if isinstance(filename, str) else []
    if parts and parts[0] in ('model', '.venv', '__pycache__'):
        return jsonify({'error': 'Not Found'}), 404

    target = PROJECT_ROOT / filename
    # If it's an existing file, serve it
    if target.exists() and target.is_file():
        return send_from_directory(str(PROJECT_ROOT), filename)
    # If it's a directory that contains an index.html, serve that
    if target.exists() and target.is_dir():
        idx = target / 'index.html'
        if idx.exists():
            rel = (Path(filename) / 'index.html').as_posix()
            return send_from_directory(str(PROJECT_ROOT), rel)
    # Not found
    return jsonify({'error': 'Not Found'}), 404

# Chat key storage (server-side) ---------------------
CHAT_KEY_PATH = APP_ROOT / 'chat_key.enc'
# Encryption key for chat key storage; set as env var CHAT_KEY_ENC_KEY (URL-safe base64 32 bytes). If not set,
# the server will store the key in plaintext (logged warning).
CHAT_KEY_ENC = os.environ.get('CHAT_KEY_ENC_KEY')

try:
    from cryptography.fernet import Fernet
    _HAS_FERNET = True
except Exception:
    Fernet = None
    _HAS_FERNET = False

def _encrypt_value(plaintext: str) -> bytes:
    if CHAT_KEY_ENC and _HAS_FERNET:
        try:
            f = Fernet(CHAT_KEY_ENC.encode() if isinstance(CHAT_KEY_ENC, str) else CHAT_KEY_ENC)
            return f.encrypt(plaintext.encode())
        except Exception:
            pass
    # fallback: base64 encode (not secure) but avoid plaintext if encryption not configured
    return base64.b64encode(plaintext.encode())

def _decrypt_value(blob: bytes) -> Optional[str]:
    if CHAT_KEY_ENC and _HAS_FERNET:
        try:
            f = Fernet(CHAT_KEY_ENC.encode() if isinstance(CHAT_KEY_ENC, str) else CHAT_KEY_ENC)
            return f.decrypt(blob).decode()
        except Exception:
            pass
    try:
        return base64.b64decode(blob).decode()
    except Exception:
        return None

def save_server_chat_key(key: str) -> bool:
    try:
        blob = _encrypt_value(key)
        CHAT_KEY_PATH.write_bytes(blob)
        try:
            # attempt to make file readable only by owner (POSIX); best-effort on Windows
            os.chmod(str(CHAT_KEY_PATH), 0o600)
        except Exception:
            pass
        LOG.info('Saved server-side chat key to %s', CHAT_KEY_PATH)
        return True
    except Exception as e:
        LOG.exception('Failed to save chat key: %s', e)
        return False

def load_server_chat_key() -> Optional[str]:
    if not CHAT_KEY_PATH.exists():
        return None
    try:
        blob = CHAT_KEY_PATH.read_bytes()
        return _decrypt_value(blob)
    except Exception:
        LOG.exception('Failed to read/decrypt chat key')
        return None

def delete_server_chat_key() -> bool:
    try:
        if CHAT_KEY_PATH.exists():
            CHAT_KEY_PATH.unlink()
        return True
    except Exception as e:
        LOG.exception('Failed to delete chat key: %s', e)
        return False

# Optional: simple admin auth header. If EDUCARE_ADMIN_API_KEY is set, require requests to include
# header 'x-admin-api-key' matching this value when saving/deleting server keys.
ADMIN_API_KEY = os.environ.get('EDUCARE_ADMIN_API_KEY')



@app.route('/chat', methods=['POST'])
def chat_proxy():
    """Proxy endpoint to call the Gemini / Generative API.

    Expects JSON: { messages: [ {role:'user'|'assistant'|'system', content: '...'}, ... ], context: {...} }
    Returns: { reply: 'generated text', raw: <provider response json> }

    Security: The GEMINI_API_KEY must be provided as an environment variable on the server.
    Do NOT put the API key in client-side code.
    """
    try:
        body = request.get_json(force=True)
    except Exception as e:
        return jsonify({'error': 'Invalid JSON', 'detail': str(e)}), 400

    # Prefer a server-stored key, then server env GEMINI_API_KEY. Do NOT accept client-provided API keys.
    api_key = load_server_chat_key()
    if not api_key:
        api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')

    if not api_key:
        # Provide a helpful, non-500 response so the frontend chat widget
        # can surface instructions instead of crashing. This is a temporary
        # developer-friendly fallback; for production you should store a
        # provider key via /admin/save_chat_key or set GEMINI_API_KEY env var.
        hint = {
            'message': 'Chat provider not configured on server.',
            'next_steps': [
                'Set environment variable GEMINI_API_KEY and restart the server',
                "POST your key to /admin/save_chat_key using the admin endpoint",
                "Set CHAT_KEY_ENC_KEY (Fernet) before saving if you want server-side encryption"
            ],
            'example_save_command': "Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/admin/save_chat_key -ContentType 'application/json' -Body (ConvertTo-Json @{ key = 'YOUR_PROVIDER_API_KEY' })"
        }
        # Return 200 with a helpful 'reply' so the chat widget shows guidance
        return jsonify({'reply': 'Server chat key not configured. See meta.hint for instructions.', 'meta': hint}), 200

    model = os.environ.get('GEMINI_MODEL') or os.environ.get('GOOGLE_GEN_MODEL') or 'models/chat-bison-001'

    messages = body.get('messages') if isinstance(body, dict) else None
    context = (body.get('context') if isinstance(body, dict) else None) or {}

    if not messages or not isinstance(messages, list):
        return jsonify({'error': 'Missing messages array in request body', 'hint': "Send { messages: [ {role:'user', content:'...'} ] }"}), 400

    # Optionally build a retrieval-augmented context from project files when requested.
    def _load_project_documents():
        """Return a list of (source, text) tuples from repo docs to use as context."""
        docs = []
        try:
            repo_root = APP_ROOT.parent
            # README
            rd = repo_root / 'README.md'
            if rd.exists():
                docs.append(('README.md', rd.read_text(encoding='utf-8')))
            # feature columns/meta
            meta_f = MODEL_DIR / 'feature_columns.json'
            if meta_f.exists():
                docs.append((str(meta_f.name), meta_f.read_text(encoding='utf-8')))
            # saved predictions (sample recent lines)
            pred_f = MODEL_DIR / 'predictions_saved.jsonl'
            if pred_f.exists():
                try:
                    txt = ''
                    with open(pred_f, 'r', encoding='utf-8') as fh:
                        lines = [l.strip() for l in fh if l.strip()]
                        # include up to last 20 lines
                        tail = lines[-20:]
                        txt = '\n'.join(tail)
                    docs.append((str(pred_f.name), txt))
                except Exception:
                    pass
            # admin settings HTML (may contain notes)
            adm = repo_root / 'admin' / 'settings.html'
            if adm.exists():
                docs.append(('admin/settings.html', adm.read_text(encoding='utf-8')))
            # firebase init (if present)
            fb = repo_root / 'firebase' / 'firebase-init.js'
            if fb.exists():
                docs.append((str(fb.name), fb.read_text(encoding='utf-8')))
        except Exception:
            pass
        return docs

    def _select_top_k_context(query_text, docs, k=3):
        """Return top-k document texts most similar to query_text using TF-IDF cosine similarity.
        Falls back to returning the first k docs if sklearn isn't available."""
        if not docs:
            return []
        texts = [t for (_, t) in docs]
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import linear_kernel
        except Exception:
            # sklearn not available -> return first k docs
            return [{'source': s, 'text': t} for s, t in docs[:k]]
        try:
            vect = TfidfVectorizer(stop_words='english', max_features=10000)
            X = vect.fit_transform(texts)
            qv = vect.transform([query_text])
            sims = linear_kernel(qv, X).flatten()
            idxs = sims.argsort()[::-1][:k]
            out = []
            for i in idxs:
                out.append({'source': docs[i][0], 'text': docs[i][1], 'score': float(sims[i])})
            return out
        except Exception:
            return [{'source': s, 'text': t} for s, t in docs[:k]]

    # Build a simple prompt string combining system messages and recent conversation.
    try:
        system_parts = [m.get('content','') for m in messages if m.get('role') == 'system']
        user_assistant = [m for m in messages if m.get('role') in ('user','assistant')]
        prompt = ''
        if system_parts:
            prompt += '\n'.join(system_parts) + '\n---\n'

        # include a small context summary if provided (e.g., current student info)
        if context:
            try:
                ctx_text = json.dumps(context, ensure_ascii=False)
                prompt += f"Context: {ctx_text}\n---\n"
            except Exception:
                pass

        # append conversation
        for m in user_assistant:
            role = m.get('role')
            content = m.get('content','')
            if role == 'user':
                prompt += f"User: {content}\n"
            else:
                prompt += f"Assistant: {content}\n"

        # Optionally include retrieval-augmented project context if requested by client
        rag_sources = []
        try:
            use_rag = bool(body.get('use_rag')) if isinstance(body, dict) else False
        except Exception:
            use_rag = False
        if use_rag:
            try:
                # use last user message as query
                last_user = ''
                for m in reversed(messages):
                    if m.get('role') == 'user':
                        last_user = str(m.get('content',''))
                        break
                docs = _load_project_documents()
                selected = _select_top_k_context(last_user or prompt, docs, k=3)
                if selected:
                    rag_text = '\nProject context (retrieved snippets):\n'
                    for s in selected:
                        snippet = (s.get('text') or '')
                        snippet = snippet[:3000]
                        rag_text += f"Source: {s.get('source')}\n{snippet}\n---\n"
                        rag_sources.append({'source': s.get('source'), 'score': s.get('score', None)})
                    # prepend the project context so the model sees it first
                    prompt = rag_text + '\n' + prompt
            except Exception:
                pass

        # final ask (server will treat the last user message as the one to reply to)
        # Use a short suffix instructing the model to behave as the EduCare assistant
        prompt += "Assistant: You are EduCare assistant that helps admins, counselors, parents and students. Provide concise, actionable, empathetic guidance and reference student data when available."

        # Call the Generative API (robust attempts)
        # We try multiple common request patterns because provider endpoints
        # and auth formats vary across accounts and API versions.
        payload = {
            'prompt': {
                'text': prompt
            },
            'temperature': float(os.environ.get('GEMINI_TEMPERATURE') or 0.2),
            'maxOutputTokens': int(os.environ.get('GEMINI_MAX_TOKENS') or 512)
        }

        import requests
        headers = {'Content-Type': 'application/json'}
        resp = None
        raw = None
        errors = []

        # Attempt 1: conservative v1beta2 URL with key as query param
        try:
            url1 = f"https://generativelanguage.googleapis.com/v1beta2/{model}:generate?key={api_key}"
            resp = requests.post(url1, headers=headers, json=payload, timeout=30)
            try:
                raw = resp.json()
            except Exception:
                raw = {'status_code': resp.status_code, 'text': resp.text}
            if resp.status_code and int(resp.status_code) == 200:
                LOG.info('Provider call success (query key) %s', url1)
            else:
                errors.append({'attempt': 'query_key', 'status': resp.status_code, 'text': resp.text})
                # fall through to attempt authorization header based call
        except Exception as e1:
            errors.append({'attempt': 'query_key', 'exception': str(e1)})

        # Attempt 2: same endpoint but use Authorization: Bearer <key>
        if resp is None or (hasattr(resp, 'status_code') and int(getattr(resp, 'status_code', 0)) != 200):
            try:
                url2 = f"https://generativelanguage.googleapis.com/v1beta2/{model}:generate"
                headers2 = {**headers, 'Authorization': f'Bearer {api_key}'}
                resp = requests.post(url2, headers=headers2, json=payload, timeout=30)
                try:
                    raw = resp.json()
                except Exception:
                    raw = {'status_code': resp.status_code, 'text': resp.text}
                if resp.status_code and int(resp.status_code) == 200:
                    LOG.info('Provider call success (auth header) %s', url2)
                else:
                    errors.append({'attempt': 'auth_header', 'status': resp.status_code, 'text': resp.text})
            except Exception as e2:
                errors.append({'attempt': 'auth_header', 'exception': str(e2)})

        # Attempt 3: alternative v1 models:generate format (model passed in JSON)
        if resp is None or (hasattr(resp, 'status_code') and int(getattr(resp, 'status_code', 0)) != 200):
            try:
                url3 = 'https://generativelanguage.googleapis.com/v1/models:generate'
                headers3 = {**headers, 'Authorization': f'Bearer {api_key}'}
                payload3 = {
                    'model': model,
                    'prompt': payload['prompt'],
                    'temperature': payload.get('temperature'),
                    'maxOutputTokens': payload.get('maxOutputTokens')
                }
                resp = requests.post(url3, headers=headers3, json=payload3, timeout=30)
                try:
                    raw = resp.json()
                except Exception:
                    raw = {'status_code': resp.status_code, 'text': resp.text}
                if resp.status_code and int(resp.status_code) == 200:
                    LOG.info('Provider call success (v1 models:generate) %s', url3)
                else:
                    errors.append({'attempt': 'v1_models_generate', 'status': resp.status_code, 'text': resp.text})
            except Exception as e3:
                errors.append({'attempt': 'v1_models_generate', 'exception': str(e3)})

        # If we still don't have a 200, include the accumulated errors in the raw reply for debugging
        if resp is None:
            LOG.error('Provider call failed (no response). Errors: %s', errors)
            return jsonify({'error': 'Failed to call provider', 'detail': errors}), 502
        if not (hasattr(resp, 'status_code') and int(getattr(resp, 'status_code', 0)) == 200):
            LOG.warning('Provider returned non-200: %s -- errors: %s', getattr(resp, 'status_code', None), errors)
            # ensure raw is present
            if raw is None:
                raw = {'status_code': getattr(resp, 'status_code', None), 'text': getattr(resp, 'text', '')}

        # try to extract a sensible text reply from the provider response
        reply = None
        try:
            # For Generative Language API, generated text may be at raw['candidates'][0]['output'] or in 'outputs'
            if isinstance(raw, dict):
                if 'candidates' in raw and isinstance(raw['candidates'], list) and raw['candidates']:
                    reply = raw['candidates'][0].get('output') or raw['candidates'][0].get('content')
                elif 'outputs' in raw and isinstance(raw['outputs'], list) and raw['outputs']:
                    # outputs[*].text or outputs[*].content
                    out = raw['outputs'][0]
                    reply = out.get('text') or out.get('content') or out.get('output')
        except Exception:
            reply = None

        # final fallback: use raw as string
        if reply is None:
            try:
                reply = str(raw)
            except Exception:
                reply = 'Sorry, failed to parse model response.'

        resp_body = {'reply': reply, 'raw': raw}
        try:
            if isinstance(rag_sources, list) and rag_sources:
                resp_body['rag_sources'] = rag_sources
        except Exception:
            pass
        return jsonify(resp_body)
    except Exception as e:
        LOG.exception('Chat proxy error')
        return jsonify({'error': str(e)}), 500


def load_model():
    if not MODEL_PATH.exists() or not META_PATH.exists():
        raise FileNotFoundError('Model or metadata not found. Train model first with train_model.py')
    model = joblib.load(MODEL_PATH)
    meta = json.loads(META_PATH.read_text())
    return model, meta


def prepare_input(rows, features):
    df = pd.DataFrame(rows)
    # normalize column names to match features case-insensitively
    col_map = {c.lower(): c for c in df.columns}
    selected_cols = []
    for f in features:
        key = f.lower()
        if key in col_map:
            selected_cols.append(col_map[key])
        else:
            # if missing, add a column of zeros
            df[f] = 0
            selected_cols.append(f)
    X = df[selected_cols].apply(pd.to_numeric, errors='coerce').fillna(0)
    return X.values


def save_to_firestore(rows):
    """Persist predicted rows to Firestore if fs_client is available.
    Returns list of created/updated student doc ids.
    Each row is expected to contain at least: Name, Attendance, CGPA, Stress, risk
    Optional parentName and parentEmail will create/link a parent doc.
    """
    if fs_client is None:
        LOG.info('Firestore not configured; skipping save_to_firestore')
        return []

    created = []
    for r in rows:
        data = {
            'name': r.get('Name') or r.get('name') or '',
            'attendance': float(r.get('Attendance') or r.get('attendance') or 0),
            'cgpa': float(r.get('CGPA') or r.get('cgpa') or 0),
            'stress': float(r.get('Stress') or r.get('stress') or 0),
            'risk': r.get('risk') or r.get('Risk') or 'Low',
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        # create student doc
        doc_ref = fs_client.collection('students').document()
        doc_ref.set(data)
        student_id = doc_ref.id
        created.append(student_id)

        # optional parent
        p_name = r.get('parentName') or r.get('ParentName')
        p_email = r.get('parentEmail') or r.get('ParentEmail')
        if p_name:
            p_ref = fs_client.collection('parents').document()
            p_ref.set({'name': p_name, 'email': p_email or '', 'studentId': student_id, 'createdAt': firestore.SERVER_TIMESTAMP})

    return created


@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/admin/save_chat_key', methods=['POST'])
def admin_save_chat_key():
    # Save an encrypted chatbot API key on the server. If ADMIN_API_KEY is set, require header x-admin-api-key.
    try:
        if ADMIN_API_KEY:
            incoming = request.headers.get('x-admin-api-key')
            if incoming != ADMIN_API_KEY:
                return jsonify({'error': 'Unauthorized'}), 401
        body = request.get_json(force=True)
        if not body or 'key' not in body:
            return jsonify({'error': 'Missing key in request body'}), 400
        key = str(body.get('key'))
        ok = save_server_chat_key(key)
        if not ok:
            return jsonify({'error': 'Failed to save key on server'}), 500
        return jsonify({'message': 'Chat key saved on server'}), 200
    except Exception as e:
        LOG.exception('admin_save_chat_key failed')
        return jsonify({'error': str(e)}), 500


@app.route('/admin/delete_chat_key', methods=['POST','DELETE'])
def admin_delete_chat_key():
    try:
        if ADMIN_API_KEY:
            incoming = request.headers.get('x-admin-api-key')
            if incoming != ADMIN_API_KEY:
                return jsonify({'error': 'Unauthorized'}), 401
        ok = delete_server_chat_key()
        if not ok:
            return jsonify({'error': 'Failed to delete key'}), 500
        return jsonify({'message': 'Chat key deleted'}), 200
    except Exception as e:
        LOG.exception('admin_delete_chat_key failed')
        return jsonify({'error': str(e)}), 500


@app.route('/admin/chat_key_status', methods=['GET'])
def admin_chat_key_status():
    try:
        has = CHAT_KEY_PATH.exists()
        return jsonify({'hasKey': bool(has)}), 200
    except Exception as e:
        LOG.exception('admin_chat_key_status failed')
        return jsonify({'error': str(e)}), 500


@app.route('/predict', methods=['POST'])
def predict():
    try:
        model, meta = load_model()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    try:
        data = request.get_json(force=True)
    except Exception as e:
        LOG.exception('Failed to parse JSON for /predict')
        return jsonify({'error': 'Invalid JSON body', 'detail': str(e), 'hint': 'Send application/json with an object or array of objects'}), 400
    if data is None:
        return jsonify({'error': 'Missing JSON body', 'hint': 'Send an object or array of objects (application/json) with keys: Attendance, CGPA, Stress'}), 400

    # accept single object or list
    rows = data if isinstance(data, list) else [data]

    # basic validation: rows should be list of dict-like objects
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        LOG.warning('/predict received unexpected payload type: %s', type(data))
        sample = {'example': [{'Attendance': 85, 'CGPA': 7.2, 'Stress': 3}]}
        return jsonify({'error': 'Payload must be an object or array of objects', 'received_type': str(type(data)), 'expected_sample': sample}), 400

    features = meta.get('features', [])
    # if payload objects do not contain any expected feature keys, return a helpful 400
    first = rows[0] if rows else {}
    keys_lower = {k.lower() for k in first.keys()} if isinstance(first, dict) else set()
    expected_lower = {f.lower() for f in features}
    if expected_lower and keys_lower.isdisjoint(expected_lower):
        LOG.warning('/predict payload missing expected feature keys. Received keys: %s ; expected one of: %s', list(first.keys()), features)
        sample = [{'Attendance': 85, 'CGPA': 7.2, 'Stress': 3}]
        return jsonify({'error': 'Payload objects do not contain expected feature keys', 'received_keys': list(first.keys()), 'expected_keys': features, 'expected_sample': sample}), 400
    try:
        X = prepare_input(rows, features)
        preds = model.predict(X)
        # try to compute probabilities when available (useful for client-side thresholds)
        probs = None
        try:
            if hasattr(model, 'predict_proba'):
                probs = model.predict_proba(X)
        except Exception:
            probs = None
        inv = meta.get('inv_label_map') or {str(v): k for k, v in meta.get('label_map', {}).items()}
        results = []
        # determine index for 'High' class if label_map available
        label_map = meta.get('label_map', {}) or {}
        high_idx = None
        if isinstance(label_map, dict) and 'High' in label_map:
            try:
                high_idx = int(label_map['High'])
            except Exception:
                high_idx = None

        for i, (r, p) in enumerate(zip(rows, preds)):
            label = inv.get(str(int(p)), None) or inv.get(p, str(p))
            out = {**r, 'risk': label}
            # attach a probability estimate if available; otherwise map label -> heuristic prob
            attached_prob = False
            if probs is not None:
                try:
                    row_probs = probs[i]
                    # model.classes_ aligns with the columns returned by predict_proba()
                    cls = getattr(model, 'classes_', None)
                    prob_pred = None
                    try:
                        # predicted numeric label (may be 0/1/2 or other)
                        pred_num = int(p)
                    except Exception:
                        pred_num = p

                    # find the column index for the predicted label in model.classes_
                    if cls is not None:
                        try:
                            # compare string forms to handle mixed types
                            idxs = [j for j, val in enumerate(cls) if str(val) == str(pred_num) or val == pred_num]
                            if idxs:
                                prob_pred = float(row_probs[idxs[0]])
                        except Exception:
                            prob_pred = None

                    # fallback to the max-probability if we couldn't map by classes_
                    if prob_pred is None:
                        prob_pred = float(row_probs.max())

                    out['prob'] = prob_pred
                    out['probability'] = prob_pred
                    attached_prob = True

                    # expose probability for 'High' specifically if model provides that class
                    try:
                        out['probHigh'] = 0.0
                        if cls is not None and high_idx is not None:
                            idxs_h = [j for j, val in enumerate(cls) if str(val) == str(high_idx) or val == high_idx]
                            if idxs_h:
                                out['probHigh'] = float(row_probs[idxs_h[0]])
                        else:
                            # if label_map indicates High index but model.classes_ uses same numeric labels, try mapping
                            out['probHigh'] = float(row_probs.max()) if row_probs is not None else 0.0
                    except Exception:
                        out['probHigh'] = 0.0
                except Exception:
                    attached_prob = False
            if not attached_prob:
                # fallback heuristic mapping from label -> probability
                try:
                    label_norm = str(label or '').strip()
                    heur = {'High': 0.9, 'Medium': 0.5, 'Low': 0.1}
                    out['prob'] = heur.get(label_norm, 0)
                    out['probability'] = out['prob']
                    # ensure probHigh exists even if heuristic used
                    out['probHigh'] = 0.9 if label_norm == 'High' else (0.5 if label_norm == 'Medium' else 0.1)
                except Exception:
                    out['prob'] = 0
                    out['probability'] = 0
                    out['probHigh'] = 0
            results.append(out)
        # Only persist predictions when explicitly requested by the client (avoid creating new user docs)
        saved_ids = []
        saved_file = None
        try:
            do_save = False
            # Query param ?save=1 or payload with { save: true } will enable saving
            if request.args.get('save') in ('1', 'true', 'True'):
                do_save = True
            try:
                if isinstance(data, dict) and data.get('save') is True:
                    do_save = True
            except Exception:
                pass

            if do_save:
                try:
                    saved_ids = save_to_firestore(results)
                except Exception:
                    saved_ids = []
                # If Firestore not configured or save failed, persist locally as a fallback
                if not saved_ids:
                    try:
                        MODEL_DIR.mkdir(parents=True, exist_ok=True)
                        saved_file = str(MODEL_DIR / 'predictions_saved.jsonl')
                        with open(saved_file, 'a', encoding='utf-8') as fh:
                            for r in results:
                                fh.write(json.dumps(r, ensure_ascii=False) + '\n')
                    except Exception:
                        saved_file = None

        except Exception:
            saved_ids = []

        resp = {'predictions': results}
        if saved_ids:
            resp['savedIds'] = saved_ids
        if saved_file:
            resp['savedFile'] = saved_file
        if not saved_ids and not saved_file:
            resp['note'] = 'Predictions computed but not persisted (saving disabled by default). To persist, call /predict?save=1 or include { "save": true } in the body.'
        return jsonify(resp)
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/train', methods=['POST'])
def train_server():
    """Train a model from provided examples payload and persist model.joblib + feature metadata.

    Accepts JSON: { examples: [ {attendance, cgpa, stress, label, id?}, ... ] }
    Label may be numeric (0/1) or string ('Low'/'Medium'/'High').
    If numeric 0/1 is provided we map 1->'High', 0->'Low'.
    """
    try:
        payload = request.get_json(force=True)
    except Exception as e:
        LOG.exception('Failed to parse JSON for /train')
        return jsonify({'error': 'Invalid JSON', 'detail': str(e), 'hint': 'Send application/json with a top-level {"examples": [...] } or an array of example objects'}), 400

    # Accept either a top-level object with an `examples` array, or a top-level array of example objects
    examples = None
    if isinstance(payload, list):
        examples = payload
    elif isinstance(payload, dict):
        examples = payload.get('examples')

    if examples is None or not isinstance(examples, list):
        LOG.warning('/train called with missing or invalid examples: %s', type(payload))
        sample_hint = {'examples': [{'Attendance': 85, 'CGPA': 7.2, 'Stress': 3, 'label': 1}]}
        return jsonify({'error': 'Missing examples array in request body', 'received_type': str(type(payload)), 'hint': 'POST JSON like the sample', 'sample': sample_hint}), 400

    try:
        df = pd.DataFrame(examples)
        # normalize feature columns
        features = ['Attendance', 'CGPA', 'Stress']
        col_map = {c.lower(): c for c in df.columns}
        for f in features:
            key = f.lower()
            if key in col_map:
                df[f] = pd.to_numeric(df[col_map[key]], errors='coerce')
            else:
                df[f] = 0

        # prepare target mapping
        def normalize_label(v):
            if v is None:
                return None
            if isinstance(v, (int, float)):
                return 'High' if int(v) == 1 else 'Low'
            s = str(v).strip()
            # accept common labels
            if s.lower() in ('high', 'h', '1', 'true', 'yes'):
                return 'High'
            if s.lower() in ('medium', 'med', 'm'):
                return 'Medium'
            return 'Low'

        df['__label'] = df.get('label')
        if '__label' not in df.columns or df['__label'].isnull().all():
            # try fields like 'risk' or 'Risk' if present
            if 'risk' in col_map:
                df['__label'] = df[col_map['risk']]
            elif 'Risk' in df.columns:
                df['__label'] = df['Risk']

        df['__label_norm'] = df['__label'].apply(normalize_label)
        df = df[df['__label_norm'].notnull()]
        if df.shape[0] < 2:
            return jsonify({'error': 'Not enough labeled examples to train. Need at least 2.'}), 400

        # map to numeric labels expected by train_model.py
        LABEL_MAP = {"Low": 0, "Medium": 1, "High": 2}
        y = df['__label_norm'].map(LABEL_MAP).astype(int)
        X = df[features].fillna(df[features].median()).values

        # allow admin-controlled accuracy parameter to adjust model complexity
        acc = None
        try:
            acc = float(payload.get('accuracy')) if isinstance(payload, dict) and payload.get('accuracy') is not None else None
        except Exception:
            acc = None

        # map accuracy [0.0..1.0] to RF hyperparameters (n_estimators, max_depth)
        def map_accuracy_to_params(a):
            if a is None:
                return {'n_estimators': 200, 'max_depth': None}
            a = max(0.0, min(1.0, float(a)))
            # low accuracy -> small trees, fewer estimators; high accuracy -> larger forest
            n = int(50 + a * 450)  # 50..500
            max_d = None if a > 0.7 else int(3 + a * 10)  # small depth for low a
            return {'n_estimators': n, 'max_depth': max_d}

        params = map_accuracy_to_params(acc)

        # train a pipeline: StandardScaler + RandomForest with class balancing
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import make_pipeline

        rf = RandomForestClassifier(n_estimators=params['n_estimators'], max_depth=params['max_depth'], random_state=42, class_weight='balanced')
        clf = make_pipeline(StandardScaler(), rf)
        clf.fit(X, y)

        # save model and metadata
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(clf, MODEL_PATH)
        # include training metadata (size and class counts)
        try:
            counts = df['__label_norm'].value_counts().to_dict()
        except Exception:
            counts = {}
        meta = {
            'features': features,
            'label_map': {k: v for k, v in LABEL_MAP.items()},
            'inv_label_map': {v: k for k, v in LABEL_MAP.items()},
            'training_size': int(df.shape[0]),
            'class_counts': {str(k): int(v) for k, v in counts.items()}
        }
        META_PATH.write_text(json.dumps(meta))

        # compute a quick cross-validation score if dataset is large enough
        cv_score = None
        try:
            from sklearn.model_selection import cross_val_score, StratifiedKFold
            if len(y) >= 10:
                cv = StratifiedKFold(n_splits=min(5, max(2, len(y)//10)))
                sc = cross_val_score(clf, X, y, cv=cv, scoring='accuracy')
                cv_score = float(sc.mean())
        except Exception:
            cv_score = None

        return jsonify({'message': f'Trained model on {len(df)} examples and saved to {MODEL_PATH.name}', 'training_size': int(df.shape[0]), 'class_counts': meta.get('class_counts', {}), 'cv_score': cv_score, 'params': params}), 200
    except Exception as e:
        LOG.exception('Training failed')
        return jsonify({'error': str(e)}), 500


@app.route('/upload', methods=['POST'])
def upload_and_save():
    """Endpoint to accept rows, run prediction, and optionally save to Firestore.
    Accepts JSON body: single object or list of objects.
    If Firestore is configured it will write student docs and return their IDs.
    """
    # Optional simple API key protect (set ENV EDUCARE_API_KEY to require)
    api_key = os.environ.get('EDUCARE_API_KEY')
    if api_key:
        incoming = request.headers.get('x-api-key')
        if incoming != api_key:
            return jsonify({'error': 'Unauthorized'}), 401

    try:
        model, meta = load_model()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    payload = request.get_json(force=True)
    if payload is None:
        return jsonify({'error': 'Missing JSON body'}), 400
    rows = payload if isinstance(payload, list) else [payload]
    features = meta.get('features', [])
    try:
        X = prepare_input(rows, features)
        preds = model.predict(X)
        inv = meta.get('inv_label_map') or {str(v): k for k, v in meta.get('label_map', {}).items()}
        results = []
        for r, p in zip(rows, preds):
            label = inv.get(str(int(p)), None) or inv.get(p, str(p))
            results.append({**r, 'risk': label})

        saved_ids = save_to_firestore(results)
        return jsonify({'predictions': results, 'savedIds': saved_ids})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Server entrypoint is at the bottom of this file so all routes are registered before app.run()


@app.route('/model_info', methods=['GET'])
def model_info():
    """Return metadata about the persisted model (feature list, label maps) and the model.classes_ if available.

    Useful for client-side UI to show which labels the server model supports.
    """
    try:
        if not META_PATH.exists():
            return jsonify({'error': 'Model metadata not found'}), 404
        meta = json.loads(META_PATH.read_text())
        classes = None
        try:
            if MODEL_PATH.exists():
                m = joblib.load(MODEL_PATH)
                classes = getattr(m, 'classes_', None)
                # convert numpy arrays to a plain list of JSON-serializable types
                if classes is not None:
                    cls_list = list(classes)
                    sanitized = []
                    for c in cls_list:
                        try:
                            # prefer integers for numeric labels
                            sanitized.append(int(c))
                        except Exception:
                            try:
                                sanitized.append(str(c))
                            except Exception:
                                sanitized.append(None)
                    classes = sanitized
        except Exception:
            classes = None
        resp = {'meta': meta}
        if classes is not None:
            resp['classes'] = classes
        return jsonify(resp)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/predictions_saved', methods=['GET'])
def get_saved_predictions():
    """Return the saved predictions file as a JSON array (each line is a JSON object).

    Useful for admin UI to preview recent saved predictions when Firestore isn't configured.
    """
    try:
        pred_file = MODEL_DIR / 'predictions_saved.jsonl'
        if not pred_file.exists():
            return jsonify({'error': 'No saved predictions found'}), 404
        results = []
        with open(pred_file, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    results.append(json.loads(line))
                except Exception:
                    # ignore malformed lines but continue
                    continue
        return jsonify({'predictions': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/download_predictions', methods=['GET'])
def download_predictions():
    """Return the saved predictions file as an attachment for download."""
    try:
        pred_file = MODEL_DIR / 'predictions_saved.jsonl'
        if not pred_file.exists():
            return jsonify({'error': 'No saved predictions found'}), 404
        return send_file(str(pred_file), as_attachment=True, download_name='predictions_saved.jsonl')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/reset_model', methods=['POST'])
def reset_model():
    """Delete server-side trained model + metadata + saved predictions.

    This is a destructive operation; it removes `model.joblib`,
    `feature_columns.json` and `predictions_saved.jsonl` if present.
    """
    try:
        removed = []
        if MODEL_PATH.exists():
            try:
                MODEL_PATH.unlink()
                removed.append(str(MODEL_PATH))
            except Exception as e:
                LOG.exception('Failed to remove model file: %s', e)
        if META_PATH.exists():
            try:
                META_PATH.unlink()
                removed.append(str(META_PATH))
            except Exception as e:
                LOG.exception('Failed to remove meta file: %s', e)
        pred_file = MODEL_DIR / 'predictions_saved.jsonl'
        if pred_file.exists():
            try:
                pred_file.unlink()
                removed.append(str(pred_file))
            except Exception as e:
                LOG.exception('Failed to remove predictions file: %s', e)

        return jsonify({'message': 'Reset completed', 'removed': removed}), 200
    except Exception as e:
        LOG.exception('Reset model failed')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Start the app after all routes are registered
    app.run(host='0.0.0.0', port=5000, debug=True)

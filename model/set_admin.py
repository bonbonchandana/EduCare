#!/usr/bin/env python
# model/set_admin.py
# Usage: python model/set_admin.py admin@example.com

import sys
import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, auth

SERVICE_ACCOUNT = Path(__file__).resolve().parent.parent / 'firebase' / 'serviceAccountKey.json'

if not SERVICE_ACCOUNT.exists():
    print('Service account not found at', SERVICE_ACCOUNT)
    sys.exit(1)

cred = credentials.Certificate(str(SERVICE_ACCOUNT))
try:
    firebase_admin.initialize_app(cred)
except Exception:
    # app may already be initialized
    pass

if len(sys.argv) < 2:
    print('Usage: python model/set_admin.py <email>')
    sys.exit(1)

email = sys.argv[1]
try:
    user = auth.get_user_by_email(email)
    auth.set_custom_user_claims(user.uid, {'admin': True})
    print('Set admin claim for', email)
except Exception as e:
    print('Failed to set admin claim:', e)
    sys.exit(1)

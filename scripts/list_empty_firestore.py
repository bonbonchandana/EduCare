import json
from firebase_admin import credentials, initialize_app, firestore
import firebase_admin

SA='firebase/serviceAccountKey.json'
cred = credentials.Certificate(SA)
try:
    initialize_app(cred)
except Exception:
    # may already be initialized
    pass

db = firestore.client()
cols = ['students','parents','counselors','admins','sessions','uploads','training_examples']
summary = {}
for col in cols:
    docs = list(db.collection(col).stream())
    ids = []
    empties = []
    for d in docs:
        ids.append(d.id)
        data = d.to_dict() or {}
        # doc empty if all top-level fields are null/empty
        nonempty = False
        for v in data.values():
            if v is None:
                continue
            if isinstance(v, str) and v.strip() == '':
                continue
            # anything else counts as meaningful
            nonempty = True
            break
        if not nonempty:
            empties.append(d.id)
    summary[col] = {'found': len(ids), 'empty_count': len(empties), 'empty_ids': empties[:50]}
print(json.dumps(summary, indent=2))

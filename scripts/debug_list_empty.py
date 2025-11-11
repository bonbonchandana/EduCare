import json
import sys
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except Exception as e:
    print('firebase-admin import failed:', e)
    sys.exit(0)

SA='firebase/serviceAccountKey.json'
try:
    cred = credentials.Certificate(SA)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print('Failed to init firebase-admin:', e)
    sys.exit(0)

cols = ['students','parents','counselors','admins','sessions','uploads','training_examples']
summary = {}
for col in cols:
    try:
        docs = list(db.collection(col).stream())
    except Exception as e:
        print(f'Failed to list {col}:', e)
        continue
    empties = []
    for d in docs:
        data = d.to_dict() or {}
        nonempty = False
        for v in data.values():
            if v is None:
                continue
            if isinstance(v, str) and v.strip() == '':
                continue
            nonempty = True
            break
        if not nonempty:
            empties.append(d.id)
    summary[col] = {'found': len(docs), 'empty_count': len(empties), 'empty_ids': empties[:50]}
print(json.dumps(summary, indent=2))

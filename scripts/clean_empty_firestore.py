"""Clean empty Firestore documents.

This script connects to Firestore using a service account JSON (default: firebase/serviceAccountKey.json)
and deletes documents in specified collections that contain no meaningful (non-null/non-empty) fields.

Usage (PowerShell):
    python .\scripts\clean_empty_firestore.py --dry-run
    python .\scripts\clean_empty_firestore.py --confirm   # actually delete
    python .\scripts\clean_empty_firestore.py --collections students,parents,counselors --confirm

Safety: By default it runs in dry-run mode and only prints what it would delete. Use --confirm to perform deletions.
"""
import argparse
import json
import sys
from typing import Any

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except Exception as e:
    print("firebase-admin is required. Install with: pip install firebase-admin")
    raise


def is_meaningful(obj: Any) -> bool:
    if obj is None:
        return False
    if isinstance(obj, str):
        return obj.strip() != ""
    if isinstance(obj, (int, float, bool)):
        return True
    if isinstance(obj, dict):
        return any(is_meaningful(v) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return len(obj) > 0 and any(is_meaningful(v) for v in obj)
    return False


def doc_is_empty(data: dict) -> bool:
    # Consider doc empty if none of its top-level fields are meaningful
    if not data:
        return True
    for k, v in data.items():
        if is_meaningful(v):
            return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-account", default="firebase/serviceAccountKey.json", help="Path to service account JSON")
    parser.add_argument("--collections", default="students,parents,counselors,admins,sessions,uploads,training_examples",
                        help="Comma-separated collection names to scan")
    parser.add_argument("--confirm", action="store_true", help="Actually delete matching documents (default is dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of deletions (0 = no limit)")
    args = parser.parse_args()

    sa = args.service_account
    try:
        cred = credentials.Certificate(sa)
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"Failed to initialize Firebase Admin with '{sa}': {e}")
        sys.exit(1)

    db = firestore.client()
    cols = [c.strip() for c in args.collections.split(',') if c.strip()]

    total_candidates = 0
    total_deleted = 0

    for col in cols:
        print(f"Scanning collection: {col}")
        try:
            docs = list(db.collection(col).stream())
        except Exception as e:
            print(f"  Failed to list collection '{col}': {e}")
            continue
        print(f"  Found {len(docs)} documents in {col}")
        for d in docs:
            data = d.to_dict() or {}
            if doc_is_empty(data):
                total_candidates += 1
                print(f"    EMPTY -> {col}/{d.id}")
                if args.confirm:
                    try:
                        db.collection(col).document(d.id).delete()
                        total_deleted += 1
                        print(f"      Deleted {col}/{d.id}")
                    except Exception as e:
                        print(f"      Failed to delete {col}/{d.id}: {e}")
                else:
                    # dry-run: print sample of fields
                    # limit output to small preview
                    preview = {k: (v if isinstance(v, (str, int, float, bool)) else type(v).__name__) for k, v in list(data.items())[:6]}
                    print(f"      (dry-run) fields preview: {json.dumps(preview)}")
                if args.limit and total_deleted >= args.limit:
                    print("Reached deletion limit; stopping")
                    break
        if args.limit and total_deleted >= args.limit:
            break

    print(f"\nSummary: candidates={total_candidates}, deleted={total_deleted}")
    if not args.confirm:
        print("Dry-run completed. Re-run with --confirm to actually delete the documents.")


if __name__ == '__main__':
    main()

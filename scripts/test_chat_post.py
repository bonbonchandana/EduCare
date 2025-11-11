import requests, json

def run_test():
    url = 'http://127.0.0.1:8000/chat'
    payload = {'messages':[{'role':'user','content':'Hello from automated connectivity test'}]}
    try:
        r = requests.post(url, json=payload, timeout=10)
        print('status', r.status_code)
        try:
            print(json.dumps(r.json(), indent=2, ensure_ascii=False))
        except Exception:
            print('text', r.text[:2000])
    except Exception as e:
        print('error', str(e))

if __name__ == '__main__':
    run_test()

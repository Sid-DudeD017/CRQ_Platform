import requests

url = "http://127.0.0.1:8000/api/simulate-risk"
payload = {
    "budget": 20000.0,
    "constraints": {}
}

try:
    response = requests.post(url, json=payload)
    print(response.status_code)
    print(response.json())
except Exception as e:
    print(e)

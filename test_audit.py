import requests

# 1. Login to get token
res = requests.post("http://localhost:8000/api/auth/login", data={"username": "ciso", "password": "password"})
if res.status_code != 200:
    print("Login failed:", res.text)
    token = "fake_token"
else:
    token = res.json().get("access_token")

# 2. Accept Risk
headers = {"Authorization": f"Bearer {token}"}
payload = {
    "action": "Accept residual risk: Payment Processing",
    "risk_accepted": 20000000,
    "user_id": "ciso",
    "board_approved": True
}
res2 = requests.post("http://localhost:8000/api/audit", json=payload, headers=headers)
print("Audit response:", res2.status_code, res2.text)

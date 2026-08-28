import subprocess
import time
import urllib.request
import json

proc = subprocess.Popen(["./venv/bin/uvicorn", "backend.main:app", "--port", "8004"])
time.sleep(3)

try:
    req = urllib.request.Request("http://127.0.0.1:8004/api/audit", method="POST", headers={"Content-Type": "application/json"})
    data = json.dumps({"action": "Accept Payment Risk", "risk_accepted": 1200000, "user_id": "CISO_123", "board_approved": True}).encode("utf-8")
    with urllib.request.urlopen(req, data=data) as f:
        print("Status:", f.status)
        print("Response:", f.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)

proc.terminate()

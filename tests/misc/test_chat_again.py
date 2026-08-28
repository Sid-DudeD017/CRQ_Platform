import subprocess
import time
import urllib.request
import json

proc = subprocess.Popen(["./venv/bin/uvicorn", "backend.main:app", "--port", "8005"])
time.sleep(3)

try:
    req = urllib.request.Request("http://127.0.0.1:8005/api/chat", method="POST", headers={"Content-Type": "application/json"})
    data = json.dumps({"message": "hello"}).encode("utf-8")
    with urllib.request.urlopen(req, data=data) as f:
        print("Status:", f.status)
        print("Headers:", f.headers)
        print("Response:", f.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)

proc.terminate()

import subprocess
import time
import urllib.request
import json

proc = subprocess.Popen(["./venv/bin/uvicorn", "backend.main:app", "--port", "8003"])
time.sleep(3)

try:
    req = urllib.request.Request("http://127.0.0.1:8003/api/simulate-risk", method="POST", headers={"Content-Type": "application/json"})
    data = json.dumps({"budget": 65.0}).encode("utf-8")
    with urllib.request.urlopen(req, data=data) as f:
        print("Status:", f.status)
        res = json.loads(f.read().decode("utf-8"))
        print("SEBI Resilience:", res.get("sebi_resilience"))
except Exception as e:
    print("Error:", e)

proc.terminate()

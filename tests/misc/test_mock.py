import subprocess
import time
import urllib.request
import json

proc = subprocess.Popen(["./venv/bin/uvicorn", "backend.main:app", "--port", "8002"])
time.sleep(3)

try:
    req = urllib.request.Request("http://127.0.0.1:8002/api/generate-mock-data", method="POST")
    with urllib.request.urlopen(req) as f:
        print("Status:", f.status)
        print("Response:", f.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)

proc.terminate()

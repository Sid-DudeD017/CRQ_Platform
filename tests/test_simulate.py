import sys
import os
from fastapi.testclient import TestClient

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(project_root)

from backend.main import app

client = TestClient(app)

print("Simulating risk...")
response = client.post("/api/simulate-risk", json={"budget": 1000000})
print(response.status_code)
# print keys to verify
if response.status_code == 200:
    print(response.json().keys())
    print("Success!")
else:
    print(response.text)

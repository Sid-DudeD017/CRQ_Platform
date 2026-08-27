from fastapi.testclient import TestClient
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.append(project_root)

from backend.main import app

client = TestClient(app)

print("Regenerating database...")
response = client.post("/api/generate-mock-data")
print(response.status_code)
print(response.json())

from fastapi.testclient import TestClient
import os
import sys

# setup path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.append(project_root)

from backend.main import app
from backend.database import engine
from backend.models import Base

# create tables in case they don't exist
Base.metadata.create_all(bind=engine)

client = TestClient(app)

print("Testing generate mock data...")
response = client.post("/api/generate-mock-data")
print(response.status_code)
print(response.json())

print("Testing telemetry...")
response = client.get("/api/telemetry")
print(response.status_code)
print("Telemetry logs count:", len(response.json()["data"]))

print("Testing topology...")
response = client.get("/api/topology")
print(response.status_code)
print("Topology version:", response.json()["data"]["version"])

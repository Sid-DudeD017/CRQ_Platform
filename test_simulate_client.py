from fastapi.testclient import TestClient
from backend.main import app
import json

client = TestClient(app)
response = client.post(
    "/api/simulate-risk",
    json={"budget": 20000.0, "constraints": {}}
)
print("Status Code:", response.status_code)
data = response.json()
print("Keys in response:", data.keys())
if "monte_carlo" in data:
    print("Monte Carlo metrics:", data["monte_carlo"])
if "optimization" in data:
    print("Optimization results:", data["optimization"])

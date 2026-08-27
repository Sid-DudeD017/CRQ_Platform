from fastapi.testclient import TestClient
import os
import sys

# setup path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.append(project_root)

from backend.main import app
from backend.database import engine
from backend.models import Base

client = TestClient(app)

print("Testing simulate-risk...")
response = client.post("/api/simulate-risk", json={"budget": 100000})
print(response.status_code)
if response.status_code == 200:
    res_json = response.json()
    print("Expected Loss:", res_json["monte_carlo"]["mean_expected_loss"])
    print("VaR 95:", res_json["monte_carlo"]["var_95"])
else:
    print(response.json())

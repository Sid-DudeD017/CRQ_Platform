"""
Real automated coverage for the FastAPI gateway, using FastAPI's
TestClient - as opposed to the ad hoc scratch scripts elsewhere in this
folder (test_local.py, test_sim.py, etc.), which were exploratory and
never ran automatically.

Run with:
    source venv/bin/activate
    pytest tests/test_api.py -v

Uses a throwaway local SQLite file instead of the real Neon database, and
forces the AI agent's keyword-routing fallback (no real Groq call) so this
suite runs offline and never touches production data or API quota.
"""
import os

# Both of these are read via os.getenv()/load_dotenv() at *import time* by
# backend/database.py and ai-agent/graph.py respectively. python-dotenv's
# load_dotenv() never overrides a variable already present in the
# environment, so setting these here - before backend.main (and therefore
# those modules) gets imported below - is what keeps this suite off the
# real Neon DB and off the real Groq API.
os.environ["DATABASE_URL"] = "sqlite:///./test_crq_db.sqlite3"
os.environ["GROQ_API_KEY"] = ""
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-prod")

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c
    db_file = REPO_ROOT / "test_crq_db.sqlite3"
    if db_file.exists():
        db_file.unlink()


@pytest.fixture(scope="module")
def ciso_token(client):
    res = client.post("/api/auth/login", data={"username": "ciso", "password": "demo-ciso-pass"})
    assert res.status_code == 200
    return res.json()["access_token"]


def test_health_check(client):
    res = client.get("/")
    assert res.status_code == 200


def test_login_rejects_bad_credentials(client):
    res = client.post("/api/auth/login", data={"username": "ciso", "password": "wrong"})
    assert res.status_code == 401


def test_login_accepts_demo_credentials(ciso_token):
    assert ciso_token


def test_generate_mock_data_requires_auth(client):
    """Regression guard: this destructive, otherwise-unauthenticated
    endpoint (it wipes and reseeds the whole demo DB) must reject
    anonymous callers now that it's gated behind login."""
    res = client.post("/api/generate-mock-data")
    assert res.status_code == 401


def test_generate_mock_data_with_auth(client, ciso_token):
    res = client.post(
        "/api/generate-mock-data",
        headers={"Authorization": f"Bearer {ciso_token}"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_telemetry_and_topology_after_seed(client):
    res = client.get("/api/telemetry")
    assert res.status_code == 200
    assert len(res.json()["data"]) > 0

    res = client.get("/api/topology")
    assert res.status_code == 200
    assert "adjacency_matrix" in res.json()["data"]


def test_simulate_risk_sebi_resilience_stays_in_bounds(client):
    """Regression guard for the SEBI resilience clamping bug found and
    fixed earlier in this project - every pillar and the composite score
    must stay in [0, 5] no matter how bad the underlying telemetry is."""
    res = client.post("/api/simulate-risk", json={"budget": 10000000})
    assert res.status_code == 200
    body = res.json()
    sebi = body["sebi_resilience"]
    for key in ("cci_score", "anticipate", "withstand", "contain", "recover", "evolve"):
        value = sebi[key]
        assert 0.0 <= value <= 5.0, f"{key} out of [0, 5] bounds: {value}"
    assert body["monte_carlo"]["mean_expected_loss"] >= 0
    assert "optimization" in body


def test_simulate_risk_is_rate_limited(client):
    """Regression guard for the new per-IP rate limit on this expensive,
    unauthenticated endpoint - well past the 10/minute limit, calls must
    start coming back 429."""
    last_status = None
    for _ in range(11):
        last_status = client.post("/api/simulate-risk", json={"budget": 5000000}).status_code
    assert last_status == 429


def test_audit_requires_auth(client):
    res = client.post("/api/audit", json={"action": "test", "risk_accepted": 1000})
    assert res.status_code == 401


def test_audit_log_flow(client, ciso_token):
    res = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {ciso_token}"},
        json={"action": "Accepted: Test Risk", "risk_accepted": 500000, "board_approved": True},
    )
    assert res.status_code == 200
    decision_id = res.json()["decision_id"]

    res = client.get("/api/audit-log")
    assert res.status_code == 200
    decisions = res.json()["data"]
    assert any(d["id"] == decision_id for d in decisions)

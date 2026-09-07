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


# --- 5. Simulation success and failure -------------------------------------

def test_simulate_risk_own_data_requires_auth(client):
    """[Cross-user data leakage fix] An 'own'-mode simulation with no token
    must fail closed, not run against some shared/anonymous bucket."""
    res = client.post("/api/simulate-risk", json={"budget": 1000000, "data_source": "own"})
    assert res.status_code == 401


def test_simulate_risk_rejects_negative_budget(client):
    """[API security review / input validation] budget is now bounds-checked
    (Field(ge=0)) - a negative budget must 422, not silently flow into the
    optimizer's knapsack math."""
    res = client.post("/api/simulate-risk", json={"budget": -500})
    assert res.status_code == 422


def test_simulate_risk_persists_version_and_seed(client):
    """[Version the risk model fix] Every simulation response - and the
    persisted RiskSimulation row behind it - must now carry a model
    version, control-library version, and the actual random seed drawn for
    that run's Monte Carlo distribution, so a challenged number can be
    reproduced and re-checked."""
    res = client.post("/api/simulate-risk", json={"budget": 2000000})
    assert res.status_code == 200
    provenance = res.json()["provenance"]
    assert provenance["model_version"]
    assert provenance["control_library_version"]
    assert isinstance(provenance["random_seed"], int)
    assert provenance["simulation_config"]["num_simulations"] > 0


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
    # Regression guard: this test previously sent board_approved=True with
    # none of the governance-evidence fields the [Risk passport governance
    # evidence fix] (main.py::log_audit) now requires, and read the ledger
    # back with no Authorization header at all - both would 4xx against
    # the current backend. active_controls={} is enough for evidence_hash
    # to compute (assets already exist from test_generate_mock_data_with_auth
    # above); residual_ale/p95/accepted_scenario are supplied directly, same
    # as the real Overview → Accept Risk flow sends them.
    res = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {ciso_token}"},
        json={
            "action": "Accepted: Test Risk",
            "risk_accepted": 500000,
            "board_approved": True,
            "active_controls": {},
            "residual_ale": 1000000,
            "p95": 2000000,
            "accepted_scenario": "Ransomware",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    decision_id = body["decision_id"]
    # [Version the risk model fix] every decision now names the model/
    # control-library version live when it was logged.
    assert body["model_version"]
    assert body["control_library_version"]

    # [Cross-user data leakage fix] GET /api/audit-log now requires auth.
    res = client.get("/api/audit-log", headers={"Authorization": f"Bearer {ciso_token}"})
    assert res.status_code == 200
    decisions = res.json()["data"]
    assert any(d["id"] == decision_id for d in decisions)


def test_audit_board_approved_requires_evidence(client, ciso_token):
    """Regression guard for the [Risk passport governance evidence fix] -
    a board-approved decision with none of the evidence fields must be
    rejected, not silently logged with a clean 'Board-approved' badge and
    a row of blanks."""
    res = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {ciso_token}"},
        json={"action": "Accepted: Underspecified", "risk_accepted": 100, "board_approved": True},
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# [Automated E2E test suite] Everything below was added in one pass to cover
# the 8 flows called out for real end-to-end coverage: login/logout, every
# protected route on refresh, two-user data isolation, demo reset,
# simulation success/failure, upload validation, approval + audit logging,
# and chat fallback behavior. These are real HTTP-layer integration tests
# (FastAPI TestClient against a real, throwaway SQLite DB) rather than
# browser-driven E2E - there's no headless-browser runner wired into this
# repo's CI, and every one of these flows is actually decided by this
# backend's request/response behavior, not by frontend rendering, so this is
# where a regression would actually be caught.
# ---------------------------------------------------------------------------


# --- 1. Login and logout --------------------------------------------------

def test_login_rejects_malformed_token(client):
    """A garbage bearer token (not just a missing one) must still 401, not
    500 or silently pass through as anonymous."""
    res = client.post(
        "/api/audit",
        headers={"Authorization": "Bearer not-a-real-jwt"},
        json={"action": "x", "risk_accepted": 1},
    )
    assert res.status_code == 401


def test_demo_login_issues_working_token(client):
    """[Public demo credentials exposed - fix] POST /api/auth/demo-login -
    no password crosses the wire - must issue a token that actually works
    against a protected route."""
    res = client.post("/api/auth/demo-login", json={"role": "cfo"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    protected = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {token}"},
        json={"action": "demo-login smoke test", "risk_accepted": 1},
    )
    assert protected.status_code == 200


def test_demo_login_rejects_unknown_role(client):
    res = client.post("/api/auth/demo-login", json={"role": "not-a-real-role"})
    assert res.status_code == 400


# Logout itself is client-side only (the JWT is simply discarded by the
# frontend - see AuthContext.tsx - there's no server-side session to
# invalidate), so there's nothing to exercise server-side beyond confirming
# a token keeps working until the client drops it, which the tests above
# already establish.


# --- 2. Refreshing every protected route (auth persistence regression) ----

# [Auth lost on refresh/deep links fix] The whole point of that fix was
# that navigating straight to (or refreshing) a protected page must never
# silently fall back to anonymous access. The API-layer equivalent of "the
# page is protected" is "the endpoint 401s with no/bad token" - this is a
# blanket regression guard so a future endpoint can't quietly lose its auth
# dependency the way GET /api/audit-log and POST /api/simulate-risk (own
# data) once did.
PROTECTED_ROUTES_NO_AUTH = [
    ("GET", "/api/audit-log", None),
    ("DELETE", "/api/audit-log", None),
    ("POST", "/api/audit-log/1/commit-chain", None),
    ("POST", "/api/reset-demo", None),
    ("POST", "/api/ingest/confirm", {
        "filename": "x", "line_number": 1, "snippet": "x", "parameter": "x", "risk_tag": "x", "confidence": 0.5,
    }),
    ("GET", "/api/ingest/mappings", None),
    ("POST", "/api/training/complete", {"module": "x"}),
    ("POST", "/api/chat", {"message": "hi"}),
    ("POST", "/api/generate-mock-data", None),
    ("POST", "/api/audit", {"action": "x", "risk_accepted": 1}),
]


@pytest.mark.parametrize("method,path,body", PROTECTED_ROUTES_NO_AUTH)
def test_protected_route_rejects_missing_token(client, method, path, body):
    res = client.request(method, path, json=body)
    assert res.status_code == 401, f"{method} {path} should 401 with no token, got {res.status_code}: {res.text}"


# --- 3. Two users seeing isolated data -------------------------------------

@pytest.fixture(scope="module")
def isolation_users(client):
    """Two real, distinct signup accounts (not the shared demo/admin
    accounts) - the actual scenario the [Cross-user data leakage fix]
    covers: two unrelated real users, neither an admin, each with their own
    'own'-scoped data."""
    tokens = {}
    for label, email in [("a", "e2e-user-a@example.com"), ("b", "e2e-user-b@example.com")]:
        res = client.post("/api/auth/signup", json={"email": email, "password": "correct-horse-1"})
        assert res.status_code == 200, res.text
        tokens[label] = res.json()["access_token"]
    return tokens


def test_own_data_ledger_is_isolated_per_account(client, isolation_users):
    token_a, token_b = isolation_users["a"], isolation_users["b"]

    res_a = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"action": "User A's own-data decision", "risk_accepted": 111, "data_source": "own"},
    )
    assert res_a.status_code == 200, res_a.text
    decision_a_id = res_a.json()["decision_id"]

    res_b = client.post(
        "/api/audit",
        headers={"Authorization": f"Bearer {token_b}"},
        json={"action": "User B's own-data decision", "risk_accepted": 222, "data_source": "own"},
    )
    assert res_b.status_code == 200, res_b.text
    decision_b_id = res_b.json()["decision_id"]

    ledger_a = client.get(
        "/api/audit-log", params={"data_source": "own"}, headers={"Authorization": f"Bearer {token_a}"},
    ).json()["data"]
    ledger_b = client.get(
        "/api/audit-log", params={"data_source": "own"}, headers={"Authorization": f"Bearer {token_b}"},
    ).json()["data"]

    assert any(d["id"] == decision_a_id for d in ledger_a)
    assert not any(d["id"] == decision_b_id for d in ledger_a), "User A must never see User B's own-data decisions"
    assert any(d["id"] == decision_b_id for d in ledger_b)
    assert not any(d["id"] == decision_a_id for d in ledger_b), "User B must never see User A's own-data decisions"


def test_ingest_mappings_are_isolated_per_account(client, isolation_users):
    token_a, token_b = isolation_users["a"], isolation_users["b"]
    confirm_body = {
        "filename": "isolation-test.cfg", "line_number": 1, "snippet": "x",
        "parameter": "Isolation Test Parameter", "risk_tag": "Test", "confidence": 0.5,
    }
    res_a = client.post("/api/ingest/confirm", headers={"Authorization": f"Bearer {token_a}"}, json=confirm_body)
    assert res_a.status_code == 200
    res_b = client.post("/api/ingest/confirm", headers={"Authorization": f"Bearer {token_b}"}, json=confirm_body)
    assert res_b.status_code == 200

    mappings_a = client.get("/api/ingest/mappings", headers={"Authorization": f"Bearer {token_a}"}).json()
    mappings_b = client.get("/api/ingest/mappings", headers={"Authorization": f"Bearer {token_b}"}).json()
    # Each account should see exactly its own one confirmed mapping here,
    # never the other account's.
    assert mappings_a["count"] == 1
    assert mappings_b["count"] == 1
    assert mappings_a["data"][0]["confirmed_by"] != mappings_b["data"][0]["confirmed_by"]


# --- 6. File upload validation (Ingestion Engine) --------------------------

def test_ingest_parse_rejects_empty_content(client):
    res = client.post("/api/ingest/parse", json={"filename": "empty.cfg", "content": "   "})
    assert res.status_code == 400


def test_ingest_parse_rejects_oversized_content(client):
    """[Ingestion upload guidance fix] Backend mirrors the frontend's 2 MB
    cap so a request that bypasses the browser still gets a clear error."""
    oversized = "a" * (2 * 1024 * 1024 + 1)
    res = client.post("/api/ingest/parse", json={"filename": "huge.cfg", "content": oversized})
    assert res.status_code == 400
    assert "2 MB" in res.json()["detail"] or "MB" in res.json()["detail"]


def test_ingest_parse_rejects_binary_content(client):
    """[Ingestion upload guidance fix] A NUL byte (or the U+FFFD replacement
    character readAsText/decode produces on undecodable bytes) means this
    almost certainly isn't a plain-text config."""
    res = client.post("/api/ingest/parse", json={"filename": "binary.cfg", "content": "hostname x\x00garbage"})
    assert res.status_code == 400


def test_ingest_parse_accepts_real_config(client):
    res = client.post(
        "/api/ingest/parse",
        json={"filename": "ok.cfg", "content": "service password-encryption\nsnmp-server community public RO\n"},
    )
    assert res.status_code == 200
    assert len(res.json()["findings"]) >= 1


# --- 8. Chat fallback behavior ----------------------------------------------

def test_chat_requires_auth(client):
    res = client.post("/api/chat", json={"message": "hello"})
    assert res.status_code == 401


def test_chat_falls_back_offline_when_no_llm_key(client, ciso_token):
    """This suite forces GROQ_API_KEY="" at import time (see module
    docstring) specifically so this runs the same offline/fallback path a
    real deployment hits when no LLM key is configured. [AI safety fix] -
    every non-LLM response is now marked with a consistent '[Offline Mode]'
    prefix so the frontend (and this test) can tell a canned response from
    a real model answer."""
    res = client.post(
        "/api/chat",
        headers={"Authorization": f"Bearer {ciso_token}"},
        json={"message": "hello, what can you help with?"},
    )
    assert res.status_code == 200
    assert "[Offline Mode]" in res.text


# --- 4. Demo reset behavior (destructive - runs LAST in this module) -------
# reset-demo wipes every dashboard's data (see backend/main.py::reset_demo),
# including the own-data rows the isolation tests above just created - so
# this must be the final test in the file, never reordered earlier.

def test_reset_demo_requires_admin(client, isolation_users):
    """[Public demo credentials exposed - fix / RBAC] A real (non-admin)
    signup account must never be able to trigger the shared, judge-day
    full reset."""
    res = client.post("/api/reset-demo", headers={"Authorization": f"Bearer {isolation_users['a']}"})
    assert res.status_code == 403


def test_reset_demo_as_admin_succeeds_and_reseeds(client, ciso_token):
    res = client.post("/api/reset-demo", headers={"Authorization": f"Bearer {ciso_token}"})
    assert res.status_code == 200
    cleared = res.json()["cleared"]
    assert "risk_decisions" in cleared

    # A fresh demo fleet must be reseeded immediately - not left empty.
    telemetry = client.get("/api/telemetry")
    assert telemetry.status_code == 200
    assert len(telemetry.json()["data"]) > 0

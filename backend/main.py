"""
CRQ Platform - FastAPI Central Gateway

Single entrypoint every other layer talks to: the frontend, quant-engine
(FAIR Monte Carlo + Knapsack), ai-agent (LangGraph), and the blockchain
audit webhook. Endpoint paths and request/response shapes are UNCHANGED
from the original scaffold - anything already calling this should keep
working exactly as before, with one deliberate exception (see /api/audit).

What changed under the hood: SQLModel instead of raw SQLAlchemy (so the
schema doubles as its own request/response validation - this also fixes a
latent bug where /api/telemetry would have crashed trying to JSON-serialize
raw ORM rows once the DB was non-empty, since plain SQLAlchemy objects
aren't natively JSON-serializable but SQLModel/Pydantic ones are), a more
realistic mock generator (hub-and-spoke network topology instead of a flat
random coin flip, weighted severities instead of uniform-random), and real
JWT auth on /api/audit specifically.

/api/audit previously had NO authentication at all - anyone could POST to
it and forge a blockchain risk-acceptance entry under any name, with any
dollar figure, and it only ever printed to the console (lost on restart).
It now requires a bearer token (POST /api/auth/login first) and persists
the decision to the database. This is the one BREAKING change here: the
frontend's "Accept Risk" button needs to attach an Authorization header
before this will work. Every other endpoint is left exactly as open as it
was, so nothing else that's already calling this breaks.

Run locally from the repo root (so the quant-engine/ai-agent sys.path
lookup below resolves correctly):
    uvicorn backend.main:app --reload --port 8000
"""
import os
import sys
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlmodel import Session, select

from . import generators, models
from .database import get_db, init_db
from .security import authenticate_demo_user, create_access_token, get_current_user

# --- Add sibling directories to path to handle hyphens in folder names ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(os.path.join(project_root, "ai-agent"))

import monte_carlo as quant_mc
import optimizer as quant_opt
import graph as ai_graph

# Create the database tables at import time (not deferred to a startup
# event) - this matches the original scaffold's behavior and matters in
# practice: several of the test scripts in tests/ do
# `from backend.main import app` and immediately fire requests via
# TestClient(app) with no `with` block, which does not reliably trigger a
# FastAPI lifespan/startup event. Creating tables here guarantees they
# exist before any request can be made, exactly like before.
init_db()

app = FastAPI(
    title="CRQ Platform Backend",
    description="Central Router & Data Pipeline for AI-Powered Cyber Risk Quantification",
    version="1.1.0",
)

# Wide open for now, matching the original scaffold - tighten before real
# deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for dev
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic Models for Requests (unchanged shapes) ---
class ChatRequest(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None


class RiskSimRequest(BaseModel):
    budget: float
    constraints: Optional[Dict[str, Any]] = None


class AuditRequest(BaseModel):
    action: str
    risk_accepted: float
    user_id: Optional[str] = None  # accepted for backward compat, but IGNORED now - see /api/audit


# --- Endpoints ---

@app.get("/")
def read_root():
    return {"message": "CRQ Platform API Gateway"}


@app.post("/api/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    New: issues the JWT that /api/audit now requires. Demo exec accounts
    only (see security.py) - swap for real accounts before this is
    anything but a hackathon demo.
    """
    if not authenticate_demo_user(form_data.username, form_data.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(subject=form_data.username)
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/generate-mock-data")
def generate_mock_data(db: Session = Depends(get_db)):
    """
    Populates the database with mock enterprise telemetry, assets, and network topology.
    """
    success, message = generators.populate_database(db)
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return {"status": "success", "message": message}


@app.get("/api/telemetry")
def get_telemetry(db: Session = Depends(get_db)):
    """
    Fetch enterprise telemetry data.
    """
    logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(100)
    ).all()
    if not logs:
        return {
            "status": "success",
            "data": [{
                "id": 1,
                "asset_id": 0,
                "vulnerability_score": 8.5,
                "threat_level": "HIGH",
                "edr_status": "ACTIVE",
            }],
        }
    return {"status": "success", "data": logs}


@app.get("/api/topology")
def get_topology(db: Session = Depends(get_db)):
    """
    Fetch the network topology Adjacency Matrix, built live from NetworkEdge
    rows (was a cached JSON snapshot before - functionally equivalent since
    the edges are created once during /api/generate-mock-data and read here).
    """
    from datetime import datetime

    assets = db.exec(select(models.Asset)).all()
    if not assets:
        raise HTTPException(status_code=404, detail="Network topology not found. Run mock data generation first.")

    asset_ids = [a.id for a in assets]
    index = {asset_id: i for i, asset_id in enumerate(asset_ids)}
    n = len(asset_ids)
    matrix = [[0 for _ in range(n)] for _ in range(n)]

    edges = db.exec(select(models.NetworkEdge)).all()
    for edge in edges:
        i, j = index.get(edge.source_asset_id), index.get(edge.target_asset_id)
        if i is None or j is None:
            continue
        matrix[i][j] = edge.weight
        matrix[j][i] = edge.weight  # undirected view, matches the original contract

    return {
        "status": "success",
        "data": {
            "version": 1,
            "adjacency_matrix": matrix,
            "node_mapping": {i: asset_id for i, asset_id in enumerate(asset_ids)},
            "timestamp": datetime.utcnow().isoformat(),
        },
    }


@app.post("/api/simulate-risk")
def simulate_risk(request: RiskSimRequest, db: Session = Depends(get_db)):
    """
    Trigger risk simulation. Routes data to quant-engine (Monte Carlo / Knapsack).
    """
    assets = db.exec(select(models.Asset)).all()
    if not assets:
        raise HTTPException(status_code=400, detail="No assets found. Run /api/generate-mock-data first.")

    total_business_value = sum(a.business_value for a in assets)

    latest_logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(len(assets))
    ).all()
    avg_vulnerability = (
        sum(log.vulnerability_score for log in latest_logs) / len(latest_logs) if latest_logs else 5.0
    )

    high_threat_count = sum(1 for log in latest_logs if log.threat_level in ("HIGH", "CRITICAL"))
    base_tef = 10.0 + (high_threat_count * 5.0)
    avg_cs = max(10.0, 100.0 - (avg_vulnerability * 10))
    base_plm = total_business_value * 0.05
    base_slm = total_business_value * 0.02

    mc_results = quant_mc.run_fair_monte_carlo(
        tef_min=max(5.0, base_tef - 10), tef_mode=base_tef, tef_max=base_tef + 20,
        tc_min=20.0, tc_mode=60.0, tc_max=95.0,
        cs_min=max(5.0, avg_cs - 20), cs_mode=avg_cs, cs_max=min(100.0, avg_cs + 20),
        plm_min=base_plm * 0.5, plm_mode=base_plm, plm_max=base_plm * 2.0,
        slm_min=base_slm * 0.5, slm_mode=base_slm, slm_max=base_slm * 2.0,
    )

    dummy_patches = [
        {"id": "PATCH-001 (Firewall)", "cost": 5000, "risk_reduction": 20000},
        {"id": "PATCH-002 (EDR Upgrade)", "cost": 15000, "risk_reduction": 60000},
        {"id": "PATCH-003 (IAM Sync)", "cost": 8000, "risk_reduction": 25000},
        {"id": "PATCH-004 (Zero-Trust Proxy)", "cost": 25000, "risk_reduction": 100000},
    ]
    opt_results = quant_opt.optimize_budget(dummy_patches, request.budget)

    sim_record = models.RiskSimulation(
        expected_annual_loss=mc_results["mean_expected_loss"],
        var_95=mc_results.get("var_95"),
        monte_carlo_distribution=mc_results.get("distribution_curve", []),
        optimized_budget_allocation=opt_results,
        budget_used=request.budget,
    )
    db.add(sim_record)
    db.commit()

    return {
        "status": "success",
        "message": "Risk simulation completed",
        "budget_used": request.budget,
        "monte_carlo": {
            "mean_expected_loss": mc_results["mean_expected_loss"],
            "var_95": mc_results["var_95"],
            "distribution_curve": mc_results.get("distribution_curve", []),
        },
        "optimization": opt_results,
    }


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Interface with the AI Orchestrator & Virtual CISO (Streaming).
    """
    from langchain_core.messages import HumanMessage

    initial_state = {"messages": [HumanMessage(content=request.message)]}

    async def event_stream():
        has_yielded = False
        try:
            async for event in ai_graph.app.astream_events(initial_state, version="v1"):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        has_yielded = True
                        yield content
                elif kind == "on_chain_end":
                    if event["name"] in ["security_analyst", "compliance_officer", "quant_analyst"]:
                        msgs = event["data"].get("output", {}).get("messages", [])
                        if msgs and not os.environ.get("OPENAI_API_KEY"):
                            has_yielded = True
                            yield msgs[-1].content
                elif kind == "on_tool_start":
                    has_yielded = True
                    yield f"\n\n[System: Calling tool '{event['name']}']\n\n"
                elif kind == "on_tool_end":
                    has_yielded = True
                    yield f"\n\n[System: Finished tool '{event['name']}']\n\n"

            if not has_yielded:
                yield "I am the Virtual CISO. I can help you query telemetry, optimize budgets, or check compliance frameworks. How can I assist you today?"
        except Exception as e:
            yield f"\n\nError in AI Orchestrator: {str(e)}"

    return StreamingResponse(event_stream(), media_type="text/plain")


def trigger_blockchain_webhook(action: str, risk: float, user: str, decision_id: int):
    """
    Mock function to simulate an async webhook to the Hardhat local EVM.
    """
    print(f"\n[BLOCKCHAIN AUDIT LOG] Successfully committed to AuditLedger.sol!")
    print(f"User: {user} | Action: {action} | Risk Accepted: ${risk:,.2f} | Decision #{decision_id}\n")


@app.post("/api/audit")
def log_audit(
    request: AuditRequest,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Trigger the blockchain smart contract to log a risk acceptance event.

    BREAKING CHANGE from the original scaffold: this now requires a valid
    bearer token (POST /api/auth/login first). `decided_by` comes from the
    verified token, never from `request.user_id` - the whole point of
    authenticating this endpoint is that a client can't just type
    "user_id": "ciso" into the JSON and claim to be the CISO. The decision
    is also now persisted to the database instead of only ever hitting a
    print() statement.
    """
    decision = models.RiskDecision(
        action=request.action,
        risk_accepted=request.risk_accepted,
        decided_by=current_user,
    )
    db.add(decision)
    db.commit()
    db.refresh(decision)

    background_tasks.add_task(
        trigger_blockchain_webhook, request.action, request.risk_accepted, current_user, decision.id
    )

    return {
        "status": "success",
        "message": "Audit logged to Zero-Trust Blockchain Ledger",
        "action": request.action,
        "decision_id": decision.id,
        "decided_by": current_user,
    }

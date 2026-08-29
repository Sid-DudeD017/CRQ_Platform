"""
CRQ Platform - FastAPI Central Gateway

Single entrypoint every other layer talks to: the frontend, quant-engine
(FAIR Monte Carlo + Knapsack), ai-agent (LangGraph), and the blockchain
audit webhook.

Merged from two branches off the same base (12462e7):
- Siddharth's pushes: richer /api/simulate-risk risk math driven off the
  CMDB/telemetry fields, the "blast radius" network-effective vulnerability
  calc, the SEBI Cyber Capability Index block, the RBI board_approved flag,
  and contextual DPDP triggering (PII assets with high effective
  vulnerability auto-flag DPDP applicability).
- This branch: the real (non-mock) LLM-backed /api/chat streaming fix, the
  real web3 blockchain client against a LOCAL Hardhat node (kept instead
  of Siddharth's Sepolia client for live-demo reliability - no wallet/RPC
  key/network dependency), and GET /api/audit-log backing the ledger page.
"""
import os
import sys
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlmodel import Session, select

from . import blockchain_client, generators, models
from .database import SessionLocal, get_db, init_db
from .security import authenticate_demo_user, create_access_token, get_current_user

# --- Add sibling directories to path to handle hyphens in folder names ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(os.path.join(project_root, "ai-agent"))

import monte_carlo as quant_mc
import optimizer as quant_opt
import graph as ai_graph

# Create the database tables at import time - several tests/ scripts do
# `from backend.main import app` and fire requests via TestClient(app)
# with no `with` block, which doesn't reliably trigger a startup event.
init_db()

app = FastAPI(
    title="CRQ Platform Backend",
    description="Central Router & Data Pipeline for AI-Powered Cyber Risk Quantification",
    version="1.1.0",
)

# Rate limiting - protects the unauthenticated, expensive/abusable endpoints
# (Monte Carlo simulation, the LLM-backed chat) now that this backend sits
# on a public URL. Keyed by client IP; limits are generous enough for a
# real demo user but stop a script from hammering the free-tier instance
# or burning through the Groq quota.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - explicit allowlist instead of "*". ALLOWED_ORIGINS is a
# comma-separated env var (set it on Render to your real Vercel domain);
# these two are sane defaults for local dev and the current deployment.
_default_origins = "http://localhost:3000,https://crq-platform.vercel.app"
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    board_approved: bool = False  # [RBI MANDATE] board oversight flag, recorded on-chain


@app.get("/")
def read_root():
    return {"message": "CRQ Platform API Gateway"}


@app.post("/api/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if not authenticate_demo_user(form_data.username, form_data.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(subject=form_data.username)
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/generate-mock-data")
def generate_mock_data(db: Session = Depends(get_db), current_user: str = Depends(get_current_user)):
    success, message = generators.populate_database(db)
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return {"status": "success", "message": message}


@app.get("/api/telemetry")
def get_telemetry(db: Session = Depends(get_db)):
    logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(100)
    ).all()
    if not logs:
        return {
            "status": "success",
            "data": [{
                "id": 1,
                "asset_id": "AST-000",
                "vulnerability_score": 8.5,
                "threat_level": "HIGH",
                "edr_status": "ACTIVE",
            }],
        }
    return {"status": "success", "data": logs}


@app.get("/api/topology")
def get_topology(db: Session = Depends(get_db)):
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
@limiter.limit("10/minute")
def simulate_risk(request: Request, payload: RiskSimRequest, db: Session = Depends(get_db)):
    assets = db.exec(select(models.Asset)).all()
    if not assets:
        raise HTTPException(status_code=400, detail="No assets found. Run /api/generate-mock-data first.")

    total_business_value = sum(a.business_value for a in assets)

    latest_logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(len(assets))
    ).all()
    if not latest_logs:
        latest_logs = []

    high_threat_count = sum(1 for log in latest_logs if log.threat_level in ("HIGH", "CRITICAL"))
    base_tef = 10.0 + (high_threat_count * 5.0)
    for log in latest_logs:
        base_tef += (log.event_frequency_24h * 0.001)
        base_tef += (log.anomalous_access_flags * 2.0)
        if log.cisa_kev_presence:
            base_tef += 50.0
        if log.incident_alert_level == "CRITICAL":
            base_tef += 20.0

    # --- BEGIN Blast Radius & Conditional Vulnerability ---
    asset_ids = [a.id for a in assets]
    index = {asset_id: i for i, asset_id in enumerate(asset_ids)}
    n = len(asset_ids)

    v_intrinsic = [5.0] * n
    log_by_asset = {log.asset_id: log for log in latest_logs}
    for i, asset in enumerate(assets):
        log = log_by_asset.get(asset.id)
        if log:
            v_intrinsic[i] = log.vulnerability_score

    matrix = [[0.0 for _ in range(n)] for _ in range(n)]
    edges = db.exec(select(models.NetworkEdge)).all()
    for edge in edges:
        i, j = index.get(edge.source_asset_id), index.get(edge.target_asset_id)
        if i is not None and j is not None:
            matrix[i][j] = edge.weight
            matrix[j][i] = edge.weight

    v_eff = [0.0] * n
    for i in range(n):
        neighbor_sum = sum(matrix[i][j] * v_intrinsic[j] for j in range(n))
        v_eff[i] = v_intrinsic[i] + (0.2 * neighbor_sum)  # 0.2 decay factor

    avg_vulnerability = sum(v_eff) / n if n > 0 else 5.0
    avg_cs_upstream = max(10.0, 100.0 - (avg_vulnerability * 10))
    # --- END Blast Radius ---

    deductions = 0.0
    for log in latest_logs:
        if not log.mfa_active:
            deductions += 5.0
        if log.excessive_permissions:
            deductions += 2.0
        if log.patch_status == "Missing Critical":
            deductions += (log.cvss_score or 10.0)
        if log.edr_health_status != "Healthy":
            deductions += 4.0
        if log.host_compromise_flags:
            deductions += 20.0
        if log.public_exposure_flag:
            deductions += 15.0
        deductions += (log.cloud_misconfigurations_count * 1.0)

    avg_cs = max(5.0, avg_cs_upstream - (deductions / max(1, len(latest_logs)) if latest_logs else 0))

    base_plm = total_business_value * 0.05
    base_slm = total_business_value * 0.02

    # --- BEGIN Contextual Statutory Triggers (DPDP Act) ---
    is_dpdp = False
    for i, asset in enumerate(assets):
        if asset.data_classification == "PII" and v_eff[i] > 7.0:
            is_dpdp = True
            break

    # Let request constraints override if specifically provided
    if payload.constraints and "is_dpdp_applicable" in payload.constraints:
        is_dpdp = payload.constraints["is_dpdp_applicable"]
    # --- END Contextual Triggers ---

    mc_results = quant_mc.run_fair_monte_carlo(
        tef_min=max(5.0, base_tef - 20), tef_mode=base_tef, tef_max=base_tef + 50,
        tc_min=20.0, tc_mode=60.0, tc_max=95.0,
        cs_min=max(5.0, avg_cs - 15), cs_mode=avg_cs, cs_max=min(100.0, avg_cs + 10),
        plm_min=base_plm * 0.5, plm_mode=base_plm, plm_max=base_plm * 2.0,
        slm_min=base_slm * 0.5, slm_mode=base_slm, slm_max=base_slm * 2.0,
        is_dpdp_applicable=is_dpdp,
    )

    # Named to match the "Strategic Controls" toggles on the dashboard
    # (frontend/src/app/page.tsx) exactly, so the frontend can highlight
    # whichever ones the optimizer actually recommends for the chosen
    # budget instead of those toggles being purely decorative.
    dummy_patches = [
        {"id": "Enforce Cloud MFA", "cost": 4500000, "risk_reduction": 18000000},
        {"id": "Patch Payment Gateway", "cost": 12000000, "risk_reduction": 40000000},
        {"id": "Zero Trust Architecture", "cost": 35000000, "risk_reduction": 90000000},
    ]
    opt_results = quant_opt.optimize_budget(dummy_patches, payload.budget)

    sim_record = models.RiskSimulation(
        expected_annual_loss=mc_results["mean_expected_loss"],
        var_95=mc_results.get("var_95"),
        monte_carlo_distribution=mc_results.get("distribution_curve", []),
        optimized_budget_allocation=opt_results,
        budget_used=payload.budget,
    )
    db.add(sim_record)
    db.commit()

    return {
        "status": "success",
        "message": "Risk simulation completed",
        "budget_used": payload.budget,
        "monte_carlo": {
            "mean_expected_loss": mc_results["mean_expected_loss"],
            "var_95": mc_results["var_95"],
            "distribution_curve": mc_results.get("distribution_curve", []),
        },
        "sebi_resilience": mc_results.get("sebi_resilience", {}),
        "optimization": opt_results,
    }


@app.post("/api/chat")
@limiter.limit("15/minute")
async def chat(request: Request, payload: ChatRequest):
    from langchain_core.messages import HumanMessage

    initial_state = {"messages": [HumanMessage(content=payload.message)]}

    async def event_stream():
        has_yielded = False
        try:
            async for event in ai_graph.app.astream_events(initial_state, version="v1"):
                kind = event["event"]
                data = event.get("data") or {}
                if kind == "on_chat_model_stream":
                    chunk = data.get("chunk")
                    content = getattr(chunk, "content", None) if chunk is not None else None
                    if content:
                        has_yielded = True
                        yield content
                elif kind == "on_chain_end":
                    if event["name"] in ["security_analyst", "compliance_officer", "quant_analyst", "supervisor"]:
                        output = data.get("output") or {}
                        msgs = output.get("messages", []) if isinstance(output, dict) else []
                        # Only send the sub-agent's full final answer if we
                        # have not already streamed anything for this turn
                        # via on_chat_model_stream above.
                        if msgs and not has_yielded:
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


def trigger_blockchain_webhook(action: str, risk: float, user: str, decision_id: int, board_approved: bool = False):
    """
    Commits the risk-acceptance decision to the AuditLedger smart contract
    on a local Hardhat chain, if one is running and the contract has been
    deployed (see blockchain_client.py). Falls back to a print()-only mock
    otherwise. Also records the RBI board_approved flag both on-chain and
    on the RiskDecision row.

    Runs as a BackgroundTask, i.e. after the HTTP response for /api/audit
    has already gone out - opens its own short-lived session to write the
    tx hash (or lack of one) back onto the same RiskDecision row, which is
    what GET /api/audit-log reads to show real on-chain status per decision.
    """
    data_hash = f"decision:{decision_id}|risk:{risk}"
    tx_hash = blockchain_client.log_risk_acceptance(
        action=action, data_hash=data_hash, user=user, board_approved=board_approved
    )
    if tx_hash:
        print(f"\n[BLOCKCHAIN AUDIT LOG] Committed on-chain to AuditLedger.sol. Tx hash: {tx_hash}")
    else:
        print(f"\n[BLOCKCHAIN AUDIT LOG] (mock - no local Hardhat chain reachable) Would commit to AuditLedger.sol!")
    print(f"User: {user} | Action: {action} | Risk Accepted: ${risk:,.2f} | Decision #{decision_id} | Board Approved: {board_approved}\n")

    with SessionLocal() as bg_db:
        decision = bg_db.get(models.RiskDecision, decision_id)
        if decision:
            decision.tx_hash = tx_hash
            decision.on_chain = bool(tx_hash)
            decision.board_approved = board_approved
            bg_db.add(decision)
            bg_db.commit()


@app.post("/api/audit")
def log_audit(
    request: AuditRequest,
    background_tasks: BackgroundTasks,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Trigger the blockchain smart contract to log a risk acceptance event.
    Requires a valid bearer token (POST /api/auth/login first). `decided_by`
    comes from the verified token, never from `request.user_id`.
    """
    decision = models.RiskDecision(
        action=request.action,
        risk_accepted=request.risk_accepted,
        decided_by=current_user,
        board_approved=request.board_approved,
    )
    db.add(decision)
    db.commit()
    db.refresh(decision)

    background_tasks.add_task(
        trigger_blockchain_webhook,
        request.action, request.risk_accepted, current_user, decision.id, request.board_approved,
    )

    return {
        "status": "success",
        "message": "Audit logged to Zero-Trust Blockchain Ledger",
        "action": request.action,
        "decision_id": decision.id,
        "decided_by": current_user,
        "board_approved": request.board_approved,
    }


@app.get("/api/audit-log")
def get_audit_log(db: Session = Depends(get_db)):
    """
    Lists every risk-acceptance decision on record, most recent first -
    backs the "View Detailed Ledger" page. Each row also reports whether
    it made it onto the local blockchain (tx_hash/on_chain) and whether
    board approval was recorded (board_approved).
    """
    decisions = db.exec(
        select(models.RiskDecision).order_by(models.RiskDecision.created_at.desc()).limit(200)
    ).all()
    return {"status": "success", "data": decisions}

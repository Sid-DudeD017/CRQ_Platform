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
from datetime import datetime
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

from . import blockchain_client, generators, ingestion_engine, models, risk_engine
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
    # Which "Strategic Controls" toggles (see risk_engine.SECURITY_CONTROLS ids)
    # are currently enabled on the dashboard - now actually fed into the
    # FAIR input derivation (see risk_engine.derive_fair_inputs) instead of
    # only ever affecting the separate budget-optimizer suggestion.
    active_controls: Optional[Dict[str, bool]] = None


class AuditRequest(BaseModel):
    action: str
    risk_accepted: float
    user_id: Optional[str] = None  # accepted for backward compat, but IGNORED now - see /api/audit
    board_approved: bool = False  # [RBI MANDATE] board oversight flag, recorded on-chain


class IngestParseRequest(BaseModel):
    filename: str
    content: str


class IngestConfirmRequest(BaseModel):
    filename: str
    line_number: int
    snippet: str
    parameter: str
    risk_tag: str
    confidence: float
    kind: str = "control_present"
    severity: str = "info"


class TrainingCompleteRequest(BaseModel):
    module: str  # one of risk_engine.TRAINING_MODULE_IDS


class IncidentLogRequest(BaseModel):
    """
    [Closed-Loop Calibration Engine] What POST /api/incidents accepts - the
    actual, after-the-fact outcome of one real (or near-miss) incident. See
    models.IncidentRecord for what's stored server-side beyond this
    (total_actual_loss, predicted_ale snapshot, prediction_error_pct,
    logged_by) - all computed here, never trusted from the request body.
    """
    incident_date: Optional[datetime] = None
    business_unit: Optional[str] = None
    vulnerability_class: str  # one of risk_engine.VULN_CLASSES
    control_involved: Optional[str] = None  # a risk_engine.SECURITY_CONTROLS id, if one applied
    was_contained: bool = False
    containment_pct: float = 0.0
    downtime_cost: float = 0.0
    recovery_cost: float = 0.0
    legal_cost: float = 0.0
    penalty_cost: float = 0.0
    notes: Optional[str] = None


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
    dpdp_override = None
    if payload.constraints and "is_dpdp_applicable" in payload.constraints:
        dpdp_override = payload.constraints["is_dpdp_applicable"]

    # [Closed-Loop Calibration Engine] read the current calibration state
    # (Bayesian control-effectiveness posteriors, vuln-class/business-unit
    # multipliers, loss-variance widening, uncertainty score - see
    # risk_engine.compute_calibration) BEFORE deriving this run's FAIR
    # inputs, so it can fold real incident outcomes back into this run
    # instead of asserting the same static assumptions every time.
    calibration = risk_engine.get_current_calibration(db)

    # Shared with the Virtual CISO chatbot's tools (ai-agent/tools.py) via
    # backend/risk_engine.py - see that module's docstring for why this is
    # no longer computed independently in two places.
    inputs = risk_engine.derive_fair_inputs(
        db, dpdp_override=dpdp_override, active_controls=payload.active_controls, calibration=calibration
    )
    if inputs is None:
        raise HTTPException(status_code=400, detail="No assets found. Run /api/generate-mock-data first.")

    # [Explainable Risk Attribution / Closed-Loop Calibration Engine]
    # risk_drivers and calibration both ride along in `inputs` for callers
    # that want them (see derive_fair_inputs' docstring), but
    # run_fair_monte_carlo only accepts the flat FAIR triangular-
    # distribution parameters - spreading the whole dict into it raised
    # "unexpected keyword argument 'risk_drivers'" on every single
    # simulation before that key was popped, and 'calibration' has the
    # exact same fixed-signature problem, so it must be popped here too.
    risk_drivers = inputs.pop("risk_drivers", {})
    inputs.pop("calibration", None)
    mc_results = quant_mc.run_fair_monte_carlo(**inputs)
    opt_results = quant_opt.optimize_budget(risk_engine.SECURITY_CONTROLS, payload.budget)
    business_unit_breakdown = risk_engine.compute_business_unit_breakdown(
        db, mc_results["mean_expected_loss"], calibration=calibration
    )

    # [Closed-Loop Calibration Engine] a confidence band around this run's
    # ALE, widening with calibration's uncertainty_score - a cold-start run
    # with zero incidents logged shows a wide +/-80% band; as real incident
    # data accumulates and the model's predictions prove consistent,
    # uncertainty_score falls and the band tightens toward +/-15%.
    uncertainty_score = calibration.get("uncertainty_score", 100.0)
    confidence_band_pct = min(80.0, 15.0 + uncertainty_score * 0.65)
    confidence_band = {
        "ale_low": max(0.0, mc_results["mean_expected_loss"] * (1 - confidence_band_pct / 100.0)),
        "ale_high": mc_results["mean_expected_loss"] * (1 + confidence_band_pct / 100.0),
        "band_pct": round(confidence_band_pct, 1),
        "uncertainty_score": uncertainty_score,
        "incident_count": calibration.get("incident_count", 0),
    }
    # [ISO/IEC 27001 & CIS Controls v8 mapping] see
    # risk_engine.build_framework_coverage - a real per-control crosswalk
    # against this run's actual active_controls, not a static reference
    # table.
    framework_coverage = risk_engine.build_framework_coverage(payload.active_controls)

    sim_record = models.RiskSimulation(
        expected_annual_loss=mc_results["mean_expected_loss"],
        var_95=mc_results.get("var_95"),
        var_99=mc_results.get("var_99"),
        monte_carlo_distribution=mc_results.get("distribution_curve", []),
        optimized_budget_allocation=opt_results,
        budget_used=payload.budget,
        active_controls=payload.active_controls or {},
        sebi_resilience=mc_results.get("sebi_resilience", {}),
        risk_drivers=risk_drivers,
        framework_coverage=framework_coverage,
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
        "business_unit_breakdown": business_unit_breakdown,
        # [Explainable Risk Attribution] the named Control Strength/TEF
        # waterfall components behind this run's numbers - see
        # risk_engine.derive_fair_inputs' risk_drivers dict for what each
        # field means. Powers the Overview waterfall panel and the
        # proactive "risk just moved, here's why" callout.
        "risk_drivers": risk_drivers,
        # [ISO/IEC 27001 & CIS Controls v8 mapping] per-control NIST CSF /
        # ISO 27001 / CIS Controls crosswalk for this run's active_controls.
        # Powers the Reports page's Framework Coverage Matrix.
        "framework_coverage": framework_coverage,
        # [Closed-Loop Calibration Engine] the full calibration state this
        # run was computed against, plus the confidence band it implies
        # around this run's ALE - see risk_engine.compute_calibration and
        # the confidence_band comment above.
        "calibration": calibration,
        "confidence_band": confidence_band,
    }


@app.get("/api/simulations")
def get_simulations(limit: int = 30, db: Session = Depends(get_db)):
    """
    Recent /api/simulate-risk runs, most recent first - the "detailed
    analysis ledger" behind the Reports page. Each row is a real persisted
    RiskSimulation (previously write-only: every simulation was saved but
    nothing ever read the table back). The Monte Carlo distribution curve
    is left out here (it's large and only meaningful per-run on Overview);
    everything a run-over-run trend comparison needs - ALE, VaR, budget,
    which Strategic Controls were active, the SEBI five-pillar score, and
    the named risk_drivers waterfall (Explainable Risk Attribution) - is
    included so the frontend can diff consecutive runs itself, down to
    which specific driver moved, rather than the backend guessing at
    causality.
    """
    rows = db.exec(
        select(models.RiskSimulation).order_by(models.RiskSimulation.timestamp.desc()).limit(limit)
    ).all()
    return {
        "status": "success",
        "count": len(rows),
        "data": [
            {
                "id": r.id,
                "timestamp": r.timestamp,
                "expected_annual_loss": r.expected_annual_loss,
                "var_95": r.var_95,
                "var_99": r.var_99,
                "budget_used": r.budget_used,
                "active_controls": r.active_controls or {},
                "optimized_budget_allocation": r.optimized_budget_allocation or {},
                "sebi_resilience": r.sebi_resilience or {},
                "risk_drivers": r.risk_drivers or {},
                "framework_coverage": r.framework_coverage or [],
            }
            for r in rows
        ],
    }


@app.post("/api/ingest/parse")
@limiter.limit("20/minute")
def ingest_parse(request: Request, payload: IngestParseRequest):
    """
    Runs the uploaded config text through ingestion_engine.parse_config and
    returns every real finding it locates - line number, matched snippet,
    suggested standard parameter, risk tag, and a confidence that varies
    per rule (never a flat constant). Read-only: nothing is persisted here,
    so re-uploading the same file is always safe to preview.
    """
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    findings = ingestion_engine.parse_config(payload.content)
    return {
        "status": "success",
        "filename": payload.filename,
        "raw_content": payload.content,
        "findings": [
            {
                "line_number": f.line_number,
                "snippet": f.snippet,
                "parameter": f.parameter,
                "risk_tag": f.risk_tag,
                "confidence": f.confidence,
                "kind": f.kind,
                "severity": f.severity,
                "rationale": f.rationale,
            }
            for f in findings
        ],
    }


@app.post("/api/ingest/confirm")
def ingest_confirm(
    request: IngestConfirmRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Persists one confirmed mapping - this is what "Confirm Mapping" is
    actually supposed to do (train the model on this pairing), versus the
    old UI which showed a toast and discarded the mapping immediately.
    Requires a valid bearer token, same as /api/audit, so every trained
    mapping is attributable to a real logged-in reviewer.
    """
    mapping = models.IngestedMapping(
        filename=request.filename,
        line_number=request.line_number,
        snippet=request.snippet,
        parameter=request.parameter,
        risk_tag=request.risk_tag,
        confidence=request.confidence,
        kind=request.kind,
        severity=request.severity,
        confirmed_by=current_user,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return {"status": "success", "mapping_id": mapping.id}


@app.get("/api/ingest/mappings")
def ingest_mappings(db: Session = Depends(get_db)):
    """All confirmed mappings ever trained, most recent first - backs the
    "Trained Parameters" count on the Ingestion Engine page."""
    mappings = db.exec(
        select(models.IngestedMapping).order_by(models.IngestedMapping.created_at.desc()).limit(500)
    ).all()
    return {"status": "success", "count": len(mappings), "data": mappings}


@app.post("/api/training/complete")
def training_toggle_complete(
    request: TrainingCompleteRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Toggles completion of one Training page module for the logged-in user:
    marks it complete if there's no existing record for (module,
    current_user), or removes the existing one if there is - lets a demo
    account flip a module back off without needing a separate "undo"
    endpoint. Requires a valid bearer token, same as /api/audit, so every
    completion is attributable to a real logged-in user, never spoofable
    via the request body.
    """
    if request.module not in risk_engine.TRAINING_MODULE_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown training module: {request.module}")

    existing = db.exec(
        select(models.TrainingRecord).where(
            models.TrainingRecord.module == request.module,
            models.TrainingRecord.completed_by == current_user,
        )
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        return {"status": "success", "module": request.module, "completed": False}

    record = models.TrainingRecord(module=request.module, completed_by=current_user)
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"status": "success", "module": request.module, "completed": True}


@app.get("/api/training/progress")
def training_progress(db: Session = Depends(get_db)):
    """
    Every logged module completion, plus a per-module summary (how many
    distinct users have completed each of the 5 canonical modules) - backs
    the Training page's progress chart and per-module checkmarks. The same
    org-wide coverage this computes is what derive_fair_inputs() folds
    into a real Control Strength boost (see risk_engine.py) - so marking a
    module complete here is what actually moves the Overview dashboard's
    ALE, not just a checkbox on this page.
    """
    records = db.exec(
        select(models.TrainingRecord).order_by(models.TrainingRecord.completed_at.desc())
    ).all()
    by_module: Dict[str, list] = {module_id: [] for module_id in risk_engine.TRAINING_MODULE_IDS}
    for r in records:
        if r.module in by_module:
            by_module[r.module].append(r.completed_by)
    summary = [
        {"module": module_id, "completed_by": sorted(set(users)), "completed_count": len(set(users))}
        for module_id, users in by_module.items()
    ]
    covered = sum(1 for row in summary if row["completed_count"] > 0)
    return {
        "status": "success",
        "data": records,
        "summary": summary,
        "coverage_pct": round(100 * covered / len(risk_engine.TRAINING_MODULE_IDS), 1),
    }


@app.post("/api/incidents")
@limiter.limit("20/minute")
def log_incident(
    request: Request,
    payload: IncidentLogRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    [Closed-Loop "Prediction vs. Actual Loss" Calibration Engine] Logs one
    real (or near-miss) incident's actual costs - the ground truth every
    prior FAIR prediction gets checked against. Snapshots the most recent
    RiskSimulation's predicted ALE at logging time (so prediction_error_pct
    is computed once here and never drifts if later runs change the
    "current" ALE), recomputes calibration over the full incident history
    including this one, and persists a CalibrationSnapshot so GET
    /api/calibration can show a trend. Requires a valid bearer token, same
    as /api/audit and /api/training/complete, so every incident is
    attributable to a real logged-in user, never spoofable via the request
    body.
    """
    if payload.vulnerability_class not in risk_engine.VULN_CLASSES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown vulnerability_class: {payload.vulnerability_class}. Must be one of {risk_engine.VULN_CLASSES}",
        )
    known_control_ids = {c["id"] for c in risk_engine.SECURITY_CONTROLS}
    if payload.control_involved and payload.control_involved not in known_control_ids:
        raise HTTPException(status_code=400, detail=f"Unknown control_involved: {payload.control_involved}")

    total_actual_loss = (
        payload.downtime_cost + payload.recovery_cost + payload.legal_cost + payload.penalty_cost
    )

    latest_sim = db.exec(
        select(models.RiskSimulation).order_by(models.RiskSimulation.timestamp.desc())
    ).first()
    predicted_ale = latest_sim.expected_annual_loss if latest_sim else None
    prediction_error_pct = None
    if predicted_ale:
        prediction_error_pct = ((total_actual_loss - predicted_ale) / predicted_ale) * 100.0

    record = models.IncidentRecord(
        incident_date=payload.incident_date or datetime.utcnow(),
        business_unit=payload.business_unit,
        vulnerability_class=payload.vulnerability_class,
        control_involved=payload.control_involved,
        was_contained=payload.was_contained,
        containment_pct=payload.containment_pct,
        downtime_cost=payload.downtime_cost,
        recovery_cost=payload.recovery_cost,
        legal_cost=payload.legal_cost,
        penalty_cost=payload.penalty_cost,
        total_actual_loss=total_actual_loss,
        predicted_ale_source_run_id=latest_sim.id if latest_sim else None,
        predicted_ale_at_time=predicted_ale,
        prediction_error_pct=prediction_error_pct,
        notes=payload.notes,
        logged_by=current_user,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    calibration = risk_engine.get_current_calibration(db)
    snapshot = models.CalibrationSnapshot(
        incident_id=record.id,
        incident_count=calibration["incident_count"],
        control_effectiveness=calibration["control_effectiveness"],
        vuln_class_multipliers=calibration["vuln_class_multipliers"],
        business_unit_multipliers=calibration["business_unit_multipliers"],
        loss_variance_multiplier=calibration["loss_variance_multiplier"],
        mean_prediction_error_pct=calibration["mean_prediction_error_pct"],
        stdev_prediction_error_pct=calibration["stdev_prediction_error_pct"],
        uncertainty_score=calibration["uncertainty_score"],
    )
    db.add(snapshot)
    db.commit()

    return {"status": "success", "incident": record, "calibration": calibration}


@app.get("/api/incidents")
def get_incidents(limit: int = 50, db: Session = Depends(get_db)):
    """
    Every logged incident, most recent first - backs the calibration page's
    incident log and prediction-error trend.
    """
    rows = db.exec(
        select(models.IncidentRecord).order_by(models.IncidentRecord.logged_at.desc()).limit(limit)
    ).all()
    return {"status": "success", "count": len(rows), "data": rows}


@app.get("/api/calibration")
def get_calibration(db: Session = Depends(get_db)):
    """
    The Closed-Loop Calibration Engine's current state - calibrated
    control-effectiveness posteriors (with 95% confidence intervals),
    vulnerability-class and business-unit multipliers, the loss-variance
    widening factor, and a model uncertainty score (see
    risk_engine.compute_calibration) - plus the full CalibrationSnapshot
    trend so the calibration page can show uncertainty falling and
    confidence intervals narrowing as real incident data accumulates,
    rather than just the latest snapshot in isolation.
    """
    calibration = risk_engine.get_current_calibration(db)
    trend = db.exec(
        select(models.CalibrationSnapshot).order_by(models.CalibrationSnapshot.timestamp.asc())
    ).all()
    return {"status": "success", "calibration": calibration, "trend": trend}


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


@app.delete("/api/audit-log")
def clear_audit_log(
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Demo/dev utility: wipes every RiskDecision row so the ledger (and the
    "Committed On-Chain" counter) can be reset back to 0 without touching
    the database by hand between test runs. Requires a valid bearer token,
    same as POST /api/audit - not exposed to anonymous callers.
    """
    decisions = db.exec(select(models.RiskDecision)).all()
    count = len(decisions)
    for decision in decisions:
        db.delete(decision)
    db.commit()
    return {"status": "success", "deleted": count}
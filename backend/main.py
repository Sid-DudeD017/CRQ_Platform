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
import hashlib
import json
import logging
import math
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import UploadFile, File, BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import blockchain_client, generators, ingestion_engine, models, observability, retention, risk_engine
from .database import SessionLocal, get_db, init_db
from .security import (
    DEMO_ACCOUNTS_ENABLED,
    DEMO_USERS,
    authenticate_demo_user,
    create_access_token,
    get_current_user,
    get_current_user_optional,
    hash_password,
    is_admin,
    require_admin,
    verify_password,
)

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

# [Public demo credentials exposed - fix / RBAC] Lightweight audit trail
# for the handful of admin-only actions that affect every visitor at once
# (regenerating/wiping the shared demo fleet, wiping the shared ledger) -
# "confirmed, and audited" from the original fix list. Not a persisted
# audit-of-audits table (that's a bigger lift than this pass needs given
# RiskDecision already IS the real audit trail for risk decisions
# specifically) - just a real, timestamped, queryable server log line for
# who triggered a destructive/shared-state action and when.
# [Observability fix] JSON structured logs instead of plain text - see
# observability.py's module docstring for why this is a hand-rolled
# formatter rather than a SaaS log-shipper integration.
observability.configure_structured_logging(level=logging.INFO)
admin_actions_logger = logging.getLogger("crq.admin_actions")
# [Observability fix] Parallel to admin_actions_logger above, but for
# ordinary per-user actions worth a durable audit trail in the logs
# even though RiskDecision already IS the real audit-of-record for risk
# acceptances specifically (see admin_actions_logger's own comment) -
# this covers the actions that AREN'T already a RiskDecision row:
# ledger clears, on-chain commits, ingestion mapping confirmations,
# training completions.
audit_events_logger = logging.getLogger("crq.audit_events")
request_logger = logging.getLogger("crq.requests")

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
# [Product improvement #12 - staging environment] Which deployment this
# process is - 'development' (local, the default), 'staging', or
# 'production'. Purely informational today (surfaced on GET /api/status
# and logged alongside admin actions below) rather than gating any
# behavior - the actual isolation between environments comes from each
# one having its own DATABASE_URL/SECRET_KEY/blockchain node/demo data,
# not from a code branch on this value. See render.yaml and
# docs/STAGING.md for the full setup.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()

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

# [API security review] This is a bearer-token JSON API - the frontend
# sends the JWT in an Authorization header it reads from memory/
# localStorage, never a cookie, and CORS above already runs with
# allow_credentials=False against an explicit origin allowlist. That
# combination means there is no ambient credential a third-party page
# could get the browser to attach automatically, which is what CSRF
# actually depends on - so a CSRF token has nothing to protect here
# that the Authorization-header + no-cookie design doesn't already
# rule out. What a JSON API over HTTP genuinely benefits from is a
# small set of response headers browsers use to harden how ANY
# response (including error pages, docs, or a future HTML route) gets
# handled - none of these were being set before this fix.
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    # [Observability fix] One request-scoped timer covers both the
    # latency metric (observability.record_request) and the structured
    # per-request log line below - added here rather than a second
    # middleware so there's exactly one place wrapping call_next.
    with observability.Timer() as timer:
        response = await call_next(request)
    route_template = request.url.path
    route_obj = request.scope.get("route")
    if route_obj is not None and getattr(route_obj, "path", None):
        # Prefer the matched route TEMPLATE ('/api/audit-log/{decision_id}/commit-chain')
        # over the raw path so per-ID/per-account requests aggregate into
        # one metric series instead of one per unique ID ever requested.
        route_template = route_obj.path
    observability.record_request(request.method, route_template, response.status_code, timer.duration_ms)
    request_logger.info(
        "request",
        extra={
            "http_method": request.method,
            "http_route": route_template,
            "http_status": response.status_code,
            "duration_ms": round(timer.duration_ms, 2),
            "client_ip": request.client.host if request.client else None,
        },
    )
    # Stop browsers from MIME-sniffing a response into something more
    # dangerous than its declared Content-Type (e.g. treating a JSON
    # error body as HTML/script).
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Nothing this API returns should ever render inside another
    # site's frame - blocks clickjacking of any HTML this backend ever
    # serves (docs, error pages).
    response.headers["X-Frame-Options"] = "DENY"
    # Don't leak the full referring URL (which can carry query-string
    # data) to a different origin; still send the origin on same-
    # origin/HTTPS navigations.
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # This API doesn't use any browser feature that needs opting in to
    # (camera, mic, geolocation, etc.) - explicitly deny all of them so
    # an embedding page can't silently grant itself access via this
    # origin's policy.
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    # Once a deployment is on HTTPS (Render/Vercel both are), this
    # tells browsers to remember that and never downgrade to plain
    # HTTP for this host again. Harmless to send over local HTTP dev -
    # browsers only ever act on it when the response itself came over
    # HTTPS.
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


class ChatRequest(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None
    # Which dashboard the user was chatting from - "predefined" (demo
    # fleet) or "own" (their ingested data). Previously the chat pipeline
    # never asked for this at all, so the Virtual CISO's tools (see
    # ai-agent/tools.py) always queried the demo fleet's data regardless of
    # which dashboard the question came from - a user on the Own Data /
    # Ingestion dashboard asking the AI about their own risk would silently
    # get demo numbers back.
    data_source: str = "predefined"


class RiskSimRequest(BaseModel):
    # [API security review / input validation] Previously an unbounded
    # float - a negative budget flows straight into the optimizer's
    # knapsack math with undefined behavior, and an absurd one (1e300)
    # can overflow the Monte Carlo triangular draws downstream. 0 stays
    # valid (the budget slider's own minimum), and the upper bound is
    # deliberately generous (10,000 Cr) - well past any realistic
    # security budget - so it only ever rejects clearly-bad input, never
    # a real one.
    budget: float = Field(ge=0, le=1e11)
    constraints: Optional[Dict[str, Any]] = None
    # Which "Strategic Controls" toggles (see risk_engine.SECURITY_CONTROLS ids)
    # are currently enabled on the dashboard - now actually fed into the
    # FAIR input derivation (see risk_engine.derive_fair_inputs) instead of
    # only ever affecting the separate budget-optimizer suggestion.
    active_controls: Optional[Dict[str, bool]] = None
    # [Own-Data / Demo isolation] Which dashboard is asking - 'predefined'
    # (demo Overview) or 'own' (Ingestion Engine). Overview and Ingestion
    # each always send their own fixed value, same convention as
    # AuditRequest.data_source below - it's what lets derive_fair_inputs
    # read two genuinely separate Asset/TelemetryLog pools instead of one
    # shared global one. See risk_engine.derive_fair_inputs' data_source
    # param for the full story.
    data_source: str = "predefined"


class AuditRequest(BaseModel):
    action: str
    risk_accepted: float
    user_id: Optional[str] = None  # accepted for backward compat, but IGNORED now - see /api/audit
    board_approved: bool = False  # [RBI MANDATE] board oversight flag, recorded on-chain
    # [Separate ledgers per dashboard] Which dashboard this decision came
    # from - 'predefined' (demo Overview) or 'own' (Ingestion Engine).
    # Overview and the Ingestion Engine each always send their own fixed
    # value (they know unambiguously which one they are), so this isn't
    # user-editable input - it just keeps demo and own-data acceptances
    # from landing in the same undifferentiated ledger. See
    # models.RiskDecision.data_source and GET /api/audit-log.
    data_source: str = "predefined"
    # [Risk Decision Passport] optional context from the simulation this
    # decision is based on. All genuinely optional (old callers/tests that
    # only send action/risk_accepted still work exactly as before) - when
    # residual_ale/p95/active_controls are given, the server computes a
    # real evidence hash, unfunded-control comparison, and scenario
    # snapshot from them; none of this is trusted as-is from the client
    # except reason, which is real free text, and residual_ale/p95/
    # accepted_scenario, which are read directly off the same simResults
    # object already displayed on screen (not independently recomputed,
    # since re-simulating here could legitimately return different numbers
    # than what the user actually looked at when they clicked Accept).
    residual_ale: Optional[float] = None
    p95: Optional[float] = None
    accepted_scenario: Optional[str] = None
    active_controls: Optional[Dict[str, bool]] = None
    budget: Optional[float] = None
    reason: Optional[str] = None


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


@app.get("/api/status")
def get_status(db: Session = Depends(get_db)):
    """
    [No degraded-mode / service-health feedback - fix] Real, live health
    for the three external dependencies almost every page silently assumed
    were always up. Previously a database outage, a missing LLM API key,
    or an unreachable local blockchain node all surfaced only indirectly -
    a generic "Error contacting backend" toast, or (for the AI agent) a
    silent drop to keyword-only routing with no visible signal at all -
    leaving a visitor unable to tell which dependency was the problem or
    whether retrying would even help. This is deliberately unauthenticated
    and cheap (one trivial query, two in-memory/lazy-connection checks) so
    every page can poll it without a login or real cost.
    """
    try:
        db.exec(select(models.Asset).limit(1)).all()
        database_status = "ok"
    except Exception as e:
        database_status = "error"

    ai_status = "configured" if ai_graph.llm is not None else "fallback"
    blockchain_status = "connected" if blockchain_client.is_available() else "unavailable"

    return {
        "status": "ok" if database_status == "ok" else "degraded",
        "database": database_status,
        "ai_agent": ai_status,
        "blockchain": blockchain_status,
        "timestamp": datetime.utcnow().isoformat(),
        # [Product improvement #12 - staging environment] Surfaces which
        # deployment this response came from - set ENVIRONMENT on each
        # Render service (see render.yaml's staging block) so a "why does
        # staging behave differently" question can be answered by hitting
        # /api/status instead of trusting whichever URL is in the address
        # bar. Defaults to 'development' for local runs, where it's never
        # set.
        "environment": ENVIRONMENT,
    }


@app.get("/api/metrics")
def get_metrics():
    """
    [Observability fix] Plain Prometheus text-exposition output - request
    counts/latency by route, simulation success/failure counts, and
    reported frontend error counts (see observability.py). Deliberately
    unauthenticated, matching /api/status above: nothing here is
    per-account or sensitive (aggregate counters only, no request bodies,
    no user identities), and a metrics-scrape endpoint that requires a
    login token can't actually be scraped by a standard
    Prometheus/Grafana Agent config.
    """
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(observability.render_prometheus_text())


class ClientErrorReport(BaseModel):
    message: str
    stack: Optional[str] = None
    url: Optional[str] = None
    user_agent: Optional[str] = None


@app.post("/api/client-error")
@limiter.limit("30/minute")
def report_client_error(
    request: Request,
    payload: ClientErrorReport,
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """
    [Observability fix] Frontend error tracking without a third-party APM
    key: the frontend's global window.onerror/unhandledrejection handler
    (see frontend/src/lib/errorTracking.ts) posts here so a client-side
    crash is at least visible in this backend's own structured logs and
    counted in /api/metrics, instead of only ever existing in a browser
    console nobody on the team will see. No auth required (a crash can
    happen before login); rate-limited so a page stuck in an error loop
    can't hammer this endpoint. Never persisted to the database - this is
    a log/metric sink, not a bug tracker.
    """
    observability.record_client_error()
    logging.getLogger("crq.frontend_errors").error(
        "frontend_error",
        extra={
            "client_message": payload.message[:2000],
            "client_stack": (payload.stack or "")[:4000],
            "client_url": payload.url,
            "client_user_agent": payload.user_agent,
            "reported_by": current_user,
        },
    )
    return {"status": "logged"}


class SignupRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


@app.post("/api/auth/login")
@limiter.limit("20/minute")
# [API security review] Previously unrated - the single most valuable
# endpoint to brute-force (real account passwords AND the two demo
# account passwords) had no throttle at all.
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Two account types can log in through this one endpoint: the two
    # fixed demo exec accounts (backend/security.py's DEMO_USERS, kept for
    # the existing "Demo CISO / Demo CFO" quick-login buttons) and real
    # accounts created via POST /api/auth/signup below. Demo check first
    # since it's a plain dict lookup; only touches the database if that
    # misses.
    username = form_data.username.strip()
    if authenticate_demo_user(username, form_data.password):
        token = create_access_token(subject=username)
        return {"access_token": token, "token_type": "bearer"}

    email = username.lower()
    user = db.exec(select(models.User).where(models.User.email == email)).first()
    if user and verify_password(form_data.password, user.hashed_password):
        token = create_access_token(subject=user.email)
        return {"access_token": token, "token_type": "bearer", "email": user.email, "name": user.name}

    raise HTTPException(status_code=401, detail="Incorrect email/username or password")


class DemoLoginRequest(BaseModel):
    role: str


@app.post("/api/auth/demo-login")
@limiter.limit("30/minute")
def demo_login(request: Request, payload: DemoLoginRequest):
    """
    [Public demo credentials exposed - fix] The "Login as CISO / Login as
    CFO" one-click buttons used to POST the real demo password (hardcoded
    in frontend/src/context/AuthContext.tsx AND printed on the public
    Support page) to /api/auth/login. That meant the demo credentials were
    always sitting in the shipped JS bundle and in plain view on a page
    anyone could open, regardless of how well the passwords themselves
    were guarded server-side.

    This endpoint takes just a role name - no password crosses the wire or
    lives in the client bundle at all - and only ever issues a token for
    one of the two fixed demo identities, gated by DEMO_ACCOUNTS_ENABLED
    (see security.py) so a real deployment can turn demo access off
    entirely. POST /api/auth/login's password-based demo path still exists
    for anyone following the API docs manually (curl, Postman) - both
    paths are subject to the same enabled flag.
    """
    if not DEMO_ACCOUNTS_ENABLED:
        raise HTTPException(status_code=403, detail="Demo accounts are disabled on this deployment.")
    role = payload.role.strip().lower()
    if role not in DEMO_USERS:
        raise HTTPException(status_code=400, detail=f"Unknown demo role '{payload.role}'. Expected 'ciso' or 'cfo'.")
    token = create_access_token(subject=role)
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/auth/signup")
@limiter.limit("10/minute")
# [API security review] Previously unrated - unlimited signups meant
# unlimited bcrypt hashing (a real CPU-exhaustion vector) and unlimited
# probing of the "account already exists" 409 to enumerate real emails.
def signup(request: Request, payload: SignupRequest, db: Session = Depends(get_db)):
    """Creates a real, persisted account (hashed password, never stored in
    plaintext) so a visitor can register once and log back in later - see
    module docstring in models.User. Auto-logs them in on success so
    signup -> straight into the dashboard in one step."""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    existing = db.exec(select(models.User).where(models.User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists. Try logging in instead.")

    user = models.User(email=email, hashed_password=hash_password(payload.password), name=(payload.name or None))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer", "email": user.email, "name": user.name}


# --- Data lifecycle: self-service export and deletion -------------------
# [Product improvement #10] Own-data rows (assets, telemetry, simulations,
# decisions, ingested mappings, incident records, training completions)
# are all scoped by owner_email/logged_by/completed_by exactly like every
# other "own data" read elsewhere in this file - these two endpoints are
# just that same scoping applied to "give it all back to me" and "delete
# all of it", the two DPDP/GDPR-style rights this app didn't have any
# self-service path for before.

@app.get("/api/account/export")
def export_account_data(current_user: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Returns every row this account owns, across every own-data table, as
    one JSON document - a real, complete data export rather than a
    per-page CSV download. Demo accounts (ciso/cfo) get their own-data
    rows (if they've used "Enter your own data" while logged in as a demo
    identity) but no account record, since DEMO_USERS isn't a real,
    deletable account.
    """
    user_row = db.exec(select(models.User).where(models.User.email == current_user)).first()
    account = {
        "identifier": current_user,
        "email": user_row.email if user_row else None,
        "name": user_row.name if user_row else None,
        "account_created_at": user_row.created_at.isoformat() if user_row else None,
        "account_type": "registered" if user_row else ("demo" if current_user in DEMO_USERS else "unknown"),
    }
    assets = db.exec(select(models.Asset).where(models.Asset.data_source == "own", models.Asset.owner_email == current_user)).all()
    telemetry = db.exec(select(models.TelemetryLog).where(models.TelemetryLog.data_source == "own", models.TelemetryLog.owner_email == current_user)).all()
    simulations = db.exec(select(models.RiskSimulation).where(models.RiskSimulation.data_source == "own", models.RiskSimulation.owner_email == current_user)).all()
    decisions = db.exec(select(models.RiskDecision).where(models.RiskDecision.data_source == "own", models.RiskDecision.owner_email == current_user)).all()
    mappings = db.exec(select(models.IngestedMapping).where(models.IngestedMapping.data_source == "own", models.IngestedMapping.owner_email == current_user)).all()
    incidents = db.exec(select(models.IncidentRecord).where(models.IncidentRecord.logged_by == current_user)).all()
    training = db.exec(select(models.TrainingRecord).where(models.TrainingRecord.completed_by == current_user)).all()
    chat_feedback = db.exec(select(models.ChatFeedback).where(models.ChatFeedback.rated_by == current_user)).all()

    audit_events_logger.info("account data export requested by %s", current_user)
    return {
        "status": "success",
        "exported_at": datetime.utcnow().isoformat(),
        "account": account,
        "data": {
            "assets": assets,
            "telemetry_logs": telemetry,
            "simulations": simulations,
            "risk_decisions": decisions,
            "ingested_mappings": mappings,
            "incident_records": incidents,
            "training_completions": training,
            "chat_feedback": chat_feedback,
        },
    }


class AccountDeletionRequest(BaseModel):
    confirm: bool = False


@app.delete("/api/account")
def delete_account(payload: AccountDeletionRequest, current_user: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Permanently deletes every own-data row this account owns, and (for a
    real registered account - never for the two shared demo identities)
    the account itself. Requires an explicit confirm=true in the request
    body rather than acting on the DELETE verb alone, since this is one
    of this app's few genuinely irreversible actions and the frontend
    should always be showing its own "are you sure" step before ever
    sending confirm=true.
    """
    if not payload.confirm:
        raise HTTPException(
            status_code=400,
            detail=(
                "Set confirm=true to proceed. This permanently deletes every 'own data' row "
                "you've created (assets, telemetry, simulations, risk decisions, ingested "
                "mappings, incident records, training completions, chat feedback ratings)"
                + (" and your account itself" if current_user not in DEMO_USERS else "")
                + ". Shared demo data and other accounts' data are never affected, and this "
                "cannot be undone - use GET /api/account/export first if you want a copy."
            ),
        )

    def _delete_all(model_cls, *conditions) -> int:
        rows = db.exec(select(model_cls).where(*conditions)).all()
        for row in rows:
            db.delete(row)
        return len(rows)

    deleted_counts = {
        "assets": _delete_all(models.Asset, models.Asset.data_source == "own", models.Asset.owner_email == current_user),
        "telemetry_logs": _delete_all(models.TelemetryLog, models.TelemetryLog.data_source == "own", models.TelemetryLog.owner_email == current_user),
        "simulations": _delete_all(models.RiskSimulation, models.RiskSimulation.data_source == "own", models.RiskSimulation.owner_email == current_user),
        "risk_decisions": _delete_all(models.RiskDecision, models.RiskDecision.data_source == "own", models.RiskDecision.owner_email == current_user),
        "ingested_mappings": _delete_all(models.IngestedMapping, models.IngestedMapping.data_source == "own", models.IngestedMapping.owner_email == current_user),
        "incident_records": _delete_all(models.IncidentRecord, models.IncidentRecord.logged_by == current_user),
        "training_completions": _delete_all(models.TrainingRecord, models.TrainingRecord.completed_by == current_user),
        "chat_feedback": _delete_all(models.ChatFeedback, models.ChatFeedback.rated_by == current_user),
    }

    account_deleted = False
    if current_user not in DEMO_USERS:
        user_row = db.exec(select(models.User).where(models.User.email == current_user)).first()
        if user_row:
            db.delete(user_row)
            account_deleted = True

    db.commit()
    admin_actions_logger.info("account deletion by %s: %s (account row deleted: %s)", current_user, deleted_counts, account_deleted)
    return {
        "status": "success",
        "message": (
            "Your data has been permanently deleted."
            + (" Your account was also removed - sign up again to use Own Data mode." if account_deleted else "")
        ),
        "deleted_counts": deleted_counts,
        "account_deleted": account_deleted,
    }


class PurgeStaleDataRequest(BaseModel):
    older_than_days: int = Field(default=retention.DEFAULT_RETENTION_DAYS, ge=30, le=3650)


@app.post("/api/admin/purge-stale-data")
def purge_stale_data(payload: PurgeStaleDataRequest, current_user: str = Depends(require_admin), db: Session = Depends(get_db)):
    """
    [Data lifecycle #10 - retention] Admin-only maintenance action: deletes
    TelemetryLog/RiskSimulation rows older than `older_than_days` (default
    from retention.DEFAULT_RETENTION_DAYS). Deliberately never touches the
    RiskDecision audit ledger or IncidentRecord calibration data - see
    retention.py's module docstring for why. There's no background
    scheduler running this automatically; see the README's Data Lifecycle
    section for wiring this up to an external cron against a real
    deployment.
    """
    deleted_counts = retention.purge_stale_operational_data(db, older_than_days=payload.older_than_days)
    admin_actions_logger.info("stale-data purge by %s (older_than_days=%s): %s", current_user, payload.older_than_days, deleted_counts)
    return {"status": "success", "older_than_days": payload.older_than_days, "deleted_counts": deleted_counts}


@app.get("/api/admin/success-metrics")
def get_success_metrics(current_user: str = Depends(require_admin), db: Session = Depends(get_db)):
    """
    [Product improvement #15 - success metrics] Computes every metric from
    the original punch list from data this app already persists - no
    separate analytics pipeline, consistent with docs/PRIVACY.md's "no
    analytics integration" stance. See docs/SUCCESS_METRICS.md for what
    each field means and its known caveats (several are proxies, clearly
    labeled as such, not exact measurements).
    """
    import statistics

    users = db.exec(select(models.User)).all()
    own_sims = db.exec(
        select(models.RiskSimulation).where(
            models.RiskSimulation.data_source == "own", models.RiskSimulation.owner_email.is_not(None)
        )
    ).all()
    first_sim_by_owner: Dict[str, datetime] = {}
    for s in own_sims:
        if s.owner_email not in first_sim_by_owner or s.timestamp < first_sim_by_owner[s.owner_email]:
            first_sim_by_owner[s.owner_email] = s.timestamp

    onboarded_count = sum(1 for u in users if u.email in first_sim_by_owner)
    onboarding_completion_rate = (onboarded_count / len(users)) if users else None

    time_to_first_sim_seconds = [
        (first_sim_by_owner[u.email] - u.created_at).total_seconds()
        for u in users
        if u.email in first_sim_by_owner and first_sim_by_owner[u.email] >= u.created_at
    ]
    median_time_to_first_simulation_seconds = (
        statistics.median(time_to_first_sim_seconds) if time_to_first_sim_seconds else None
    )

    all_decisions = db.exec(select(models.RiskDecision)).all()
    accepted_recommendation_count = sum(1 for d in all_decisions if d.recommended_control_not_funded is None)
    recommended_controls_accepted_rate = (
        (accepted_recommendation_count / len(all_decisions)) if all_decisions else None
    )

    board_approved_decisions = [d for d in all_decisions if d.board_approved]
    complete_evidence_count = sum(
        1
        for d in board_approved_decisions
        if d.residual_ale is not None and d.p95 is not None and d.accepted_scenario is not None and d.evidence_hash is not None
    )
    audit_decisions_with_complete_evidence_rate = (
        (complete_evidence_count / len(board_approved_decisions)) if board_approved_decisions else None
    )

    incidents = db.exec(
        select(models.IncidentRecord)
        .where(models.IncidentRecord.prediction_error_pct.is_not(None))
        .order_by(models.IncidentRecord.incident_date.asc())
    ).all()
    prediction_error_trend = [
        {"incident_date": i.incident_date.isoformat(), "prediction_error_pct": i.prediction_error_pct}
        for i in incidents
    ]
    recent_errors = [abs(i.prediction_error_pct) for i in incidents[-10:]]
    earlier_errors = [abs(i.prediction_error_pct) for i in incidents[:-10]] if len(incidents) > 10 else []

    feedback_rows = db.exec(select(models.ChatFeedback)).all()
    up_count = sum(1 for f in feedback_rows if f.rating == "up")
    down_count = sum(1 for f in feedback_rows if f.rating == "down")

    return {
        "status": "success",
        "computed_at": datetime.utcnow().isoformat(),
        "onboarding": {
            "registered_accounts": len(users),
            "accounts_with_at_least_one_own_data_simulation": onboarded_count,
            "onboarding_completion_rate": onboarding_completion_rate,
            "median_time_to_first_simulation_seconds": median_time_to_first_simulation_seconds,
        },
        "recommended_controls": {
            "total_decisions": len(all_decisions),
            "decisions_with_recommendation_funded": accepted_recommendation_count,
            "recommended_controls_accepted_rate": recommended_controls_accepted_rate,
        },
        "calibration": {
            "calibrated_incident_count": len(db.exec(select(models.IncidentRecord)).all()),
            "prediction_error_trend": prediction_error_trend,
            "mean_abs_prediction_error_pct_most_recent_10": (
                statistics.mean(recent_errors) if recent_errors else None
            ),
            "mean_abs_prediction_error_pct_prior_incidents": (
                statistics.mean(earlier_errors) if earlier_errors else None
            ),
        },
        "audit_evidence": {
            "board_approved_decisions": len(board_approved_decisions),
            "board_approved_with_complete_evidence": complete_evidence_count,
            "audit_decisions_with_complete_evidence_rate": audit_decisions_with_complete_evidence_rate,
        },
        "ai_answer_usefulness": {
            "total_ratings": len(feedback_rows),
            "thumbs_up": up_count,
            "thumbs_down": down_count,
            "usefulness_rate": (up_count / len(feedback_rows)) if feedback_rows else None,
        },
        "api_and_simulation_failure_rates": observability.get_summary(),
    }


@app.post("/api/generate-mock-data")
def generate_mock_data(db: Session = Depends(get_db), current_user: str = Depends(require_admin)):
    """
    [Public demo credentials exposed - fix / RBAC] Regenerates the SHARED
    demo fleet every visitor sees - previously any authenticated account
    (including a real signup account created by any random visitor) could
    trigger this and disrupt the shared demo dataset for everyone else.
    Restricted to admin/demo accounts (see security.require_admin).
    """
    success, message = generators.populate_database(db)
    if not success:
        raise HTTPException(status_code=500, detail=message)
    admin_actions_logger.info("generate-mock-data run by %s (environment=%s)", current_user, ENVIRONMENT)
    return {"status": "success", "message": message}


@app.get("/api/telemetry")
def get_telemetry(
    data_source: str = Query("predefined", description="'predefined' (demo fleet) or 'own' (Ingestion Engine fleet)."),
    limit: int = Query(100, ge=1, le=500, description="Max rows to return (bounded to keep one request cheap regardless of fleet size)."),
    offset: int = Query(0, ge=0, description="Rows to skip, for paging through a large fleet's telemetry."),
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    [Cross-user data leakage fix] This previously had no auth and no
    data_source scoping at all - it returned the most recent 100
    TelemetryLog rows across the WHOLE table, mixing the shared demo fleet
    with every account's real ingested "own" telemetry together, to any
    anonymous caller (it's also publicly documented on /docs as a live
    endpoint, so this was directly reachable, not just latent). Now scoped
    the same way as GET /api/assets: 'predefined' stays open (shared demo
    reference data), 'own' requires a logged-in caller and is scoped to
    that account's own telemetry only.

    [Performance - fix] This used to hardcode limit=100 with no way to see
    anything past the newest 100 rows and no way to know whether more
    existed. `limit`/`offset` are now real query params (still defaulting
    to the old 100/0 so nothing calling this without them changes
    behavior) and the response reports `has_more`/`next_offset` so the
    frontend can page through a fleet larger than one page instead of
    silently truncating it.
    """
    if data_source == "own":
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required to view your own-data telemetry.")
        log_scope = (models.TelemetryLog.data_source == "own") & (models.TelemetryLog.owner_email == current_user)
    else:
        log_scope = (models.TelemetryLog.data_source == "predefined") | (models.TelemetryLog.data_source.is_(None))
    # Fetch one extra row past `limit` purely to answer has_more without a
    # second COUNT(*) query - trimmed back off before returning.
    rows = db.exec(
        select(models.TelemetryLog)
        .where(log_scope)
        .order_by(models.TelemetryLog.timestamp.desc())
        .offset(offset)
        .limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    logs = rows[:limit]
    if not logs and offset == 0:
        return {
            "status": "success",
            "data": [{
                "id": 1,
                "asset_id": "AST-000",
                "vulnerability_score": 8.5,
                "threat_level": "HIGH",
                "edr_status": "ACTIVE",
            }],
            "has_more": False,
            "next_offset": None,
            }
    return {
        "status": "success",
        "data": logs,
        "has_more": has_more,
        "next_offset": (offset + limit) if has_more else None,
    }


@app.post("/api/upload-telemetry")
async def upload_telemetry(file: UploadFile = File(...), db: Session = Depends(get_db)):
    import json
    
    content = await file.read()
    content_str = content.decode('utf-8')
    filename = file.filename.lower()
    
    logs_created = 0
    
    # Ensure there's a default asset if one doesn't exist
    default_asset_id = "AST-001"
    asset = db.exec(select(models.Asset).where(models.Asset.id == default_asset_id)).first()
    if not asset:
        asset = models.Asset(id=default_asset_id, name="Default Ingestion Asset", business_unit="Ingestion", business_value=100000.0)
        db.add(asset)
        db.commit()
    
    if filename.endswith(".json"):
        try:
            data = json.loads(content_str)
            if not isinstance(data, list):
                data = [data]
                
            for item in data:
                log = models.TelemetryLog(
                    asset_id=item.get("asset_id", default_asset_id),
                    cve_ids=item.get("cve_ids"),
                    cvss_score=item.get("cvss_score"),
                    patch_status=item.get("patch_status"),
                    event_frequency_24h=item.get("event_frequency_24h", 0),
                    anomalous_access_flags=item.get("anomalous_access_flags", 0),
                    incident_alert_level=item.get("incident_alert_level"),
                    privilege_level=item.get("privilege_level"),
                    excessive_permissions=item.get("excessive_permissions", False),
                    mfa_active=item.get("mfa_active", True),
                    edr_health_status=item.get("edr_health_status"),
                    host_compromise_flags=item.get("host_compromise_flags", False),
                    malware_alerts_24h=item.get("malware_alerts_24h", 0),
                    public_exposure_flag=item.get("public_exposure_flag", False),
                    cloud_misconfigurations_count=item.get("cloud_misconfigurations_count", 0),
                    cisa_kev_presence=item.get("cisa_kev_presence", False),
                    threat_actor_chatter=item.get("threat_actor_chatter")
                )
                db.add(log)
                logs_created += 1
            db.commit()
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON file")
            
    elif filename.endswith(".txt"):
        # Basic regex/string matching parser for demo network config files
        log = models.TelemetryLog(asset_id=default_asset_id)
        
        # Missing anti-spoofing
        if "ip verify unicast source reachable-via rx" not in content_str:
            log.cloud_misconfigurations_count += 1
            
        # Missing BGP neighbor auth
        if "router bgp" in content_str and "password" not in content_str:
            log.cloud_misconfigurations_count += 1
            
        db.add(log)
        db.commit()
        logs_created += 1
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format. Please upload .json or .txt")
        
    return {"status": "success", "message": f"Successfully ingested {logs_created} telemetry logs."}


@app.get("/api/topology")
def get_topology(
    data_source: str = Query("predefined", description="'predefined' (demo fleet) or 'own' (Ingestion Engine fleet)."),
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    [Cross-user data leakage fix] This previously queried every Asset in
    the table with no data_source filter and no auth at all - it returned
    every account's real asset IDs and their full topology mixed together
    (also publicly documented on /docs as a live endpoint). Scoped the
    same way as GET /api/assets/GET /api/telemetry now: 'predefined' stays
    open (shared demo reference data), 'own' requires a logged-in caller
    and is scoped to that account's own topology only.
    """
    from datetime import datetime

    if data_source == "own":
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required to view your own-data topology.")
        asset_scope = (models.Asset.data_source == "own") & (models.Asset.owner_email == current_user)
    else:
        asset_scope = (models.Asset.data_source == "predefined") | (models.Asset.data_source.is_(None))
    assets = db.exec(select(models.Asset).where(asset_scope)).all()
    if not assets:
        raise HTTPException(status_code=404, detail="Network topology not found. Run mock data generation first.")

    asset_ids = [a.id for a in assets]
    index = {asset_id: i for i, asset_id in enumerate(asset_ids)}
    n = len(asset_ids)
    matrix = [[0 for _ in range(n)] for _ in range(n)]

    asset_id_set = set(asset_ids)
    edges = db.exec(select(models.NetworkEdge)).all()
    for edge in edges:
        # [Cross-user data leakage fix] an edge whose endpoints aren't both
        # in this scoped asset set (e.g. a demo-fleet edge, while
        # data_source=own) is skipped below via index.get(...) being None
        # either way, but being explicit here documents why - without this
        # scoping, edges between two *other* accounts' own-data assets
        # would previously never have been reachable through this endpoint
        # anyway, but the underlying `assets` query itself used to mix
        # every account's node set into one matrix regardless.
        if edge.source_asset_id not in asset_id_set or edge.target_asset_id not in asset_id_set:
            continue
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


@app.get("/api/assets")
def list_assets(
    data_source: str = Query("predefined", description="'predefined' (demo fleet) or 'own' (Ingestion Engine fleet)."),
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    Lightweight, data_source-scoped asset list ({id, name, business_unit,
    data_classification, criticality_score, business_value}) - backs the
    Attack Path panel's target-asset picker (see POST /api/attack-path).
    GET /api/topology exists already but returns only an adjacency matrix
    and bare asset IDs, not names, and isn't data_source-scoped at all -
    this is the read the frontend actually needs for a human-readable
    dropdown against the right dashboard's fleet.
    """
    if data_source == "own":
        # [Cross-user data leakage fix] "own" now requires a logged-in
        # caller and is scoped to that account's own fleet only - this
        # used to return the single global "own" bucket every account
        # shared, which is the exact bug reported ("Own Data Ledger"
        # showing another account's assets/records).
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required to view your own-data asset fleet.")
        asset_scope = (models.Asset.data_source == "own") & (models.Asset.owner_email == current_user)
    else:
        asset_scope = (models.Asset.data_source == "predefined") | (models.Asset.data_source.is_(None))
    assets = db.exec(select(models.Asset).where(asset_scope).order_by(models.Asset.business_value.desc())).all()
    return {
        "status": "success",
        "data": [
            {
                "id": a.id,
                "name": a.name,
                "business_unit": a.business_unit,
                "data_classification": a.data_classification,
                "criticality_score": a.criticality_score,
                "business_value": a.business_value,
                "is_public_facing": a.data_classification == "Public",
            }
            for a in assets
        ],
    }


class AttackPathRequest(BaseModel):
    target_asset_id: str
    active_controls: Optional[Dict[str, bool]] = None
    # Same convention as RiskSimRequest.data_source - which dashboard's
    # fleet to traverse.
    data_source: str = "predefined"


@app.post("/api/attack-path")
def get_attack_path(
    payload: AttackPathRequest,
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    Real graph traversal, not a scripted example: BFS over the actual
    NetworkEdge topology (same edges GET /api/topology and
    risk_engine.derive_fair_inputs' blast-radius calc both read) from every
    internet-facing asset (data_classification == "Public") to the
    requested target, plus a loss sub-range for that specific asset derived
    from THIS run's real FAIR Monte Carlo output - never a fabricated
    number.

    [Public Exposure Hardening (WAF)] is what makes a path genuinely
    disappear rather than just relabeling the same graph: when that control
    is active in active_controls, public-facing assets are excluded from
    the entry-point set entirely (the control's whole purpose - see
    CONTROL_FRAMEWORK_MAP's "Perform Application Layer Filtering" mapping),
    so BFS from a now-empty entry set correctly finds no path for any
    target that was only reachable through one.
    """
    if payload.data_source == "own":
        # [Cross-user data leakage fix] see GET /api/assets - traversal
        # over "own" topology must never touch another account's ingested
        # fleet.
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required to traverse your own-data topology.")
        asset_scope = (models.Asset.data_source == "own") & (models.Asset.owner_email == current_user)
    else:
        asset_scope = (models.Asset.data_source == "predefined") | (models.Asset.data_source.is_(None))
    assets = db.exec(select(models.Asset).where(asset_scope)).all()
    if not assets:
        raise HTTPException(status_code=400, detail="No assets found. Run /api/generate-mock-data first.")

    asset_by_id = {a.id: a for a in assets}
    if payload.target_asset_id not in asset_by_id:
        raise HTTPException(status_code=404, detail=f"Asset '{payload.target_asset_id}' not found in this data set.")

    asset_ids = set(asset_by_id.keys())
    adjacency: Dict[str, list] = {aid: [] for aid in asset_ids}
    edges = db.exec(select(models.NetworkEdge)).all()
    for edge in edges:
        if edge.source_asset_id in asset_ids and edge.target_asset_id in asset_ids:
            adjacency[edge.source_asset_id].append(edge.target_asset_id)
            adjacency[edge.target_asset_id].append(edge.source_asset_id)

    waf_active = bool((payload.active_controls or {}).get("Public Exposure Hardening (WAF)"))
    entry_points = [] if waf_active else [a.id for a in assets if a.data_classification == "Public"]

    # Multi-source BFS from every entry point at once, so the returned path
    # is the shortest hop-count route from ANY internet-facing asset to the
    # target - a real shortest-path search over the real graph, not a
    # single hardcoded chain.
    path_found = None
    if payload.target_asset_id in entry_points:
        path_found = [payload.target_asset_id]
    elif entry_points:
        from collections import deque
        visited = set(entry_points)
        parent: Dict[str, Optional[str]] = {aid: None for aid in entry_points}
        queue = deque(entry_points)
        while queue:
            current = queue.popleft()
            if current == payload.target_asset_id:
                chain = [current]
                while parent[chain[-1]] is not None:
                    chain.append(parent[chain[-1]])
                path_found = list(reversed(chain))
                break
            for neighbor in adjacency.get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    parent[neighbor] = current
                    queue.append(neighbor)

    result: Dict[str, Any] = {
        "target_asset_id": payload.target_asset_id,
        "path_found": path_found is not None,
        "blocked_by_waf": waf_active and any(a.data_classification == "Public" for a in assets),
        "path": None,
        "loss_range": None,
    }
    if path_found:
        result["path"] = [
            {"id": aid, "name": asset_by_id[aid].name, "business_unit": asset_by_id[aid].business_unit}
            for aid in path_found
        ]
        result["hop_count"] = len(path_found) - 1

        # Real loss sub-range: this specific run's actual mean/P95 ALE,
        # scaled by the target asset's real share of total business value -
        # the same proportional-allocation honesty as
        # risk_engine.compute_business_unit_breakdown/compute_scenario_breakdown,
        # not an invented range.
        calibration = risk_engine.get_current_calibration(db)
        inputs = risk_engine.derive_fair_inputs(
            db, active_controls=payload.active_controls, calibration=calibration, data_source=payload.data_source,
            owner_email=current_user if payload.data_source == "own" else None,
        )
        if inputs:
            inputs.pop("risk_drivers", None)
            inputs.pop("calibration", None)
            inputs.pop("provenance", None)
            mc_results = quant_mc.run_fair_monte_carlo(**inputs)
            total_value = sum(a.business_value for a in assets) or 1.0
            target_share = asset_by_id[payload.target_asset_id].business_value / total_value
            result["loss_range"] = {
                "low": mc_results["mean_expected_loss"] * target_share,
                "high": mc_results["var_95"] * target_share,
            }

    return {"status": "success", "data": result}


# [P0-NUM-005 / P0-API-008 hardening] The FAIR Monte Carlo pipeline has
# several guarded divisions and clamps already (see risk_engine.py), but
# nothing previously stopped a NaN/+-Infinity that slipped through some
# future code path from being silently JSON-serialized straight to the
# frontend - Python's json module happily emits the non-standard tokens
# NaN/Infinity/-Infinity, which either crash a strict JSON.parse or render
# as literal "NaN" on a card/chart with no explanation. Rather than adding
# a bespoke Pydantic response_model with FiniteFloat fields for every one
# of these deeply-nested, evolving result dicts, this walks the actual
# response once right before it goes out and fails loudly (500, naming the
# exact field) instead of shipping an impossible number silently.
def _first_non_finite_path(obj: Any, path: str = "response") -> Optional[str]:
    if isinstance(obj, float):
        return None if math.isfinite(obj) else path
    if isinstance(obj, dict):
        for k, v in obj.items():
            found = _first_non_finite_path(v, f"{path}.{k}")
            if found:
                return found
        return None
    if isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            found = _first_non_finite_path(v, f"{path}[{i}]")
            if found:
                return found
        return None
    return None


@app.post("/api/simulate-risk")
@limiter.limit("10/minute")
def simulate_risk(
    request: Request,
    payload: RiskSimRequest,
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    # [Cross-user data leakage fix] "own"-mode simulations must be
    # attributable to (and later only readable by) the real logged-in
    # account - previously this endpoint had no auth at all, and every
    # "own" simulation landed in one single shared global bucket that
    # ANY account could later read back via GET /api/simulations.
    if payload.data_source == "own" and not current_user:
        raise HTTPException(status_code=401, detail="Login required to run a simulation against your own ingested data.")

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
        db, dpdp_override=dpdp_override, active_controls=payload.active_controls, calibration=calibration,
        data_source=payload.data_source, owner_email=current_user if payload.data_source == "own" else None,
    )
    if inputs is None:
        # [Observability fix] Counted as a simulation failure - the most
        # common real-world "simulation failed" case (an empty/reset
        # database, or a brand-new own-data account before ingesting
        # anything).
        observability.record_simulation_result(success=False)
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
    # [Evidence/provenance trail] same fixed-signature reason risk_drivers/
    # calibration get popped above - see risk_engine.derive_fair_inputs'
    # provenance comment for what this carries and why.
    provenance = inputs.pop("provenance", {})
    mc_results = quant_mc.run_fair_monte_carlo(**inputs)
    opt_results = quant_opt.optimize_budget(risk_engine.SECURITY_CONTROLS, payload.budget)
    # [Optimizer benchmark] the same budget, allocated the way most
    # organizations actually triage remediation (highest CVSS/KEV severity
    # first) instead of by cost-efficiency - see quant_opt.
    # optimize_budget_severity_first's docstring. Lets the Optimize page
    # show, on this run's real numbers, how much more risk reduction the
    # 0/1 knapsack optimizer extracts from the same rupee of budget.
    severity_opt_results = quant_opt.optimize_budget_severity_first(risk_engine.SECURITY_CONTROLS, payload.budget)
    # [KEV/Threat-first benchmark] a second, distinct naive baseline -
    # "patch whatever's actively exploited in the wild first" - alongside
    # severity-first, so the Optimize page can show the real optimizer
    # against BOTH common triage philosophies, not just one. See
    # quant_opt.optimize_budget_kev_first and SECURITY_CONTROLS'
    # kev_relevance field.
    kev_opt_results = quant_opt.optimize_budget_kev_first(risk_engine.SECURITY_CONTROLS, payload.budget)

    def _delta_pct(baseline: dict) -> Optional[float]:
        baseline_total = baseline["total_risk_reduced"]
        if baseline_total <= 0:
            return None
        return round((opt_results["total_risk_reduced"] - baseline_total) / baseline_total * 100.0, 1)

    optimizer_benchmark = {
        "optimal": opt_results,
        "severity_first": severity_opt_results,
        "kev_first": kev_opt_results,
        "risk_reduction_delta": opt_results["total_risk_reduced"] - severity_opt_results["total_risk_reduced"],
        "risk_reduction_delta_pct": _delta_pct(severity_opt_results),
        "kev_risk_reduction_delta": opt_results["total_risk_reduced"] - kev_opt_results["total_risk_reduced"],
        "kev_risk_reduction_delta_pct": _delta_pct(kev_opt_results),
    }
    business_unit_breakdown = risk_engine.compute_business_unit_breakdown(
        db, mc_results["mean_expected_loss"], calibration=calibration, data_source=payload.data_source,
        owner_email=current_user if payload.data_source == "own" else None,
    )
    # [Attack-scenario breakdown] Same real-simulated-total-allocated-by-
    # real-signals shape as business_unit_breakdown above, but by named
    # attack scenario (ransomware / data exfiltration / third-party) - see
    # risk_engine.compute_scenario_breakdown's docstring for exactly how
    # each asset is classified.
    scenario_breakdown = risk_engine.compute_scenario_breakdown(
        db, mc_results["mean_expected_loss"], mc_results["var_95"], data_source=payload.data_source,
        owner_email=current_user if payload.data_source == "own" else None,
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

    # [Version the risk model fix] model_version/control_library_version
    # come straight off risk_engine's constants (already folded into
    # `provenance` by derive_fair_inputs above); random_seed and the
    # actual iteration count come back from run_fair_monte_carlo itself
    # (mc_results['seed_used']/['num_simulations']) since those aren't
    # known until the simulation actually runs. simulation_config bundles
    # the run-time knobs (budget, active-control count, DPDP override,
    # iterations, seed) into one place on the persisted provenance blob.
    provenance["random_seed"] = mc_results.get("seed_used")
    provenance["simulation_config"] = {
        "num_simulations": mc_results.get("num_simulations"),
        "random_seed": mc_results.get("seed_used"),
        "budget": payload.budget,
        "active_control_count": len(payload.active_controls or {}),
        "is_dpdp_applicable": inputs.get("is_dpdp_applicable"),
    }

    # [P0-NUM-005 / P0-API-008] Check the core numeric results for a
    # non-finite value BEFORE persisting - the full response gets a second,
    # broader check right before it's returned (see _first_non_finite_path
    # above), but that runs after this row would already be committed, so
    # a bad simulate-risk call would otherwise leave a corrupt row behind
    # even once the frontend correctly rejects the response.
    bad_field = _first_non_finite_path({
        "monte_carlo": mc_results,
        "confidence_band": confidence_band,
        "optimization": opt_results,
    })
    if bad_field:
        observability.record_simulation_result(success=False)
        raise HTTPException(
            status_code=500,
            detail=f"Simulation produced a non-finite value at {bad_field} - nothing was saved. Please retry; if this persists, the input data likely has an extreme or malformed value.",
        )

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
        data_source=payload.data_source,
        # [Cross-user data leakage fix] tags this run to its real owner so
        # GET /api/simulations can scope "own" history per-account instead
        # of one shared global run history.
        owner_email=current_user if payload.data_source == "own" else None,
        # [Version the risk model fix] see the comment above - every run
        # now records exactly which model/control-library version, which
        # random seed, how confident the model was, and how fresh the
        # telemetry was that produced it.
        model_version=provenance.get("model_version"),
        control_library_version=provenance.get("control_library_version"),
        random_seed=mc_results.get("seed_used"),
        confidence_level=provenance.get("model_confidence"),
        input_telemetry_at=(
            datetime.fromisoformat(provenance["latest_telemetry_at"])
            if provenance.get("latest_telemetry_at") else None
        ),
        provenance=provenance,
    )
    db.add(sim_record)
    db.commit()
    observability.record_simulation_result(success=True)

    response_payload = {
        "status": "success",
        "message": "Risk simulation completed",
        "data_source": payload.data_source,
        "budget_used": payload.budget,
        # [Risk Decision Passport integrity fix] Echoed back so a caller
        # logging an accept/approve decision later can attach the exact
        # control configuration that produced THIS result, instead of
        # whatever the dashboard's live toggles happen to show by the time
        # the user clicks Accept - see acceptRisk in overview/page.tsx,
        # which used to read live `controls` state instead of this.
        "active_controls_used": payload.active_controls or {},
        "monte_carlo": {
            "mean_expected_loss": mc_results["mean_expected_loss"],
            "var_95": mc_results["var_95"],
            "distribution_curve": mc_results.get("distribution_curve", []),
            },
        "sebi_resilience": mc_results.get("sebi_resilience", {}),
        "optimization": opt_results,
        # [Optimizer benchmark] optimal (ROSI-maximizing knapsack) vs.
        # severity-first (CVSS/KEV-style greedy) allocation of this exact
        # budget - powers the Optimize page's benchmark comparison card.
        "optimizer_benchmark": optimizer_benchmark,
        "business_unit_breakdown": business_unit_breakdown,
        # [Attack-scenario breakdown] see risk_engine.compute_scenario_breakdown -
        # real per-asset telemetry signals, not a scripted split.
        "scenario_breakdown": scenario_breakdown,
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
        # [Evidence/provenance trail] exactly which triangular FAIR ranges,
        # how many live asset/telemetry/mapping rows, and how many Monte
        # Carlo iterations produced this run's ALE/VaR - see
        # risk_engine.derive_fair_inputs' provenance comment. Powers the
        # Overview "Where this number comes from" panel.
        "provenance": provenance,
    }

    # [P0-NUM-005 / P0-API-008] Reject rather than ship a NaN/Infinity -
    # see _first_non_finite_path above.
    bad_field = _first_non_finite_path(response_payload)
    if bad_field:
        observability.record_simulation_result(success=False)
        raise HTTPException(
            status_code=500,
            detail=f"Simulation produced a non-finite value at {bad_field} - this run was not saved. Please retry; if this persists, the input data likely has an extreme or malformed value.",
        )
    return response_payload


@app.get("/api/simulations")
def get_simulations(
    limit: int = 30,
    data_source: Optional[str] = Query(None, description="Filter to one dashboard's run history: 'predefined' (demo Overview) or 'own' (Ingestion Engine). Omit to default to 'predefined'."),
    current_user: Optional[str] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
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

    [Own-Data / Demo isolation] Pass ?data_source=predefined or
    ?data_source=own to scope the history to just that dashboard's runs -
    same convention as GET /api/audit-log. A legacy row from before this
    column existed has data_source=NULL - treated as 'predefined' here.
    """
    query = select(models.RiskSimulation)
    if data_source == "own":
        # [Cross-user data leakage fix] "own" run history is now scoped to
        # the logged-in caller's own runs only - previously ANY caller
        # (including with no auth at all) could read every account's
        # own-data simulation history here.
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required to view your own-data run history.")
        query = query.where(
            models.RiskSimulation.data_source == "own", models.RiskSimulation.owner_email == current_user
        )
    else:
        # [Cross-user data leakage fix] omitting data_source used to mean
        # "every run regardless of source", which silently included every
        # account's own-data runs alongside the shared demo history. It
        # now defaults to the shared 'predefined' history only - an
        # explicit ?data_source=own (with a valid session) is required to
        # see any own-data history at all.
        query = query.where(
            (models.RiskSimulation.data_source == "predefined") | (models.RiskSimulation.data_source.is_(None))
        )
    rows = db.exec(query.order_by(models.RiskSimulation.timestamp.desc()).limit(limit)).all()
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
                "data_source": r.data_source,
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
    # [Ingestion upload guidance fix] Mirrors the frontend's client-side
    # checks (ingestion/page.tsx) so a request that bypasses the browser -
    # or a stale client - still gets a clear, actionable error instead of
    # a generic 500 or a parser silently churning through garbage input.
    MAX_INGEST_CONTENT_CHARS = 2 * 1024 * 1024  # 2 MB - keep in sync with the frontend cap
    if len(payload.content) > MAX_INGEST_CONTENT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Uploaded file is {len(payload.content) / (1024 * 1024):.1f} MB - the ingestion parser accepts configs up to 2 MB.",
        )
    if "\x00" in payload.content or "\ufffd" in payload.content:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file doesn't look like a plain-text config (binary or non-UTF-8 content detected). Export it as UTF-8 plain text and try again.",
        )
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
        # [Own-Data / Demo isolation] The Ingestion Engine only exists on
        # the own-data dashboard, so every confirmed mapping is always
        # real-environment evidence - explicit here (not just relying on
        # the model default) so derive_fair_inputs' gap_deduction never
        # accidentally leaks into the demo dashboard's Control Strength.
        data_source="own",
        # [Cross-user data leakage fix] tags this mapping to its real
        # owner so GET /api/ingest/mappings can scope results per-account
        # instead of one shared global "Trained Parameters" list.
        owner_email=current_user,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    audit_events_logger.info(
        "ingestion_mapping_confirmed",
        extra={"mapping_id": mapping.id, "confirmed_by": current_user, "parameter": mapping.parameter, "kind": mapping.kind},
    )
    return {"status": "success", "mapping_id": mapping.id}


@app.get("/api/ingest/mappings")
def ingest_mappings(
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All confirmed mappings ever trained, most recent first - backs the
    "Trained Parameters" count on the Ingestion Engine page.

    [Cross-user data leakage fix] Previously open to anonymous callers
    with no scoping at all, returning every account's confirmed mappings
    together (each row includes `confirmed_by`, `filename`, and the real
    ingested `snippet`). Now requires a valid bearer token and is scoped
    to the caller's own confirmed mappings, same as every other own-data
    endpoint.
    """
    mappings = db.exec(
        select(models.IngestedMapping)
        .where(models.IngestedMapping.owner_email == current_user)
        .order_by(models.IngestedMapping.created_at.desc())
        .limit(500)
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
        audit_events_logger.info(
            "training_module_uncompleted", extra={"training_module": request.module, "user": current_user},
        )
        return {"status": "success", "module": request.module, "completed": False}

    record = models.TrainingRecord(module=request.module, completed_by=current_user)
    db.add(record)
    db.commit()
    db.refresh(record)
    audit_events_logger.info(
        "training_module_completed", extra={"training_module": request.module, "user": current_user},
    )
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
async def chat(request: Request, payload: ChatRequest, current_user: str = Depends(get_current_user)):
    from langchain_core.messages import HumanMessage

    initial_state = {"messages": [HumanMessage(content=payload.message)]}

    async def event_stream():
        has_yielded = False
        try:
            async for event in ai_graph.app.astream_events(
                initial_state, version="v1",
                # Hands data_source to every node/sub-agent/tool in this run
                # via RunnableConfig's "configurable" bag - see
                # ai-agent/graph.py's specialist nodes and
                # tools.py::_data_source_from_config for the rest of the
                # chain. This is standard LangChain config propagation, not
                # part of the LLM-visible message, so the model can't see or
                # override it.
                config={"configurable": {"data_source": payload.data_source, "owner_email": current_user}},
            ):
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
                yield "[Offline Mode] I am the Virtual CISO. I can help you query telemetry, optimize budgets, or check compliance frameworks. How can I assist you today?"
        except Exception as e:
            # [API security review / safe error messages] This used to
            # yield str(e) straight into the chat stream - a raw
            # exception can carry internal file paths, library
            # tracebacks, or (for an LLM-provider error) fragments of
            # request internals, none of which a chat user should see.
            # Logged server-side in full; the user gets one safe,
            # actionable sentence.
            logging.getLogger("crq.chat").exception("AI orchestrator error for user=%s", current_user)
            yield "\n\n[Offline Mode] The Virtual CISO hit an unexpected error processing that message. Please try again in a moment."

    return StreamingResponse(event_stream(), media_type="text/plain")


class ChatFeedbackRequest(BaseModel):
    question: str = Field(max_length=2000)
    answer: str = Field(max_length=4000)
    rating: str  # "up" | "down"


@app.post("/api/chat/feedback")
@limiter.limit("30/minute")
def submit_chat_feedback(request: Request, payload: ChatFeedbackRequest, current_user: str = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    [Success metrics #15 - AI answer usefulness] Records one explicit
    thumbs-up/down on one Virtual CISO answer - see VirtualCisoChat.tsx's
    per-message rating buttons and models.ChatFeedback's docstring for why
    this is the one deliberate exception to "chat isn't persisted server-
    side". Never captured automatically - only when a visitor clicks a
    rating control on that specific message.
    """
    if payload.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating must be 'up' or 'down'.")
    feedback = models.ChatFeedback(
        rated_by=current_user,
        rating=payload.rating,
        question=payload.question,
        answer=payload.answer,
        was_offline_fallback="[Offline Mode]" in payload.answer,
    )
    db.add(feedback)
    db.commit()
    return {"status": "success"}


@app.post("/api/audit")
def log_audit(
    request: AuditRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Logs a risk-acceptance decision to the database. Requires a valid
    bearer token (POST /api/auth/login first). `decided_by` comes from the
    verified token, never from `request.user_id`.

    This used to also fire a background task that silently attempted a
    blockchain commit on every single acceptance. It no longer does - the
    decision is written off-chain (on_chain=False) here, and committing it
    to the AuditLedger smart contract is now a separate, explicit action
    the user takes afterwards from the Ledger page (POST
    /api/audit-log/{id}/commit-chain) - review the decision first, then
    opt in to putting it on-chain, rather than every acceptance racing to
    write to a chain nobody asked about yet.
    """
    # [Risk Decision Passport] model_snapshot is the real backend app
    # version (FastAPI's own app.version above), not an invented build tag.
    # review_expiry is a fixed 90-day re-review window from decision time -
    # a reasonable default cadence, not something the client controls.
    model_snapshot = f"CRQ-FAIR-v{app.version}"
    review_expiry = datetime.utcnow() + timedelta(days=90)

    recommended_control_not_funded = None
    evidence_hash = None
    if request.active_controls is not None:
        # What the real 0/1 knapsack optimizer would recommend for the
        # same budget actually being spent (active_controls' own cost sum,
        # if no explicit budget was sent) - the first recommended control
        # NOT in active_controls is what's genuinely being left unfunded,
        # not a placeholder.
        budget_for_check = request.budget
        if budget_for_check is None:
            budget_for_check = sum(
                c["cost"] for c in risk_engine.SECURITY_CONTROLS
                if request.active_controls.get(c["id"])
            )
        if budget_for_check:
            opt = quant_opt.optimize_budget(risk_engine.SECURITY_CONTROLS, budget_for_check)
            for control_id in opt.get("selected_patches", []):
                if not request.active_controls.get(control_id):
                    recommended_control_not_funded = control_id
                    break

        # Evidence hash: a real SHA-256 over this decision's actual
        # evidence trail (asset/telemetry counts, freshness, FAIR input
        # ranges - see risk_engine.derive_fair_inputs' provenance dict),
        # not a random or client-supplied string - "prove exactly what
        # information was in front of management" means the hash has to
        # be independently reproducible from the real state at decision
        # time, computed server-side.
        calibration = risk_engine.get_current_calibration(db)
        inputs_for_hash = risk_engine.derive_fair_inputs(
            db, active_controls=request.active_controls, calibration=calibration, data_source=request.data_source,
            owner_email=current_user if request.data_source == "own" else None,
        )
        if inputs_for_hash and inputs_for_hash.get("provenance"):
            evidence_payload = json.dumps(inputs_for_hash["provenance"], sort_keys=True, default=str)
            evidence_hash = hashlib.sha256(evidence_payload.encode("utf-8")).hexdigest()

    # [Risk passport governance evidence fix] Previously board_approved
    # could be set True with every other passport field left blank -
    # residual_ale/p95/accepted_scenario/evidence_hash all None - and the
    # Ledger still rendered a clean "Board-approved" badge right next to a
    # row of dashes, which is exactly the reported bug: a decision that
    # LOOKS board-approved with no evidence a board actually saw anything.
    # A board sign-off is only meaningful if it's tied to a specific,
    # reproducible risk picture, so it's now a hard requirement server-side
    # (not just a UI nicety a caller could skip) - model_snapshot and
    # review_expiry are always set above regardless (server-computed, never
    # blank), so the fields actually worth gating on are the ones a caller
    # could otherwise omit.
    if request.board_approved:
        missing = [
            field_name for field_name, value in [
                ("residual_ale", request.residual_ale),
                ("p95", request.p95),
                ("accepted_scenario", request.accepted_scenario),
                ("evidence_hash", evidence_hash),
            ] if value is None
        ]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot mark this decision board-approved without the evidence a board actually "
                    f"reviewed - missing: {', '.join(missing)}. Run a simulation first (evidence_hash "
                    "requires active_controls) and send its real residual_ale/p95/accepted_scenario, "
                    "or log this as an individual acceptance instead (board_approved: false)."
                ),
            )

    decision = models.RiskDecision(
        action=request.action,
        risk_accepted=request.risk_accepted,
        decided_by=current_user,
        board_approved=request.board_approved,
        data_source=request.data_source,
        model_snapshot=model_snapshot,
        # [Version the risk model fix] Which risk model / control
        # library was live at decision time - independent of
        # model_snapshot (the backend app build) above, so a later
        # challenge to this decision's numbers can tell whether the
        # underlying FAIR math or control catalog has since changed.
        model_version=risk_engine.MODEL_VERSION,
        control_library_version=risk_engine.CONTROL_LIBRARY_VERSION,
        residual_ale=request.residual_ale,
        p95=request.p95,
        accepted_scenario=request.accepted_scenario,
        recommended_control_not_funded=recommended_control_not_funded,
        reason=request.reason,
        evidence_hash=evidence_hash,
        review_expiry=review_expiry,
        # [Cross-user data leakage fix] tags this decision to its real
        # owner so GET/DELETE /api/audit-log and commit-chain can enforce
        # per-account ownership instead of one shared global ledger.
        owner_email=current_user if request.data_source == "own" else None,
    )
    db.add(decision)
    db.commit()
    db.refresh(decision)
    # [Observability fix] Structured audit-event log line, distinct from
    # (and in addition to) the RiskDecision row itself - this is what an
    # operator tails in real time; the DB row is the durable record a
    # board/auditor later queries.
    audit_events_logger.info(
        "risk_decision_logged",
        extra={
            "decision_id": decision.id,
            "decided_by": current_user,
            "data_source": decision.data_source,
            "board_approved": decision.board_approved,
            "risk_accepted": decision.risk_accepted,
        },
    )

    return {
        "status": "success",
        "message": "Audit logged. Visit the Ledger to commit it on-chain.",
        "action": request.action,
        "decision_id": decision.id,
        "decided_by": current_user,
        "board_approved": request.board_approved,
        "data_source": decision.data_source,
        "model_snapshot": decision.model_snapshot,
        "model_version": decision.model_version,
        "control_library_version": decision.control_library_version,
        "recommended_control_not_funded": decision.recommended_control_not_funded,
        "evidence_hash": decision.evidence_hash,
        "review_expiry": decision.review_expiry.isoformat() if decision.review_expiry else None,
    }


@app.get("/api/audit-log")
def get_audit_log(
    data_source: Optional[str] = Query(None, description="Filter to one dashboard's ledger: 'predefined' (demo Overview) or 'own' (Ingestion Engine). Omit to default to 'predefined'."),
    limit: int = Query(200, ge=1, le=500, description="Max decisions to return (bounded so one request stays cheap regardless of ledger size)."),
    offset: int = Query(0, ge=0, description="Decisions to skip, for paging through a long ledger."),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lists risk-acceptance decisions, most recent first - backs the "View
    Detailed Ledger" page. Each row also reports whether it made it onto
    the local blockchain (tx_hash/on_chain) and whether board approval was
    recorded (board_approved).

    [Separate ledgers per dashboard] Pass ?data_source=predefined or
    ?data_source=own to scope the list to just that dashboard's decisions,
    so demo-telemetry acceptances and real-ingested-data acceptances read
    as two distinct ledgers instead of one undifferentiated table. A
    legacy row from before this column existed has data_source=NULL in
    the database - treated as 'predefined' here so old demo-era decisions
    still show up somewhere sensible instead of disappearing.
    """
    # [Cross-user data leakage fix] This is the exact endpoint behind the
    # reported bug - "Own Data Ledger" showed another account's decisions
    # because this had NO authentication at all and no owner scoping, and
    # an omitted data_source meant "every decision regardless of source".
    # It now requires a valid bearer token (added to the signature above),
    # defaults an omitted data_source to the shared 'predefined' ledger
    # only, and scopes 'own' strictly to the caller's own owner_email.
    if data_source == "own":
        query = select(models.RiskDecision).where(
            models.RiskDecision.data_source == "own", models.RiskDecision.owner_email == current_user
        )
    else:
        query = select(models.RiskDecision).where(
            (models.RiskDecision.data_source == "predefined") | (models.RiskDecision.data_source.is_(None))
        )
    # [Performance - fix] Was a hardcoded limit=200 with no pagination at
    # all - a ledger that grows past 200 entries silently hid everything
    # older. Same has_more/next_offset pattern as GET /api/telemetry: fetch
    # one extra row to detect there's more, without a second COUNT query.
    rows = db.exec(query.order_by(models.RiskDecision.created_at.desc()).offset(offset).limit(limit + 1)).all()
    has_more = len(rows) > limit
    decisions = rows[:limit]
    return {
        "status": "success",
        "data": decisions,
        "has_more": has_more,
        "next_offset": (offset + limit) if has_more else None,
    }


@app.post("/api/audit-log/{decision_id}/commit-chain")
def commit_chain(
    decision_id: int,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Explicit, user-initiated on-chain commit for one already-logged risk
    decision. POST /api/audit no longer commits to the chain automatically
    (see that endpoint's docstring) - this is the opt-in step someone
    takes from the Ledger page after reviewing a decision, calling the
    same AuditLedger.logRiskAcceptance contract method
    (blockchain_client.log_risk_acceptance) that used to fire in the
    background on every acceptance.
    """
    decision = db.get(models.RiskDecision, decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")
    if decision.data_source == "own" and decision.owner_email and decision.owner_email != current_user:
        # [Cross-user data leakage / unauthorized-action fix] previously
        # any authenticated caller could commit ANY other account's
        # own-data decision to the blockchain - ownership wasn't checked
        # at all. Predefined/demo decisions stay shared (any authenticated
        # user may commit them, matching existing demo semantics); only
        # own-data decisions are now owner-locked.
        raise HTTPException(status_code=403, detail="You can only commit your own decisions to the ledger.")
    if decision.on_chain:
        return {
            "status": "success",
            "message": "Already committed on-chain",
            "tx_hash": decision.tx_hash,
            "on_chain": True,
            "decision_id": decision.id,
        }

    data_hash = f"decision:{decision.id}|source:{decision.data_source or 'predefined'}|risk:{decision.risk_accepted}"
    tx_hash = blockchain_client.log_risk_acceptance(
        action=decision.action, data_hash=data_hash, user=current_user, board_approved=decision.board_approved,
    )

    if not tx_hash:
        raise HTTPException(
            status_code=503,
            detail="No blockchain node reachable right now (local Hardhat chain, or a configured testnet RPC). The decision stays logged off-chain - try again once a chain is reachable.",
        )

    decision.tx_hash = tx_hash
    decision.on_chain = True
    db.add(decision)
    db.commit()
    db.refresh(decision)
    audit_events_logger.info(
        "decision_committed_on_chain",
        extra={"decision_id": decision.id, "committed_by": current_user, "tx_hash": tx_hash},
    )

    return {
        "status": "success",
        "message": "Committed to Zero-Trust Blockchain Ledger",
        "tx_hash": tx_hash,
        "on_chain": True,
        "decision_id": decision.id,
    }


@app.delete("/api/audit-log")
def clear_audit_log(
    data_source: Optional[str] = Query(None, description="Clear only one dashboard's ledger ('predefined' or 'own'). Omit to wipe every decision regardless of source."),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Demo/dev utility: wipes RiskDecision rows so a ledger (and its
    "Committed On-Chain" counter) can be reset back to 0 without touching
    the database by hand between test runs. Requires a valid bearer token,
    same as POST /api/audit - not exposed to anonymous callers.

    [Separate ledgers per dashboard] Scoped to ?data_source=predefined or
    ?data_source=own when given, matching GET /api/audit-log's filter -
    the Ledger page always passes the dashboard it's currently showing, so
    clearing the demo ledger never touches own-data decisions and vice
    versa. Omitting it wipes everything (kept for scripts/tooling that
    relied on the old unscoped behavior).
    """
    query = select(models.RiskDecision)
    if data_source == "predefined":
        query = query.where(
            (models.RiskDecision.data_source == "predefined") | (models.RiskDecision.data_source.is_(None))
        )
    elif data_source == "own":
        query = query.where(models.RiskDecision.data_source == "own")
    decisions = db.exec(query).all()
    caller_is_admin = is_admin(current_user)
    # [Cross-user data leakage / destructive-action fix] Regardless of the
    # data_source filter above (including the "omit to wipe everything"
    # legacy path), an own-data decision belonging to a DIFFERENT account
    # is never deleted here - this used to let any authenticated caller
    # (even a shared demo account) wipe every other account's own-data
    # ledger.
    #
    # [Public demo credentials exposed - fix / RBAC] Predefined/demo rows
    # are the SHARED ledger every visitor sees - previously any
    # authenticated account (including a real signup account any random
    # visitor could create for free) could wipe it for everyone. Now only
    # an admin/demo account (see security.require_admin) may delete
    # predefined rows; a non-admin caller's request still succeeds, it
    # just silently skips the shared rows and only clears their own
    # own-data decisions - preserving "clear my own ledger" self-service
    # without also handing out "clear everyone's ledger".
    decisions = [
        d for d in decisions
        if not (d.data_source == "own" and d.owner_email and d.owner_email != current_user)
        and (caller_is_admin or d.data_source == "own")
    ]
    count = len(decisions)
    for decision in decisions:
        db.delete(decision)
    db.commit()
    admin_actions_logger.info(
        "DELETE /api/audit-log by %s (admin=%s, data_source=%s): removed %d row(s)",
        current_user, caller_is_admin, data_source, count,
    )
    return {"status": "success", "deleted": count}


@app.post("/api/reset-demo")
def reset_demo(
    current_user: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    [Public demo credentials exposed - fix / RBAC] This wipes EVERY
    account's own-data fleet and the entire shared ledger/run history in
    one call (see the "Deliberately unscoped" note below) - previously any
    authenticated account, including a real signup account any visitor
    could create for free, could trigger it. Restricted to admin/demo
    accounts (see security.require_admin); the blast radius here is
    exactly why - unlike DELETE /api/audit-log, there's no "just skip the
    shared rows for a non-admin" middle ground for a full reset.

    Judge-day utility: wipes every piece of session state that can drift or
    accumulate between separate demo runs on the same live instance -
    audit ledger decisions, run history, logged incidents and their
    calibration trend, training completions, and confirmed Ingestion
    Engine mappings - then regenerates a fresh demo fleet and a fresh
    'own'-data starter fleet, so the next person to open the app gets the
    exact same pristine state as a first run.

    Previously the only reset available was DELETE /api/audit-log (just
    the ledger). Everything else kept accumulating across judges/rounds on
    a shared running instance: a widened calibration confidence band from
    someone's earlier "log incident" test, training modules already marked
    100% complete, ingestion mappings from a previous walkthrough - none
    of which resets itself, so the platform could look already-used
    instead of freshly demoable.

    Deliberately unscoped (no ?data_source= filter, unlike /api/audit-log)
    - this is the "start completely over" button, not a partial clear.
    Requires a valid bearer token, same as the other demo-data endpoints,
    since it's fully destructive and irreversible.

    Delete order matters here: CalibrationSnapshot.incident_id is a
    foreign key into IncidentRecord, and TelemetryLog.asset_id into Asset,
    so children are deleted before the parents they reference.
    """
    counts: Dict[str, int] = {}

    def _delete_all(model) -> int:
        rows = db.exec(select(model)).all()
        for row in rows:
            db.delete(row)
        return len(rows)

    # Calibration trend + its source-of-truth incident history (see
    # risk_engine.compute_calibration's docstring: CalibrationSnapshot is
    # just a ledger, IncidentRecord is what calibration is actually
    # computed from - clearing one without the other would leave the next
    # simulation still calibrated against "cleared" incidents).
    counts["calibration_snapshots"] = _delete_all(models.CalibrationSnapshot)
    counts["incident_records"] = _delete_all(models.IncidentRecord)

    # Audit ledger + run history, both dashboards, no data_source filter.
    counts["risk_decisions"] = _delete_all(models.RiskDecision)
    counts["risk_simulations"] = _delete_all(models.RiskSimulation)

    # Training completions and confirmed Ingestion Engine mappings.
    counts["training_records"] = _delete_all(models.TrainingRecord)
    counts["ingested_mappings"] = _delete_all(models.IngestedMapping)

    # 'own'-data Asset/TelemetryLog rows - predefined-side rows are handled
    # by generators.populate_database below, which already scopes itself
    # to 'predefined' (see that function's docstring) and must never touch
    # 'own' rows itself, so they're cleared here instead. TelemetryLog
    # before Asset for the same foreign-key reason as above.
    own_assets = db.exec(select(models.Asset).where(models.Asset.data_source == "own")).all()
    own_asset_ids = [a.id for a in own_assets]
    own_logs = db.exec(
        select(models.TelemetryLog).where(models.TelemetryLog.asset_id.in_(own_asset_ids))
    ).all() if own_asset_ids else []
    for log in own_logs:
        db.delete(log)
    for asset in own_assets:
        db.delete(asset)
    counts["own_assets"] = len(own_assets)
    counts["own_telemetry_logs"] = len(own_logs)

    db.commit()

    # Regenerate the shared demo fleet fresh so the app isn't left empty
    # right after a reset - populate_database wipes+reseeds the
    # ('predefined') side itself.
    #
    # [Cross-user data leakage fix] This used to also eagerly call
    # generators.ensure_own_data_baseline(db) with no owner - back when
    # "own" data was one single global bucket shared by every account,
    # that was how the starter fleet got (re)seeded after a reset. Now
    # that ensure_own_data_baseline requires a real owner_email (see its
    # docstring - every account gets its own starter fleet, not a shared
    # one), there is no single "the" own-data fleet to eagerly reseed
    # here anymore: each account gets its own fleet lazily seeded the
    # first time it asks for its own data (risk_engine.derive_fair_inputs
    # calls ensure_own_data_baseline(db, owner_email) for whichever
    # account is asking), exactly like a brand-new account already works.
    # Calling it here with no owner_email would raise a TypeError (missing
    # required argument) and break this endpoint entirely.
    success, message = generators.populate_database(db)
    if not success:
        raise HTTPException(status_code=500, detail=f"Reset cleared old state but demo reseed failed: {message}")

    admin_actions_logger.info("POST /api/reset-demo by %s (environment=%s): cleared=%s", current_user, ENVIRONMENT, counts)

    return {
        "status": "success",
        "cleared": counts,
        "message": "Demo state reset to pristine - fresh demo fleet regenerated; each account's own-data fleet reseeds the next time it's used.",
    }
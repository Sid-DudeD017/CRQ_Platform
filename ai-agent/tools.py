import logging
import sys
import os
from typing import Optional

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(project_root) # to access backend module

import monte_carlo as quant_mc
import optimizer as quant_opt
from backend import risk_engine
from backend.database import SessionLocal


def _data_source_from_config(config: Optional[RunnableConfig]) -> str:
    """
    Pulls the "predefined" (demo) vs "own" (ingested) data_source out of a
    tool call's RunnableConfig. LangGraph/LangChain inject `config`
    automatically into any tool whose signature type-hints a RunnableConfig
    parameter, and - critically - hide it from the LLM's tool-call schema,
    so the model never has to (and can't) guess or override it; it's set
    once per /api/chat request from the dashboard the user is actually on
    (see backend/main.py) and threaded down through graph.py's specialist
    nodes. Defaults to "predefined" if config is missing/malformed (e.g.
    the graph invoked directly in a test without a config) so this never
    hard-fails - it just falls back to the same default derive_fair_inputs
    itself defaults to.
    """
    if not config:
        return "predefined"
    return (config.get("configurable") or {}).get("data_source", "predefined")


def _owner_email_from_config(config: Optional[RunnableConfig]) -> Optional[str]:
    """
    Companion to _data_source_from_config - pulls the per-account owner
    identity (the JWT `sub`/email backend/main.py's /api/chat now passes
    in alongside data_source) out of a tool call's RunnableConfig. This is
    what lets run_monte_carlo_var / query_telemetry read the SAME
    per-owner "own" data risk_engine.derive_fair_inputs and the
    /api/simulate-risk, /api/audit etc. REST endpoints now scope to,
    instead of the single global "own" bucket every account used to share
    (see backend/models.py's owner_email columns and
    backend/generators.py's per-owner seeding). Returns None if missing -
    every caller here already treats a missing/None owner_email as "stay
    unscoped / fail closed", matching risk_engine's own defaults, so this
    never hard-fails on an old/malformed config either.
    """
    if not config:
        return None
    return (config.get("configurable") or {}).get("owner_email")


@tool
def optimize_budget(budget: float) -> str:
    """
    Calls the Quant Engine's Knapsack Optimizer to maximize Return on Security Investment (ROSI).
    Use this when the user wants to know how best to spend their security budget.

    Uses the exact same three priced controls (Enforce Cloud MFA, Patch Payment Gateway, Zero
    Trust Architecture) shown on the dashboard's Optimizer page - previously this tool had its
    own fictional, dollar-scale patch list that never matched what the app actually showed for
    the same budget.
    """
    opt_results = quant_opt.optimize_budget(risk_engine.SECURITY_CONTROLS, budget)
    return f"Optimized budget for ₹{budget:,.0f}: {opt_results}"


@tool
def run_monte_carlo_var(is_dpdp_applicable: Optional[bool] = None, config: RunnableConfig = None) -> str:
    """
    Triggers the FAIR Monte Carlo Engine to generate Value at Risk (VaR) distribution curves,
    using the SAME live telemetry-derived inputs as the dashboard's Overview page (blast-radius
    vulnerability, control-strength deductions, contextual DPDP trigger, and - see
    risk_engine.compute_calibration - the Closed-Loop Calibration Engine's Bayesian-updated
    control effectiveness and loss-variance widening from real logged incidents) - not a fixed
    made-up range. Pass is_dpdp_applicable to override the automatic DPDP trigger; leave it unset
    to use whatever the live telemetry actually implies.

    `config` is injected by LangGraph (see backend/main.py's /api/chat and ai-agent/graph.py's
    specialist nodes) rather than chosen by the LLM - it carries which dashboard ("predefined"
    demo fleet or "own" ingested data) the user was chatting from, so this reads the SAME
    isolated dataset /api/simulate-risk would for that user, instead of always defaulting to the
    demo fleet regardless of which dashboard asked.
    """
    data_source = _data_source_from_config(config)
    owner_email = _owner_email_from_config(config)
    db = SessionLocal()
    try:
        calibration = risk_engine.get_current_calibration(db)
        inputs = risk_engine.derive_fair_inputs(
            db, dpdp_override=is_dpdp_applicable, calibration=calibration, data_source=data_source,
            owner_email=owner_email,
        )
    finally:
        db.close()

    if inputs is None:
        return "No assets found in the database yet - run mock data generation first (POST /api/generate-mock-data)."

    # derive_fair_inputs() now also returns "risk_drivers" (the Explainable
    # Risk Attribution waterfall), "calibration" (the Closed-Loop
    # Calibration Engine's state), and "provenance" (the evidence trail
    # behind ALE/VaR - see risk_engine.py) keys that run_fair_monte_carlo
    # doesn't accept as keyword arguments; drop all three before spreading
    # the rest of the dict in - see the identical pops in
    # backend/main.py::simulate_risk for why this is non-negotiable
    # (run_fair_monte_carlo has a fixed parameter list with no **kwargs
    # catch-all, so a stray key breaks every single call).
    inputs.pop("risk_drivers", None)
    inputs.pop("calibration", None)
    inputs.pop("provenance", None)
    mc_results = quant_mc.run_fair_monte_carlo(**inputs)
    sebi = mc_results.get("sebi_resilience", {})
    uncertainty_note = ""
    if calibration.get("incident_count", 0) > 0:
        uncertainty_note = (
            f" (calibrated against {calibration['incident_count']} logged incident"
            f"{'s' if calibration['incident_count'] != 1 else ''}, model uncertainty "
            f"{calibration.get('uncertainty_score', 100.0):.0f}/100)"
        )
    return (
        f"Monte Carlo Results (live telemetry): Mean Expected Loss = ₹{mc_results['mean_expected_loss']:,.0f}, "
        f"95th Percentile VaR = ₹{mc_results['var_95']:,.0f}, "
        f"SEBI Cyber Capability Index = {sebi.get('cci_score', 0):.2f}/5{uncertainty_note}"
    )


@tool
def query_telemetry(query: str = "", config: RunnableConfig = None) -> str:
    """
    Queries the central backend database for enterprise telemetry, vulnerability scans, and EDR logs.
    Use this to get context on current network topology (Adjacency Matrix) and active risks.

    Pass an asset ID or (partial, case-insensitive) asset name in `query` to filter to that
    asset's telemetry, e.g. "AST-004" or "payment gateway". Leave `query` blank to get the most
    recent telemetry logs across all assets. Previously this parameter was accepted but never
    actually used - every call returned the same 3 most-recent logs regardless of what was asked.

    `config` is injected by LangGraph, not the LLM - see run_monte_carlo_var's docstring for why.
    It scopes results to the same "predefined" (demo) or "own" (ingested) fleet the user is
    actually looking at, instead of always searching every asset in the database regardless of
    dashboard.
    """
    data_source = _data_source_from_config(config)
    owner_email = _owner_email_from_config(config)
    try:
        from sqlalchemy import and_, or_
        from backend.database import SessionLocal
        from backend.models import TelemetryLog, Asset
        db = SessionLocal()
        # Same predefined/own scoping risk_engine.derive_fair_inputs uses (see
        # that function's asset_scope/log_scope): "own" is a strict match,
        # but "predefined" also has to catch legacy rows with no data_source
        # set at all, or older seeded data would silently vanish from every
        # demo-mode chat answer.
        #
        # [Cross-user data leakage fix] "own" additionally has to be scoped
        # to the requesting account's owner_email - otherwise this chatbot
        # tool would answer with (or leak the existence of) every other
        # account's ingested telemetry, exactly the bug reported against
        # the Own Data Ledger. If no owner_email is available (e.g. an
        # old/direct graph invocation without going through /api/chat),
        # fail closed to "no rows" rather than silently falling back to
        # the old shared-global-bucket behavior.
        if data_source == "own":
            if owner_email:
                asset_scope = and_(Asset.data_source == "own", Asset.owner_email == owner_email)
                log_scope = and_(TelemetryLog.data_source == "own", TelemetryLog.owner_email == owner_email)
            else:
                asset_scope = Asset.id.is_(None)
                log_scope = TelemetryLog.id.is_(None)
        else:
            asset_scope = or_(Asset.data_source == "predefined", Asset.data_source.is_(None))
            log_scope = or_(TelemetryLog.data_source == "predefined", TelemetryLog.data_source.is_(None))

        q = db.query(TelemetryLog).filter(log_scope)
        cleaned = (query or "").strip()
        if cleaned:
            # Match against Asset.id or Asset.name (case-insensitive substring),
            # then filter telemetry to the matching asset IDs. This is the only
            # place a caller can scope the query to one asset instead of the
            # global most-recent-3 fallback.
            like = f"%{cleaned}%"
            matching_asset_ids = [
                a.id for a in db.query(Asset).filter(asset_scope).filter(
                    (Asset.id.ilike(like)) | (Asset.name.ilike(like))
                ).all()
            ]
            if matching_asset_ids:
                q = q.filter(TelemetryLog.asset_id.in_(matching_asset_ids))
            else:
                db.close()
                return f"No asset found matching '{cleaned}'. Try an asset ID (e.g. 'AST-004') or part of its name."
        logs = q.order_by(TelemetryLog.timestamp.desc()).limit(3).all()
        db.close()
        if not logs:
            if cleaned:
                return f"No telemetry logs found for assets matching '{cleaned}'."
            return "No telemetry logs found for the current data set. Please run mock data generation."

        # [AI safety fix - redact sensitive telemetry] Deliberately a
        # hand-picked field list, not `vars(log)`/model_dump() - Asset
        # carries ip_address and this account's own owner_email, neither
        # of which has any reason to ever reach the LLM's context or a
        # chat transcript. Keep this an explicit allowlist of fields (not
        # an exclude-list) if this ever grows: an allowlist fails safe
        # (a new sensitive column added to TelemetryLog/Asset is simply
        # absent from the tool output until someone deliberately adds it
        # here) where an exclude-list fails open.
        results = []
        for log in logs:
            results.append(f"Asset: {log.asset_id}, Vulnerability: {log.vulnerability_score}, Threat: {log.threat_level}, EDR: {log.edr_status}")
        return f"Telemetry results:\n" + "\n".join(results)
    except Exception as e:
        # [API security review / AI safety - safe error messages] This
        # used to hand str(e) straight back to the LLM, which could then
        # repeat internal details (a DB error, a stack fragment) to the
        # end user as if it were a normal answer. Logged server-side in
        # full; the model gets a safe, generic result it can relay
        # honestly without leaking anything internal.
        logging.getLogger("crq.ai_tools").exception("query_telemetry failed")
        return "Telemetry lookup failed due to an internal error. Try again, or ask a different question."

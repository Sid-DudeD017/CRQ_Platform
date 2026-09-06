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
    db = SessionLocal()
    try:
        calibration = risk_engine.get_current_calibration(db)
        inputs = risk_engine.derive_fair_inputs(
            db, dpdp_override=is_dpdp_applicable, calibration=calibration, data_source=data_source,
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
    try:
        from sqlalchemy import or_
        from backend.database import SessionLocal
        from backend.models import TelemetryLog, Asset
        db = SessionLocal()
        # Same predefined/own scoping risk_engine.derive_fair_inputs uses (see
        # that function's asset_scope/log_scope): "own" is a strict match,
        # but "predefined" also has to catch legacy rows with no data_source
        # set at all, or older seeded data would silently vanish from every
        # demo-mode chat answer.
        if data_source == "own":
            asset_scope = Asset.data_source == "own"
            log_scope = TelemetryLog.data_source == "own"
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

        results = []
        for log in logs:
            results.append(f"Asset: {log.asset_id}, Vulnerability: {log.vulnerability_score}, Threat: {log.threat_level}, EDR: {log.edr_status}")
        return f"Telemetry results:\n" + "\n".join(results)
    except Exception as e:
        return f"Error querying telemetry: {str(e)}"

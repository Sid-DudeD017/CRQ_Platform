import sys
import os
from typing import Optional

from langchain_core.tools import tool

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(project_root) # to access backend module

import monte_carlo as quant_mc
import optimizer as quant_opt
from backend import risk_engine
from backend.database import SessionLocal


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
def run_monte_carlo_var(is_dpdp_applicable: Optional[bool] = None) -> str:
    """
    Triggers the FAIR Monte Carlo Engine to generate Value at Risk (VaR) distribution curves,
    using the SAME live telemetry-derived inputs as the dashboard's Overview page (blast-radius
    vulnerability, control-strength deductions, contextual DPDP trigger, and - see
    risk_engine.compute_calibration - the Closed-Loop Calibration Engine's Bayesian-updated
    control effectiveness and loss-variance widening from real logged incidents) - not a fixed
    made-up range. Pass is_dpdp_applicable to override the automatic DPDP trigger; leave it unset
    to use whatever the live telemetry actually implies.
    """
    db = SessionLocal()
    try:
        calibration = risk_engine.get_current_calibration(db)
        inputs = risk_engine.derive_fair_inputs(db, dpdp_override=is_dpdp_applicable, calibration=calibration)
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
def query_telemetry(query: str = "") -> str:
    """
    Queries the central backend database for enterprise telemetry, vulnerability scans, and EDR logs.
    Use this to get context on current network topology (Adjacency Matrix) and active risks.

    Pass an asset ID or (partial, case-insensitive) asset name in `query` to filter to that
    asset's telemetry, e.g. "AST-004" or "payment gateway". Leave `query` blank to get the most
    recent telemetry logs across all assets. Previously this parameter was accepted but never
    actually used - every call returned the same 3 most-recent logs regardless of what was asked.
    """
    try:
        from backend.database import SessionLocal
        from backend.models import TelemetryLog, Asset
        db = SessionLocal()
        q = db.query(TelemetryLog)
        cleaned = (query or "").strip()
        if cleaned:
            # Match against Asset.id or Asset.name (case-insensitive substring),
            # then filter telemetry to the matching asset IDs. This is the only
            # place a caller can scope the query to one asset instead of the
            # global most-recent-3 fallback.
            like = f"%{cleaned}%"
            matching_asset_ids = [
                a.id for a in db.query(Asset).filter(
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
            return "No telemetry logs found in the database. Please run mock data generation."

        results = []
        for log in logs:
            results.append(f"Asset: {log.asset_id}, Vulnerability: {log.vulnerability_score}, Threat: {log.threat_level}, EDR: {log.edr_status}")
        return f"Telemetry results:\n" + "\n".join(results)
    except Exception as e:
        return f"Error querying telemetry: {str(e)}"

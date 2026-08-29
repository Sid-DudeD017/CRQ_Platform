"""
Shared FAIR-input derivation - the single source of truth for turning live
telemetry into the triangular (min, mode, max) inputs the Monte Carlo
engine needs, plus the priced control list the budget optimizer chooses
from.

Extracted out of backend/main.py::simulate_risk so the dashboard's real
/api/simulate-risk endpoint and the Virtual CISO chatbot's tools
(ai-agent/tools.py) call the exact same code instead of maintaining two
copies of this math that can silently drift apart - which is exactly what
had happened (see the Formula Ledger's "Updates Required" #1): the
chatbot was answering budget/risk questions off entirely fictional,
dollar-scale hardcoded data that never matched what the dashboard showed
for the same live telemetry.
"""
from typing import Any, Dict, Optional

from sqlmodel import Session, select

from . import models

# Named to match the "Strategic Controls" toggles on the dashboard
# (frontend/src/app/page.tsx and frontend/src/app/optimize/page.tsx)
# exactly, so every surface that recommends a plan is recommending the
# same three real, rupee-priced controls.
DUMMY_PATCHES = [
    {"id": "Enforce Cloud MFA", "cost": 4500000, "risk_reduction": 18000000},
    {"id": "Patch Payment Gateway", "cost": 12000000, "risk_reduction": 40000000},
    {"id": "Zero Trust Architecture", "cost": 35000000, "risk_reduction": 90000000},
]


def derive_fair_inputs(db: Session, dpdp_override: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    """
    Reads live assets/telemetry/topology and derives the FAIR Monte Carlo
    triangular inputs - blast radius, control-strength deductions,
    contextual DPDP trigger, all of it - exactly the way the dashboard's
    /api/simulate-risk always has. Returns None if no mock data has been
    generated yet (caller decides how to report that).
    """
    assets = db.exec(select(models.Asset)).all()
    if not assets:
        return None

    total_business_value = sum(a.business_value for a in assets)

    latest_logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(len(assets))
    ).all() or []

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

    if dpdp_override is not None:
        is_dpdp = dpdp_override
    # --- END Contextual Triggers ---

    return {
        "tef_min": max(5.0, base_tef - 20), "tef_mode": base_tef, "tef_max": base_tef + 50,
        "tc_min": 20.0, "tc_mode": 60.0, "tc_max": 95.0,
        "cs_min": max(5.0, avg_cs - 15), "cs_mode": avg_cs, "cs_max": min(100.0, avg_cs + 10),
        "plm_min": base_plm * 0.5, "plm_mode": base_plm, "plm_max": base_plm * 2.0,
        "slm_min": base_slm * 0.5, "slm_mode": base_slm, "slm_max": base_slm * 2.0,
        "is_dpdp_applicable": is_dpdp,
    }

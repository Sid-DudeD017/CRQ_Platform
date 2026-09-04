"""
Core database schema for the CRQ Platform backend.

Rebuilt on SQLModel (SQLAlchemy + Pydantic in one) instead of raw
SQLAlchemy declarative models, so request/response validation and the DB
schema never drift apart. Includes Siddharth's CMDB/telemetry merge
(string asset IDs, richer TelemetryLog fields) plus the blockchain audit
fields (tx_hash/on_chain/board_approved) added alongside it.

Compatibility notes:
- Base = SQLModel included for backward compatibility.
- NetworkTopology is replaced by NetworkEdge.
- RiskDecision logs /api/audit's decisions, including whether they made it
  onto the local blockchain (tx_hash/on_chain, filled in shortly after
  creation - see trigger_blockchain_webhook in main.py) and whether board
  approval was recorded for the decision (board_approved - RBI mandate).
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Column, Field, JSON, SQLModel

class ThreatLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class EDRStatus(str, Enum):
    ACTIVE = "ACTIVE"
    WARNING = "WARNING"
    OFFLINE = "OFFLINE"

class Asset(SQLModel, table=True):
    """Business asset - server, laptop, database, gateway, IoT device, etc."""
    id: str = Field(primary_key=True, index=True) # String ID (e.g., 'AST-001')
    name: str = Field(index=True)
    asset_type: str = "Server"
    business_unit: str = Field(default="Corporate IT", index=True)
    business_value: float = Field(default=50000.0)  # read directly by /api/simulate-risk
    criticality_score: int = Field(default=50, ge=0, le=100)

    # 6. Asset Inventories (CMDB)
    ip_address: Optional[str] = None
    data_classification: Optional[str] = None
    business_criticality: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)

class TelemetryLog(SQLModel, table=True):
    """
    One simulated scan/finding event from a security tool (vuln scanner,
    SIEM, EDR, CSPM...).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: str = Field(foreign_key="asset.id", index=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)

    # 1. Vulnerability Management
    cve_ids: Optional[list] = Field(default=None, sa_column=Column(JSON))
    cvss_score: Optional[float] = None
    patch_status: Optional[str] = None

    # 2. SIEM
    event_frequency_24h: int = Field(default=0)
    anomalous_access_flags: int = Field(default=0)
    incident_alert_level: Optional[str] = None

    # 3. IAM
    privilege_level: Optional[str] = None
    excessive_permissions: bool = Field(default=False)
    mfa_active: bool = Field(default=True)

    # 4. EDR
    edr_health_status: Optional[str] = None
    host_compromise_flags: bool = Field(default=False)
    malware_alerts_24h: int = Field(default=0)

    # 5. CSPM
    public_exposure_flag: bool = Field(default=False)
    cloud_misconfigurations_count: int = Field(default=0)

    # 7. Threat Intelligence Feeds
    cisa_kev_presence: bool = Field(default=False)
    threat_actor_chatter: Optional[str] = None

    # Legacy fields
    vulnerability_score: float = Field(default=5.0, ge=0, le=10)
    threat_level: ThreatLevel = ThreatLevel.MEDIUM
    edr_status: EDRStatus = EDRStatus.ACTIVE
    source: str = "vulnerability_scanner"
    metadata_log: Optional[dict] = Field(default=None, sa_column=Column(JSON))

class NetworkEdge(SQLModel, table=True):
    """
    A weighted asset-to-asset network link. /api/topology turns these into
    an adjacency matrix.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_asset_id: str = Field(foreign_key="asset.id", index=True)
    target_asset_id: str = Field(foreign_key="asset.id", index=True)
    weight: float = Field(default=1.0, ge=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class RiskSimulation(SQLModel, table=True):
    """
    One /api/simulate-risk run's stored results. Originally write-only (the
    Reports/Overview pages never read this table back) - active_controls
    and sebi_resilience were added so GET /api/simulations can show a real
    run-over-run analysis ledger: which Strategic Controls were toggled on
    for a given run, and how the SEBI five-pillar score moved, not just the
    bottom-line ALE number. risk_drivers persists the Explainable Risk
    Attribution waterfall (see risk_engine.derive_fair_inputs' risk_drivers
    dict) per run, so a run-over-run comparison can attribute an ALE/CS
    swing to a named cause (a confirmed Ingestion Engine gap, a Training
    coverage change, a telemetry shift) instead of just the bottom line.
    framework_coverage persists the per-control NIST CSF / ISO 27001 / CIS
    Controls crosswalk (see risk_engine.build_framework_coverage) for that
    run's active_controls, so the Reports page's coverage matrix reflects
    real historical posture, not just the current live toggle state.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    expected_annual_loss: float = 0.0
    var_95: Optional[float] = None
    var_99: Optional[float] = None
    monte_carlo_distribution: Optional[list] = Field(default=None, sa_column=Column(JSON))
    optimized_budget_allocation: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    budget_used: Optional[float] = None
    active_controls: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    sebi_resilience: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    risk_drivers: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    framework_coverage: Optional[list] = Field(default=None, sa_column=Column(JSON))

class RiskDecision(SQLModel, table=True):
    """Audit record behind /api/audit."""
    id: Optional[int] = Field(default=None, primary_key=True)
    action: str
    risk_accepted: float
    decided_by: str  # from the verified JWT, never the request body
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tx_hash: Optional[str] = None
    on_chain: bool = False
    board_approved: bool = False  # [RBI MANDATE] set from AuditRequest.board_approved

class IngestedMapping(SQLModel, table=True):
    """
    One confirmed raw-config-line -> standard-parameter mapping from the
    Ingestion Engine (see backend/ingestion_engine.py). Persisting these is
    what makes "Confirm Mapping" real: previously the button just showed a
    toast ("AI Learned") and threw the mapping away - nothing was actually
    trained or kept. GET /api/ingest/mappings reads this table back so the
    page can show a real, growing count instead of a one-off animation.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    line_number: int
    snippet: str
    parameter: str
    risk_tag: str
    confidence: float
    kind: str = "control_present"  # "control_present" | "control_gap"
    severity: str = "info"         # "info" | "warning" | "critical"
    confirmed_by: str              # from the verified JWT, never the request body
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

class IncidentRecord(SQLModel, table=True):
    """
    One real (or near-miss) security incident's actual, after-the-fact
    outcome - the ground truth the Closed-Loop Calibration Engine checks
    every prior FAIR prediction against. Every CRQ platform predicts
    losses; almost none systematically compare those predictions to what
    an incident actually cost and recalibrate. POST /api/incidents logs
    one of these (snapshotting the most recent RiskSimulation's predicted
    ALE at logging time, so prediction_error_pct is computed once and
    never drifts if later runs change the "current" ALE); GET
    /api/calibration reads risk_engine.compute_calibration(...) over every
    row here to produce the calibrated control-effectiveness / loss-
    variance / uncertainty state that derive_fair_inputs() folds back into
    every subsequent simulation - see that function's `calibration` param.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    logged_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    incident_date: datetime = Field(default_factory=datetime.utcnow, index=True)
    business_unit: Optional[str] = None
    vulnerability_class: str = Field(index=True)     # one of risk_engine.VULN_CLASSES
    control_involved: Optional[str] = Field(default=None, index=True)  # a risk_engine.SECURITY_CONTROLS id, if one applied
    was_contained: bool = Field(default=False)
    # 0-100: how much of the attack the control actually stopped - lets a
    # partial containment ("EDR caught the initial payload but not lateral
    # movement") update the Beta posterior as a fractional success instead
    # of forcing a binary contained/not-contained call.
    containment_pct: float = Field(default=0.0, ge=0, le=100)
    downtime_cost: float = Field(default=0.0)
    recovery_cost: float = Field(default=0.0)
    legal_cost: float = Field(default=0.0)
    penalty_cost: float = Field(default=0.0)
    total_actual_loss: float = Field(default=0.0)
    predicted_ale_source_run_id: Optional[int] = Field(default=None, foreign_key="risksimulation.id")
    predicted_ale_at_time: Optional[float] = None
    prediction_error_pct: Optional[float] = None  # (actual - predicted) / predicted * 100
    notes: Optional[str] = None
    logged_by: str  # from the verified JWT, never the request body

class CalibrationSnapshot(SQLModel, table=True):
    """
    A point-in-time capture of risk_engine.compute_calibration()'s output,
    written every time a new IncidentRecord is logged. Calibration itself
    is always a pure, deterministic function of the full IncidentRecord
    history (see compute_calibration) - this table isn't the source of
    truth, it's a run-over-run ledger (same idea as RiskSimulation) so
    GET /api/calibration can show a trend: uncertainty_score falling and
    control-effectiveness confidence intervals narrowing as real incident
    data accumulates, not just the latest snapshot in isolation.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    incident_id: Optional[int] = Field(default=None, foreign_key="incidentrecord.id")
    incident_count: int = 0
    control_effectiveness: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    vuln_class_multipliers: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    business_unit_multipliers: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    loss_variance_multiplier: float = 1.0
    mean_prediction_error_pct: Optional[float] = None
    stdev_prediction_error_pct: Optional[float] = None
    uncertainty_score: float = 100.0

class TrainingRecord(SQLModel, table=True):
    """
    One "module marked complete" record from the Training page (see
    frontend/src/app/training/page.tsx and risk_engine.TRAINING_MODULE_IDS,
    which must list the same module ids). POST /api/training/complete
    toggles a row for (module, completed_by); GET /api/training/progress
    reads them back for the page's completion chart, and
    derive_fair_inputs() in risk_engine.py folds org-wide coverage across
    these into a real Control Strength boost - this is the "natural next
    step" the old Training page roadmap note promised and never built.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    module: str = Field(index=True)         # one of risk_engine.TRAINING_MODULE_IDS
    completed_by: str = Field(index=True)   # from the verified JWT, never the request body
    completed_at: datetime = Field(default_factory=datetime.utcnow)


# Compatibility alias
Base = SQLModel

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
    """One /api/simulate-risk run's stored results."""
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    expected_annual_loss: float = 0.0
    var_95: Optional[float] = None
    monte_carlo_distribution: Optional[list] = Field(default=None, sa_column=Column(JSON))
    optimized_budget_allocation: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    budget_used: Optional[float] = None

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

# Compatibility alias
Base = SQLModel

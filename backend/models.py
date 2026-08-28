"""
Core database schema for the CRQ Platform backend.

Rebuilt on SQLModel (SQLAlchemy + Pydantic in one) instead of raw
SQLAlchemy declarative models, so request/response validation and the DB
schema never drift apart - but every field main.py's /api/simulate-risk
math reads, and every field ai-agent/tools.py's query_telemetry tool reads,
is unchanged in name and meaning.

Compatibility notes:
- `Base = SQLModel` below exists ONLY because tests/test_local.py,
  test_sim.py, and test_endpoints.py do `from backend.models import Base`
  then `Base.metadata.create_all(bind=engine)` - the pre-SQLModel pattern.
  SQLModel's own metaclass already gives every table model shared metadata
  via SQLModel.metadata, so this alias makes both spellings resolve to the
  exact same object.
- NetworkTopology (a single JSON-blob snapshot row) is replaced by
  NetworkEdge (one row per link, hub-and-spoke per business unit instead of
  a flat random coin flip). Nothing in this repo imported NetworkTopology
  by name, so this is safe - main.py's /api/topology now computes the
  matrix from these edges on each call instead of reading a cached blob.
- New: RiskDecision, so /api/audit's decisions are actually persisted
  instead of only ever hitting a print() statement and vanishing on
  restart.
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
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    asset_type: str = "Server"
    business_unit: str = Field(default="Corporate IT", index=True)
    business_value: float = Field(default=50000.0)  # read directly by /api/simulate-risk
    criticality_score: int = Field(default=50, ge=0, le=100)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TelemetryLog(SQLModel, table=True):
    """
    One simulated scan/finding event from a security tool (vuln scanner,
    SIEM, EDR, CSPM...). /api/telemetry and /api/simulate-risk both read
    these exact fields directly, and ai-agent/tools.py's query_telemetry
    tool queries this table straight from the AI layer.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="asset.id", index=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    vulnerability_score: float = Field(default=5.0, ge=0, le=10)
    threat_level: ThreatLevel = ThreatLevel.MEDIUM
    edr_status: EDRStatus = EDRStatus.ACTIVE
    source: str = "vulnerability_scanner"  # scanner/siem/iam/edr/cspm - new field, additive
    metadata_log: Optional[dict] = Field(default=None, sa_column=Column(JSON))


class NetworkEdge(SQLModel, table=True):
    """
    A weighted asset-to-asset network link. /api/topology turns these into
    an adjacency matrix. Hub-and-spoke per business unit (mirrors real
    network segmentation) instead of a flat 20%-chance random coin flip
    between every pair of assets.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_asset_id: int = Field(foreign_key="asset.id", index=True)
    target_asset_id: int = Field(foreign_key="asset.id", index=True)
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
    """
    Audit record behind /api/audit. Append-only - this is what would get
    hashed onto the blockchain ledger. Previously this data only ever hit a
    print() statement; now it's persisted so it survives a restart.

    tx_hash/on_chain are filled in slightly after the row is first created
    (see trigger_blockchain_webhook in main.py) - the row is written
    synchronously so /api/audit can respond immediately with a decision_id,
    then a background task attempts the actual on-chain call and updates
    this same row with the result once it knows it.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    action: str
    risk_accepted: float
    decided_by: str  # from the verified JWT, never the request body
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tx_hash: Optional[str] = None
    on_chain: bool = False


# Compatibility alias - see module docstring.
Base = SQLModel

"""
[Data lifecycle #10 - retention policy]

Documents and enforces this backend's actual data-retention behavior, so
docs/PRIVACY.md's retention claims are backed by real, inspectable code
rather than an aspirational policy nobody wired up.

The policy, deliberately asymmetric:
- RiskDecision rows (the audit/risk-acceptance ledger) are NEVER
  auto-purged by anything in this module. They're this platform's core
  compliance evidence (see models.RiskDecision's docstring and the
  Decision Passport on the Ledger page) - a CRQ platform that quietly
  aged out its own audit trail would defeat the point of having one.
  Deletion of a specific account's decisions only ever happens through
  the explicit, user-initiated DELETE /api/account below.
- Operational/telemetry data (TelemetryLog rows, RiskSimulation run
  history) is exactly what a real retention job SHOULD bound over time -
  it's high-volume, superseded by newer readings, and has no compliance
  requirement to keep forever. purge_stale_operational_data() below is
  the admin-invocable version of that, gated behind POST
  /api/admin/purge-stale-data (see main.py) so it only ever runs when a
  real admin asks for it - there's no background scheduler in this
  process to run it automatically (see README's Data Lifecycle section
  for how to invoke it from an external cron instead).
"""
from datetime import datetime, timedelta
from typing import Dict

from sqlmodel import Session, select

from . import models

# Default cutoff for purge_stale_operational_data() - a year of demo/own
# telemetry and simulation history is already far more than this
# hackathon-scale app needs to keep "live"; older rows are superseded by
# newer readings, not evidence of anything on their own.
DEFAULT_RETENTION_DAYS = 365


def purge_stale_operational_data(db: Session, older_than_days: int = DEFAULT_RETENTION_DAYS) -> Dict[str, int]:
    """
    Deletes TelemetryLog and RiskSimulation rows older than the given
    cutoff. Deliberately does NOT touch RiskDecision (audit ledger),
    IncidentRecord (calibration ground truth - deleting it would silently
    corrupt every future calibration run), IngestedMapping, or any User
    account data. Returns a per-table count of rows removed so the caller
    (the admin endpoint in main.py) can report exactly what happened.
    """
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    deleted: Dict[str, int] = {}

    old_telemetry = db.exec(select(models.TelemetryLog).where(models.TelemetryLog.timestamp < cutoff)).all()
    for row in old_telemetry:
        db.delete(row)
    deleted["telemetry_logs"] = len(old_telemetry)

    old_simulations = db.exec(select(models.RiskSimulation).where(models.RiskSimulation.timestamp < cutoff)).all()
    for row in old_simulations:
        db.delete(row)
    deleted["simulations"] = len(old_simulations)

    db.commit()
    return deleted

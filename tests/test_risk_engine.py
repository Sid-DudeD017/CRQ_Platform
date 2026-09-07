"""
Unit coverage for backend/risk_engine.py: derive_fair_inputs (the FAIR
triangular-input derivation, including the 11-control wiring and the DPDP
contextual trigger) and compute_business_unit_breakdown. Uses a throwaway
in-memory SQLite database via real sqlmodel - not the ai-agent/chatbot
stack, not backend.main - so these are fast, isolated unit tests of the
risk math itself rather than end-to-end API tests (test_api.py already
covers the HTTP layer, including a live /api/simulate-risk bound-clamping
regression check).

Each test seeds only the handful of Asset/TelemetryLog/NetworkEdge rows
needed to isolate the one term under test, so the expected numbers can be
worked out by hand and asserted exactly rather than just "did not crash".
"""
import sys
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend import models, risk_engine  # noqa: E402


@pytest.fixture()
def db():
    """A fresh in-memory SQLite DB per test - no state bleeds between tests."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def mk_asset(session, id, business_unit="Corporate IT", business_value=1_000_000.0, data_classification=None,
             data_source="predefined", owner_email=None):
    a = models.Asset(id=id, name=id, business_unit=business_unit, business_value=business_value,
                      data_classification=data_classification, data_source=data_source, owner_email=owner_email)
    session.add(a)
    return a


def mk_log(session, asset_id, **overrides):
    defaults = dict(
        asset_id=asset_id, vulnerability_score=5.0, threat_level="LOW",
        event_frequency_24h=0, anomalous_access_flags=0, cisa_kev_presence=False,
        incident_alert_level="LOW", mfa_active=True, excessive_permissions=False,
        patch_status="Up to date", cvss_score=None, edr_health_status="Healthy",
        host_compromise_flags=False, public_exposure_flag=False,
        cloud_misconfigurations_count=0,
    )
    defaults.update(overrides)
    log = models.TelemetryLog(**defaults)
    session.add(log)
    return log


def mk_edge(session, src, tgt, weight=1.0):
    e = models.NetworkEdge(source_asset_id=src, target_asset_id=tgt, weight=weight)
    session.add(e)
    return e


def mk_mapping(session, **overrides):
    defaults = dict(
        filename="test.txt", line_number=1, snippet="x", parameter="p", risk_tag="r",
        confidence=1.0, kind="control_gap", severity="critical", confirmed_by="tester",
    )
    defaults.update(overrides)
    m = models.IngestedMapping(**defaults)
    session.add(m)
    return m


def mk_training(session, module, completed_by="tester"):
    r = models.TrainingRecord(module=module, completed_by=completed_by)
    session.add(r)
    return r


def test_no_assets_returns_none(db):
    assert risk_engine.derive_fair_inputs(db, active_controls={}) is None


def test_mfa_control_suppresses_deduction(db):
    mk_asset(db, "AST-1")
    mk_log(db, "AST-1", mfa_active=False)
    db.commit()

    baseline = risk_engine.derive_fair_inputs(db, active_controls={})
    with_mfa = risk_engine.derive_fair_inputs(db, active_controls={"Enforce Cloud MFA": True})

    assert baseline["cs_mode"] == 45.0
    # Calibrated: with no IncidentRecord data yet, eff_mfa falls back to the
    # CONTROL_EFFECTIVENESS_PRIOR prior mean 8.5/(8.5+1.5) = 0.85, so the
    # deduction is only reduced to 5.0*(1-0.85)=0.75, not fully suppressed.
    assert with_mfa["cs_mode"] == 49.25  # 50 - 5.0 * (1 - 0.85)
    assert with_mfa["cs_mode"] > baseline["cs_mode"]


def test_zero_trust_reduces_blast_radius_amplification(db):
    mk_asset(db, "AST-1")
    mk_asset(db, "AST-2")
    mk_log(db, "AST-1")
    mk_log(db, "AST-2")
    mk_edge(db, "AST-1", "AST-2", weight=2.0)
    db.commit()

    no_zt = risk_engine.derive_fair_inputs(db, active_controls={})
    with_zt = risk_engine.derive_fair_inputs(db, active_controls={"Zero Trust Architecture": True})

    # v_intrinsic=5.0 for both assets, one edge weight=2.0 between them, so
    # each asset's neighbor_sum = 5.0 (weighted average of its one neighbor).
    # No Zero Trust: blast_decay=0.2 -> v_eff=5.0+0.2*5.0=6.0 -> avg_cs_upstream
    # = 100 - 6.0*10 = 40.0.
    assert no_zt["cs_mode"] == 40.0
    # With Zero Trust: eff_zt defaults to the prior mean 7.5/(7.5+2.5)=0.75 (no
    # incident data yet), so blast_decay interpolates to 0.2-(0.15*0.75)=0.0875
    # -> v_eff=5.0+0.0875*5.0=5.4375 -> avg_cs_upstream = 100 - 54.375 = 45.625.
    assert with_zt["cs_mode"] == 45.625
    assert with_zt["cs_mode"] > no_zt["cs_mode"]


def test_pii_minimization_suppresses_dpdp_trigger_but_override_wins(db):
    mk_asset(db, "AST-PII", data_classification="PII")
    mk_log(db, "AST-PII", vulnerability_score=8.0)  # v_eff = 8.0 > 7.0, no edges needed
    db.commit()

    baseline = risk_engine.derive_fair_inputs(db, active_controls={})
    minimized = risk_engine.derive_fair_inputs(db, active_controls={"PII Data Minimization & Tokenization": True})
    override = risk_engine.derive_fair_inputs(
        db, active_controls={"PII Data Minimization & Tokenization": True}, dpdp_override=True
    )

    assert baseline["is_dpdp_applicable"] is True
    assert minimized["is_dpdp_applicable"] is False
    assert override["is_dpdp_applicable"] is True  # explicit override always wins


def test_triangular_bounds_are_ordered(db):
    mk_asset(db, "AST-1")
    mk_log(db, "AST-1")
    db.commit()
    out = risk_engine.derive_fair_inputs(db, active_controls={})
    for key in ("tef", "cs", "plm", "slm"):
        lo, mode, hi = out[f"{key}_min"], out[f"{key}_mode"], out[f"{key}_max"]
        assert lo <= mode <= hi, (key, lo, mode, hi)


def test_business_unit_breakdown_allocates_proportionally(db):
    mk_asset(db, "A1", business_unit="Payments", business_value=3_000_000.0)
    mk_asset(db, "A2", business_unit="Retail", business_value=1_000_000.0)
    db.commit()

    breakdown = risk_engine.compute_business_unit_breakdown(db, total_ale=400_000.0)
    by_unit = {row["business_unit"]: row for row in breakdown}

    assert by_unit["Payments"]["allocated_ale"] == pytest.approx(300_000.0)
    assert by_unit["Retail"]["allocated_ale"] == pytest.approx(100_000.0)
    assert sum(r["allocated_ale"] for r in breakdown) == pytest.approx(400_000.0)
    assert breakdown[0]["business_unit"] == "Payments"  # sorted descending by allocated_ale


def test_business_unit_breakdown_empty_when_no_assets(db):
    assert risk_engine.compute_business_unit_breakdown(db, total_ale=100.0) == []


def test_confirmed_ingestion_gaps_lower_cs_mode(db):
    """A confirmed control_gap finding from the Ingestion Engine (see
    backend/ingestion_engine.py) is an always-on Control Strength
    deduction, weighted by severity and the parser's confidence -
    control_present findings must never deduct anything.

    [Stale-test fix] IngestedMapping only ever exists on the 'own data'
    dashboard (see derive_fair_inputs' docstring: "no confirmed mapping is
    ever tagged 'predefined'"), and since the cross-user-isolation fix
    that scoped derive_fair_inputs by data_source/owner_email, calling it
    with the default data_source='predefined' means any confirmed mapping
    is invisible by design - gap_deduction is always 0 there. This test
    was still calling derive_fair_inputs() with no data_source/owner_email
    at all, so it was asserting a scenario the real code path never
    actually exercises. Fixed to seed and read the 'own' dashboard, which
    is the only place a confirmed mapping's deduction is ever live."""
    OWNER = "tester@example.com"
    mk_asset(db, "AST-1", data_source="own", owner_email=OWNER)
    mk_log(db, "AST-1", mfa_active=True, data_source="own", owner_email=OWNER)  # clean telemetry, isolates this term
    db.commit()
    no_gaps = risk_engine.derive_fair_inputs(db, active_controls={}, data_source="own", owner_email=OWNER)
    assert no_gaps["cs_mode"] == 50.0

    mk_mapping(db, severity="critical", confidence=1.0, data_source="own", owner_email=OWNER)
    db.commit()
    with_critical = risk_engine.derive_fair_inputs(db, active_controls={}, data_source="own", owner_email=OWNER)
    assert with_critical["cs_mode"] == 42.0  # 50 - 8.0 * 1.0


def test_confirmed_gap_deduction_is_capped_and_ignores_control_present(db):
    """[Stale-test fix] Same fix as test_confirmed_ingestion_gaps_lower_cs_mode
    above - confirmed mappings only ever apply on the 'own' dashboard."""
    OWNER = "tester@example.com"
    mk_asset(db, "AST-1", data_source="own", owner_email=OWNER)
    mk_log(db, "AST-1", mfa_active=True, data_source="own", owner_email=OWNER)
    for _ in range(20):
        mk_mapping(db, severity="critical", confidence=1.0, data_source="own", owner_email=OWNER)
    mk_mapping(db, kind="control_present", severity="info", confidence=1.0, data_source="own", owner_email=OWNER)  # must not deduct
    db.commit()

    out = risk_engine.derive_fair_inputs(db, active_controls={}, data_source="own", owner_email=OWNER)
    assert out["cs_mode"] == 20.0  # 50 - min(30, 20 * 8.0) = 50 - 30


def test_training_coverage_raises_cs_mode(db):
    """Org-wide Training page completion (see TrainingRecord) is a flat,
    always-on Control Strength boost proportional to how many of the 5
    canonical modules have at least one completion - not gated by
    active_controls, same as the Ingestion Engine gap deduction."""
    mk_asset(db, "AST-1")
    mk_log(db, "AST-1", mfa_active=True)  # clean telemetry, isolates this term
    db.commit()
    no_training = risk_engine.derive_fair_inputs(db, active_controls={})
    assert no_training["cs_mode"] == 50.0

    mk_training(db, risk_engine.TRAINING_MODULE_IDS[0])
    db.commit()
    one_module = risk_engine.derive_fair_inputs(db, active_controls={})
    assert one_module["cs_mode"] == 52.0  # 50 + (1/5 * 10.0)
    assert one_module["cs_mode"] > no_training["cs_mode"]

    for module_id in risk_engine.TRAINING_MODULE_IDS[1:]:
        mk_training(db, module_id)
    db.commit()
    full_coverage = risk_engine.derive_fair_inputs(db, active_controls={})
    assert full_coverage["cs_mode"] == 60.0  # 50 + (5/5 * 10.0)


def test_training_completion_is_deduped_by_distinct_module_not_row_count(db):
    """Two different users completing the same module counts once, not
    twice - coverage is "is this module covered at all", not headcount."""
    mk_asset(db, "AST-1")
    mk_log(db, "AST-1", mfa_active=True)
    mk_training(db, risk_engine.TRAINING_MODULE_IDS[0], completed_by="ciso")
    mk_training(db, risk_engine.TRAINING_MODULE_IDS[0], completed_by="cfo")
    db.commit()

    out = risk_engine.derive_fair_inputs(db, active_controls={})
    assert out["cs_mode"] == 52.0  # still just +1 module's worth, not +2


def test_training_boost_is_clamped_to_100(db):
    """A near-perfect posture plus full training coverage must not push
    cs_mode past the 0-100 Control Strength scale."""
    mk_asset(db, "AST-1")
    mk_log(db, "AST-1", vulnerability_score=0.0, mfa_active=True)  # avg_cs_upstream = 100
    for module_id in risk_engine.TRAINING_MODULE_IDS:
        mk_training(db, module_id)
    db.commit()

    out = risk_engine.derive_fair_inputs(db, active_controls={})
    assert out["cs_mode"] == 100.0  # would be 110 unclamped

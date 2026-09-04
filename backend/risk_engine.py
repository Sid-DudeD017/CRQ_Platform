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
# same eleven real, rupee-priced controls.
#
# Recalibrated (see the "Investment Optimizer formula audit" note) - these
# cost/risk_reduction figures used to be crore-scale (e.g. Zero Trust at
# Rs 35 Cr / Rs 90 Cr reduction), which was sized for the ALE this engine
# produced before the TEF / blast-radius / Control-Strength-floor bugs were
# fixed. Those fixes correctly shrank a mid-size mock org's baseline
# Annualized Loss Expectancy down to roughly Rs 1.4-1.5 Cr, but this catalog
# was never rescaled to match - so all 11 controls together claimed to
# eliminate ~Rs 2.94 Cr of risk against a company that only had ~Rs 1.49 Cr
# of it, and "Residual Exposure" on the Optimizer page floored to Rs 0.00
# after spending as little as ~15% of the budget. These lakh-scale values
# keep each control's relative importance (Zero Trust and Host Isolation
# remain the largest - Zero Trust's blast-radius effect measured a real
# ~17% ALE drop on its own in live testing) but total ~Rs 84L in cost and
# ~Rs 1.60 Cr in claimed reduction - a believable "comprehensive program
# costs a good deal less than one year's expected loss, and doesn't fully
# eliminate it" shape relative to the real baseline ALE.
SECURITY_CONTROLS = [
    {"id": "Enforce Cloud MFA", "cost": 400000, "risk_reduction": 1400000},
    {"id": "Patch Payment Gateway", "cost": 1000000, "risk_reduction": 1800000},
    {"id": "Zero Trust Architecture", "cost": 1600000, "risk_reduction": 2200000},
    # --- 8 additional controls, each wired to its own real FAIR input term
    # in derive_fair_inputs below (never a UI-only toggle) ---
    {"id": "Least-Privilege IAM Review", "cost": 200000, "risk_reduction": 600000},
    {"id": "EDR Health Remediation", "cost": 500000, "risk_reduction": 1200000},
    {"id": "Host Isolation & Incident Containment", "cost": 800000, "risk_reduction": 1900000},
    {"id": "Public Exposure Hardening (WAF)", "cost": 700000, "risk_reduction": 1600000},
    {"id": "CSPM Auto-Remediation", "cost": 500000, "risk_reduction": 1100000},
    {"id": "Threat Intel & KEV Patch Program", "cost": 800000, "risk_reduction": 1400000},
    {"id": "24/7 SOC Monitoring", "cost": 900000, "risk_reduction": 1500000},
    {"id": "PII Data Minimization & Tokenization", "cost": 1000000, "risk_reduction": 1300000},
]

# [ISO/IEC 27001 & CIS Controls v8 mapping] The SIH problem statement
# explicitly names ISO/IEC 27001, NIST CSF, and CIS Controls as frameworks
# to map risk posture against. Previously only NIST CSF got even a loose,
# org-wide mention (see the Docs page's old Compliance Frameworks section)
# and ISO 27001 / CIS Controls were entirely absent from this codebase.
# This is a genuine per-control crosswalk: each SECURITY_CONTROLS id above
# is tagged with the single most representative NIST CSF function,
# ISO/IEC 27001:2022 Annex A control, and CIS Controls v8 Safeguard it
# satisfies. In reality a given control commonly maps to several
# sub-clauses across all three frameworks (official CIS-to-ISO crosswalks
# run many-to-many) - this picks the primary, most defensible one per
# control for a clean 1:1 matrix rather than an exhaustive citation list.
CONTROL_FRAMEWORK_MAP: Dict[str, Dict[str, str]] = {
    "Enforce Cloud MFA": {
        "nist_csf": "Protect (PR.AC-7)",
        "iso27001": "ISO/IEC 27001:2022 A.8.5 Secure authentication",
        "cis_controls": "CIS Controls v8 6.5 Require MFA for Administrative Access",
    },
    "Patch Payment Gateway": {
        "nist_csf": "Protect (PR.IP-12)",
        "iso27001": "ISO/IEC 27001:2022 A.8.8 Management of technical vulnerabilities",
        "cis_controls": "CIS Controls v8 7.4 Perform Automated Application Patch Management",
    },
    "Zero Trust Architecture": {
        "nist_csf": "Protect (PR.AC-5)",
        "iso27001": "ISO/IEC 27001:2022 A.8.22 Segregation of networks",
        "cis_controls": "CIS Controls v8 13.4 Perform Traffic Filtering Between Network Segments",
    },
    "Least-Privilege IAM Review": {
        "nist_csf": "Protect (PR.AC-4)",
        "iso27001": "ISO/IEC 27001:2022 A.8.2 Privileged access rights",
        "cis_controls": "CIS Controls v8 6.8 Define and Maintain Role-Based Access Control",
    },
    "EDR Health Remediation": {
        "nist_csf": "Detect (DE.CM-1)",
        "iso27001": "ISO/IEC 27001:2022 A.8.16 Monitoring activities",
        "cis_controls": "CIS Controls v8 10.5 Centralize Endpoint Detection and Response",
    },
    "Host Isolation & Incident Containment": {
        "nist_csf": "Respond (RS.MI-1)",
        "iso27001": "ISO/IEC 27001:2022 A.5.26 Response to information security incidents",
        "cis_controls": "CIS Controls v8 17.9 Establish and Maintain Security Incident Thresholds",
    },
    "Public Exposure Hardening (WAF)": {
        "nist_csf": "Protect (PR.PT-3)",
        "iso27001": "ISO/IEC 27001:2022 A.8.26 Application security requirements",
        "cis_controls": "CIS Controls v8 13.10 Perform Application Layer Filtering",
    },
    "CSPM Auto-Remediation": {
        "nist_csf": "Protect (PR.IP-1)",
        "iso27001": "ISO/IEC 27001:2022 A.8.9 Configuration management",
        "cis_controls": "CIS Controls v8 4.1 Establish and Maintain a Secure Configuration Process",
    },
    "Threat Intel & KEV Patch Program": {
        "nist_csf": "Identify (ID.RA-2)",
        "iso27001": "ISO/IEC 27001:2022 A.5.7 Threat intelligence",
        "cis_controls": "CIS Controls v8 7.1 Establish and Maintain a Vulnerability Management Process",
    },
    "24/7 SOC Monitoring": {
        "nist_csf": "Detect (DE.CM-7)",
        "iso27001": "ISO/IEC 27001:2022 A.8.16 Monitoring activities",
        "cis_controls": "CIS Controls v8 13.1 Centralize Security Event Alerting",
    },
    "PII Data Minimization & Tokenization": {
        "nist_csf": "Protect (PR.DS-1)",
        "iso27001": "ISO/IEC 27001:2022 A.8.11 Data masking",
        "cis_controls": "CIS Controls v8 3.11 Encrypt Sensitive Data at Rest",
    },
}


def build_framework_coverage(active_controls: Optional[Dict[str, bool]] = None) -> list:
    """
    Real, live coverage matrix: for each of the 11 Strategic Controls, its
    NIST CSF / ISO 27001 / CIS Controls mapping (see CONTROL_FRAMEWORK_MAP
    above) plus whether it's actually active in this run - so the matrix
    reflects the org's real current posture, not a static reference table.
    Called from /api/simulate-risk with that run's active_controls, and
    persisted onto RiskSimulation so GET /api/simulations can show it
    run-over-run on the Reports page too.
    """
    active_controls = active_controls or {}
    return [
        {
            "id": c["id"],
            "active": bool(active_controls.get(c["id"])),
            **CONTROL_FRAMEWORK_MAP[c["id"]],
        }
        for c in SECURITY_CONTROLS
    ]


# The 5 required modules on the Training page (frontend/src/app/training/
# page.tsx's TRAINING_MODULES ids must match this list exactly). Used both
# to compute org-wide training coverage below and by GET
# /api/training/progress to report per-module completion state.
TRAINING_MODULE_IDS = [
    "baseline-awareness",
    "phishing-simulation",
    "dpdp-data-handling",
    "board-briefing",
    "secure-sdlc",
]

# [Closed-Loop "Prediction vs. Actual Loss" Calibration Engine] Every CRQ
# platform predicts losses; almost none systematically compare those
# predictions to what an incident actually cost and recalibrate. This block
# is that feedback loop's math: POST /api/incidents logs a real (or
# near-miss) incident's actual costs (see models.IncidentRecord),
# compute_calibration() turns the accumulated incident history into
# Bayesian-updated control-effectiveness posteriors, vulnerability-class and
# business-unit multipliers, a loss-variance widening factor, and a model
# uncertainty score, and derive_fair_inputs()/compute_business_unit_
# breakdown() below fold that calibration state back into every subsequent
# FAIR simulation - so control effectiveness, asset criticality, and loss
# distribution width all visibly tighten (or correct) as real incident data
# accumulates, instead of the platform asserting the same static assumptions
# forever.

# The incident classes IncidentRecord.vulnerability_class is restricted to.
# TelemetryLog has no per-asset vulnerability-class dimension (it tracks
# CVEs/CVSS/patch status directly, not a class label), so a real incident's
# realized prediction error by class can only be folded back in as one
# incident-weighted, org-wide TEF multiplier (see derive_fair_inputs'
# blended_tef_multiplier) rather than reweighting individual assets - an
# honest limit given what the data model actually tracks.
VULN_CLASSES = [
    "phishing-credential-theft",
    "ransomware",
    "unpatched-exploit",
    "misconfiguration-exposure",
    "insider-privilege-abuse",
    "supply-chain-third-party",
]

# Beta(alpha0, beta0) prior effectiveness for each of the 11 SECURITY_
# CONTROLS, chosen to match what derive_fair_inputs() implicitly assumed
# about that control BEFORE this engine existed - not an arbitrary
# constant. Controls that used to fully zero their deduction the moment
# they were toggled on effectively assumed 100% effectiveness; this engine
# starts them at a more defensible 85% (mean 8.5/(8.5+1.5)) instead, exactly
# the "EDR contained 60% of ransomware attempts, not 85% as assumed" example
# this feature is built around. Controls that were already only ever a
# partial (halving) mitigation - CSPM Auto-Remediation, the KEV Patch
# Program, SOC Monitoring - keep that as their 50% prior (5.0/(5.0+5.0)).
# Zero Trust's blast-radius decay (0.2 -> 0.05, a 75% cut) becomes a 75%
# prior (7.5/(7.5+2.5)). Every one of these priors then updates via real
# IncidentRecord.containment_pct observations against that control, per
# compute_calibration below.
CONTROL_EFFECTIVENESS_PRIOR: Dict[str, tuple] = {
    "Enforce Cloud MFA": (8.5, 1.5),
    "Patch Payment Gateway": (8.5, 1.5),
    "Zero Trust Architecture": (7.5, 2.5),
    "Least-Privilege IAM Review": (8.5, 1.5),
    "EDR Health Remediation": (8.5, 1.5),
    "Host Isolation & Incident Containment": (8.5, 1.5),
    "Public Exposure Hardening (WAF)": (8.5, 1.5),
    "CSPM Auto-Remediation": (5.0, 5.0),
    "Threat Intel & KEV Patch Program": (5.0, 5.0),
    "24/7 SOC Monitoring": (5.0, 5.0),
    "PII Data Minimization & Tokenization": (8.5, 1.5),
}


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _beta_posterior(alpha0: float, beta0: float, observations: list) -> Dict[str, float]:
    """
    Closed-form Beta-Bernoulli conjugate update (no scipy in this
    environment, so mean/variance/CI come straight from the standard Beta
    formulas rather than sampling). Each observation is a containment
    fraction in [0, 1] (IncidentRecord.containment_pct / 100) - treating a
    partial containment as a fractional pseudo-observation lets "EDR caught
    the initial payload but not lateral movement" update the posterior
    proportionally instead of forcing a binary contained/not-contained call.
    """
    alpha, beta = alpha0, beta0
    for obs in observations:
        obs = _clamp(obs, 0.0, 1.0)
        alpha += obs
        beta += (1.0 - obs)
    total = alpha + beta
    mean = alpha / total
    variance = (alpha * beta) / ((total ** 2) * (total + 1.0))
    stdev = variance ** 0.5
    return {
        "alpha": alpha,
        "beta": beta,
        "mean": mean,
        "ci_low": _clamp(mean - 1.96 * stdev, 0.0, 1.0),
        "ci_high": _clamp(mean + 1.96 * stdev, 0.0, 1.0),
    }


def _effectiveness(control_id: str, calibration: Optional[Dict[str, Any]]) -> float:
    """
    Calibrated (Beta-posterior mean) effectiveness for one control, falling
    back to its prior mean when no calibration state was passed or no
    incident has updated it yet. Used throughout derive_fair_inputs so every
    control-linked deduction/multiplier reads calibrated reality instead of
    a hardcoded constant.
    """
    a0, b0 = CONTROL_EFFECTIVENESS_PRIOR[control_id]
    prior_mean = a0 / (a0 + b0)
    if not calibration:
        return prior_mean
    entry = (calibration.get("control_effectiveness") or {}).get(control_id)
    return entry["mean"] if entry else prior_mean


def compute_calibration(incidents: list, assets: list) -> Dict[str, Any]:
    """
    The pure math behind the Closed-Loop Calibration Engine: turns the full
    IncidentRecord history (plus current Asset state) into everything
    derive_fair_inputs() and compute_business_unit_breakdown() need to fold
    real outcomes back into the model. Deterministic and side-effect free -
    CalibrationSnapshot just persists a point-in-time copy of this output
    for GET /api/calibration's trend view; this function is the source of
    truth, not that table.
    """
    control_effectiveness: Dict[str, Any] = {}
    for control_id, (a0, b0) in CONTROL_EFFECTIVENESS_PRIOR.items():
        obs = [
            (ir.containment_pct or 0.0) / 100.0
            for ir in incidents
            if ir.control_involved == control_id
        ]
        posterior = _beta_posterior(a0, b0, obs)
        control_effectiveness[control_id] = {
            "mean": round(posterior["mean"], 4),
            "ci_low": round(posterior["ci_low"], 4),
            "ci_high": round(posterior["ci_high"], 4),
            "n_observations": len(obs),
            "prior_mean": round(a0 / (a0 + b0), 4),
        }

    vuln_class_multipliers: Dict[str, float] = {}
    vuln_class_errors: Dict[str, Any] = {}
    for vc in VULN_CLASSES:
        errs = [
            ir.prediction_error_pct
            for ir in incidents
            if ir.vulnerability_class == vc and ir.prediction_error_pct is not None
        ]
        mean_err = (sum(errs) / len(errs)) if errs else 0.0
        # A positive prediction_error_pct means actual losses ran hotter
        # than predicted for this class - nudge that class's assumed
        # exploitation likelihood up (and back down when the model has been
        # over-predicting), damped at 0.4x so one bad incident can't swing
        # the multiplier wildly, and clamped to a believable 0.5x-2.0x band.
        vuln_class_multipliers[vc] = round(_clamp(1.0 + (mean_err / 100.0) * 0.4, 0.5, 2.0), 4)
        vuln_class_errors[vc] = {
            "n": len(errs),
            "mean_prediction_error_pct": round(mean_err, 2) if errs else None,
        }

    class_counts = {vc: vuln_class_errors[vc]["n"] for vc in VULN_CLASSES}
    total_classed = sum(class_counts.values())
    if total_classed:
        blended_tef_multiplier = _clamp(
            sum(vuln_class_multipliers[vc] * class_counts[vc] for vc in VULN_CLASSES) / total_classed,
            0.5, 2.0,
        )
    else:
        blended_tef_multiplier = 1.0

    # Asset criticality weights based on realized business impact: a
    # business unit whose realized share of total actual incident loss
    # outruns its share of total business_value has proven itself MORE
    # critical than the static asset-value proxy assumed, and the reverse.
    total_actual_loss = sum(ir.total_actual_loss or 0.0 for ir in incidents)
    total_asset_value = sum(a.business_value for a in assets) or 1.0
    unit_value: Dict[str, float] = {}
    for a in assets:
        unit_value[a.business_unit] = unit_value.get(a.business_unit, 0.0) + a.business_value
    business_unit_multipliers: Dict[str, float] = {}
    if total_actual_loss > 0:
        unit_loss: Dict[str, float] = {}
        for ir in incidents:
            if ir.business_unit:
                unit_loss[ir.business_unit] = unit_loss.get(ir.business_unit, 0.0) + (ir.total_actual_loss or 0.0)
        for unit, value in unit_value.items():
            value_share = value / total_asset_value
            loss_share = unit_loss.get(unit, 0.0) / total_actual_loss
            business_unit_multipliers[unit] = round(_clamp(1.0 + (loss_share - value_share) * 2.0, 0.5, 2.0), 4)
    else:
        business_unit_multipliers = {unit: 1.0 for unit in unit_value}

    # Loss distribution parameters: how far off, and how consistently, has
    # this model's ALE prediction been vs what incidents actually cost?
    errs_pct = [ir.prediction_error_pct for ir in incidents if ir.prediction_error_pct is not None]
    if errs_pct:
        mean_err_pct = sum(errs_pct) / len(errs_pct)
        if len(errs_pct) > 1:
            var_err = sum((e - mean_err_pct) ** 2 for e in errs_pct) / (len(errs_pct) - 1)
            stdev_err_pct = var_err ** 0.5
        else:
            stdev_err_pct = abs(mean_err_pct)
    else:
        mean_err_pct = None
        stdev_err_pct = None

    # The noisier/wider realized prediction error has been, the wider the
    # PLM/SLM triangular ranges should get on the next run - a model with a
    # consistent +/-10% error should show tighter bands than one that's
    # swung -60%/+300%. With zero incidents there's no evidence of
    # inconsistency yet, so this stays at 1.0 (no widening) rather than
    # assuming noise that hasn't been observed - exactly like
    # derive_fair_inputs' own cold-start default below.
    loss_variance_multiplier = _clamp(1.0 + ((stdev_err_pct if stdev_err_pct is not None else 0.0) / 100.0), 1.0, 3.0)

    incident_count = len(incidents)
    # Uncertainty score (0-100, lower = more confident): starts at 100 with
    # no incident data and falls off as evidence accumulates, but stays
    # elevated if that evidence has been inconsistent (high prediction-error
    # stdev) rather than just counting incidents.
    base_uncertainty = 100.0 / ((1.0 + incident_count) ** 0.5)
    noise_penalty = min(30.0, (stdev_err_pct if stdev_err_pct is not None else 0.0) * 0.4)
    uncertainty_score = round(_clamp(base_uncertainty + noise_penalty, 5.0, 100.0), 2)

    return {
        "incident_count": incident_count,
        "control_effectiveness": control_effectiveness,
        "vuln_class_multipliers": vuln_class_multipliers,
        "vuln_class_errors": vuln_class_errors,
        "blended_tef_multiplier": round(blended_tef_multiplier, 4),
        "business_unit_multipliers": business_unit_multipliers,
        "loss_variance_multiplier": round(loss_variance_multiplier, 4),
        "mean_prediction_error_pct": round(mean_err_pct, 2) if mean_err_pct is not None else None,
        "stdev_prediction_error_pct": round(stdev_err_pct, 2) if stdev_err_pct is not None else None,
        "uncertainty_score": uncertainty_score,
    }


def get_current_calibration(db: Session) -> Dict[str, Any]:
    """Reads the full IncidentRecord/Asset state and computes calibration -
    the one call GET /api/calibration and simulate_risk both make."""
    incidents = db.exec(select(models.IncidentRecord)).all()
    assets = db.exec(select(models.Asset)).all()
    return compute_calibration(incidents, assets)


def derive_fair_inputs(
    db: Session,
    dpdp_override: Optional[bool] = None,
    active_controls: Optional[Dict[str, bool]] = None,
    calibration: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Reads live assets/telemetry/topology and derives the FAIR Monte Carlo
    triangular inputs - blast radius, control-strength deductions,
    contextual DPDP trigger, all of it - exactly the way the dashboard's
    /api/simulate-risk always has. Returns None if no mock data has been
    generated yet (caller decides how to report that).

    active_controls: which of the three "Strategic Controls" toggles on the
    dashboard (see SECURITY_CONTROLS ids) are currently ON. Previously these
    toggles were purely cosmetic - flipping them changed nothing about the
    simulated ALE/VaR, which let a user "enable" Zero Trust and see no
    effect. Each toggle now suppresses the specific CS-deduction or
    blast-radius term it represents, so turning a control on measurably
    improves Control Strength / lowers effective vulnerability instead of
    just recording a UI checkbox. Defaults to "nothing enabled" (the
    as-observed-in-telemetry baseline) so existing callers (the chatbot's
    tools.py) that don't pass this keep their prior behavior exactly.

    calibration: the Closed-Loop Calibration Engine's state (see
    get_current_calibration / compute_calibration), or None for a "cold
    start" default (no incidents logged yet). When present, every
    active_controls toggle above stops assuming its control is 100% (or a
    hardcoded 50%/75%) effective and instead leaves the calibrated
    (1 - effectiveness) residual of its raw deduction in place, KEV/SOC's
    TEF contributions and Zero Trust's blast-radius decay are scaled the
    same way, the realized-prediction-error-derived blended_tef_multiplier
    and loss_variance_multiplier are applied to TEF and the PLM/SLM ranges
    respectively, and the calibration state itself is returned under the
    "calibration" key so callers can surface confidence intervals and an
    uncertainty score alongside the ALE/VaR figures it informed. See each
    `eff_*` lookup and CONTROL_EFFECTIVENESS_PRIOR above for exactly which
    control maps to which prior.

    Separately (not gated by active_controls), any confirmed Ingestion
    Engine control_gap finding (see IngestedMapping) applies a flat,
    always-on Control Strength deduction - see the comment above
    `confirmed_mappings` below for why this one isn't a toggle. Likewise,
    org-wide Training page completion (see TrainingRecord and
    TRAINING_MODULE_IDS) applies a flat, always-on Control Strength boost -
    see the comment above `training_records` below.
    """
    assets = db.exec(select(models.Asset)).all()
    if not assets:
        return None

    active_controls = active_controls or {}
    mfa_enforced = bool(active_controls.get("Enforce Cloud MFA"))
    patch_enforced = bool(active_controls.get("Patch Payment Gateway"))
    zero_trust_enabled = bool(active_controls.get("Zero Trust Architecture"))
    iam_review_enabled = bool(active_controls.get("Least-Privilege IAM Review"))
    edr_remediation_enabled = bool(active_controls.get("EDR Health Remediation"))
    host_isolation_enabled = bool(active_controls.get("Host Isolation & Incident Containment"))
    exposure_hardening_enabled = bool(active_controls.get("Public Exposure Hardening (WAF)"))
    cspm_auto_remediation_enabled = bool(active_controls.get("CSPM Auto-Remediation"))
    kev_patch_program_enabled = bool(active_controls.get("Threat Intel & KEV Patch Program"))
    soc_monitoring_enabled = bool(active_controls.get("24/7 SOC Monitoring"))
    pii_minimized = bool(active_controls.get("PII Data Minimization & Tokenization"))

    # [Closed-Loop Calibration Engine] Normalize whatever calibration state
    # the caller passed (see get_current_calibration / compute_calibration)
    # into a concrete "cold start" shape when none exists yet (no incidents
    # logged), so every downstream calibrated lookup below can use the same
    # code path whether or not real incident data exists.
    calibration = calibration or {
        "incident_count": 0,
        "control_effectiveness": {},
        "vuln_class_multipliers": {},
        "vuln_class_errors": {},
        "blended_tef_multiplier": 1.0,
        "business_unit_multipliers": {},
        "loss_variance_multiplier": 1.0,
        "mean_prediction_error_pct": None,
        "stdev_prediction_error_pct": None,
        "uncertainty_score": 100.0,
    }
    eff_mfa = _effectiveness("Enforce Cloud MFA", calibration)
    eff_iam = _effectiveness("Least-Privilege IAM Review", calibration)
    eff_patch = _effectiveness("Patch Payment Gateway", calibration)
    eff_edr = _effectiveness("EDR Health Remediation", calibration)
    eff_host_isolation = _effectiveness("Host Isolation & Incident Containment", calibration)
    eff_exposure = _effectiveness("Public Exposure Hardening (WAF)", calibration)
    eff_cspm = _effectiveness("CSPM Auto-Remediation", calibration)
    eff_kev = _effectiveness("Threat Intel & KEV Patch Program", calibration)
    eff_soc = _effectiveness("24/7 SOC Monitoring", calibration)
    eff_zt = _effectiveness("Zero Trust Architecture", calibration)
    blended_tef_multiplier = calibration.get("blended_tef_multiplier", 1.0)
    loss_variance_multiplier = calibration.get("loss_variance_multiplier", 1.0)

    total_business_value = sum(a.business_value for a in assets)

    latest_logs = db.exec(
        select(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(len(assets))
    ).all() or []

    # TEF (Threat Event Frequency) - "how many threat events per year
    # target this organization." FAIR treats this as an org-level rate, not
    # a per-asset one: it should stay roughly the same whether you monitor
    # 5 assets or 500. The previous version summed a fixed penalty per
    # asset showing each signal (e.g. +50 per known-exploited CVE, +20 per
    # CRITICAL alert) across every asset in latest_logs, so TEF scaled
    # linearly with portfolio size and routinely landed in the
    # hundreds-per-year (i.e. "attacked more than once a day"), which then
    # blew up every downstream number (LEF, ALE, VaR). Using each signal's
    # *rate* across the portfolio (0-1) keeps TEF realistic regardless of
    # how many assets are being watched.
    num_logs = len(latest_logs) or 1
    high_threat_count = sum(1 for log in latest_logs if log.threat_level in ("HIGH", "CRITICAL"))
    high_threat_ratio = high_threat_count / num_logs
    avg_event_freq_24h = sum(log.event_frequency_24h for log in latest_logs) / num_logs if latest_logs else 0.0
    avg_anomalous_flags = sum(log.anomalous_access_flags for log in latest_logs) / num_logs if latest_logs else 0.0
    kev_ratio = sum(1 for log in latest_logs if log.cisa_kev_presence) / num_logs if latest_logs else 0.0
    critical_alert_ratio = sum(1 for log in latest_logs if log.incident_alert_level == "CRITICAL") / num_logs if latest_logs else 0.0

    base_tef = 8.0                                        # baseline attempts/yr for a mid-size org
    base_tef += high_threat_ratio * 25.0                  # up to +25 if the whole portfolio is HIGH/CRITICAL
    base_tef += min(avg_event_freq_24h / 500.0, 10.0)      # noisy SIEM volume, capped at +10
    base_tef += min(avg_anomalous_flags * 3.0, 15.0)       # anomalous access, capped at +15
    # [Threat Intel & KEV Patch Program] doesn't eliminate KEV exposure (new
    # CVEs join the list continuously) but a standing patch program against
    # it substantially cuts how often a known-exploited CVE stays open. The
    # 50% assumed cut is now the CALIBRATED effectiveness of this control
    # (CONTROL_EFFECTIVENESS_PRIOR's 0.5 prior until real incidents update
    # it) rather than a hardcoded constant.
    base_tef += kev_ratio * 20.0 * ((1.0 - eff_kev) if kev_patch_program_enabled else 1.0)
    # [24/7 SOC Monitoring] similarly halves rather than zeroes the active
    # CRITICAL-incident contribution - faster detection/triage reduces how
    # long incidents stay in a CRITICAL state, not whether they occur. Same
    # calibration treatment as KEV above.
    base_tef += critical_alert_ratio * 15.0 * ((1.0 - eff_soc) if soc_monitoring_enabled else 1.0)

    # [Closed-Loop Calibration Engine] vulnerability-class exploitation
    # likelihood: TelemetryLog carries no per-asset vulnerability_class
    # dimension, so real incidents' realized prediction error by class
    # (see compute_calibration's vuln_class_multipliers) is folded in here
    # as one incident-weighted, org-wide TEF multiplier rather than a
    # per-asset adjustment - an honest approximation given what the data
    # model actually tracks.
    base_tef *= blended_tef_multiplier

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
        # Clamped to 10 - v_intrinsic is a 0-10 vulnerability_score (see
        # TelemetryLog.vulnerability_score), and blast-radius amplification
        # is meant to push a well-connected asset's *effective*
        # vulnerability toward the worst end of that same scale, not past
        # it. Unclamped, a handful of connected neighbors routinely pushed
        # v_eff well past 10, which then floored avg_cs_upstream below to
        # its minimum on almost every run (100 - avg_vulnerability * 10
        # going negative) - collapsing Control Strength to its floor
        # regardless of actual posture, and making the TC > CS vulnerability
        # check downstream in the Monte Carlo engine deterministic.
        # [Zero Trust Architecture] segments the network and restricts
        # lateral movement, so a compromised neighbor should propagate much
        # less effective vulnerability to this asset - drop the 0.2 blast
        # radius decay factor toward 0.05 while that control is enabled.
        # [Closed-Loop Calibration Engine] "toward" rather than "to": the
        # 0.05 floor assumed Zero Trust was 100% effective at containing
        # lateral movement. It's really CONTROL_EFFECTIVENESS_PRIOR's 0.75
        # prior until incident data says otherwise, so this now interpolates
        # between the 0.2 baseline and the 0.05 floor by calibrated
        # effectiveness instead of jumping straight to the floor.
        blast_decay = (0.2 - (0.2 - 0.05) * eff_zt) if zero_trust_enabled else 0.2
        v_eff[i] = min(10.0, v_intrinsic[i] + (blast_decay * neighbor_sum))

    avg_vulnerability = sum(v_eff) / n if n > 0 else 5.0
    avg_cs_upstream = max(10.0, 100.0 - (avg_vulnerability * 10))
    # --- END Blast Radius ---

    deductions = 0.0
    for log in latest_logs:
        # [Closed-Loop Calibration Engine] Every "enabled" branch below used
        # to zero its deduction outright (assume the control is 100%
        # effective the moment it's toggled on). Real controls never are -
        # each one now leaves a residual (1 - calibrated effectiveness)
        # fraction of its raw deduction in place, starting from
        # CONTROL_EFFECTIVENESS_PRIOR's prior and narrowing as real
        # IncidentRecord containment data updates it (see compute_calibration
        # / _beta_posterior). Enabling a control still always helps; it just
        # no longer claims perfection until incidents prove it.
        # [Enforce Cloud MFA]
        if not log.mfa_active:
            deductions += 5.0 * (1.0 if not mfa_enforced else (1.0 - eff_mfa))
        # [Least-Privilege IAM Review] closes out standing over-broad grants.
        if log.excessive_permissions:
            deductions += 2.0 * (1.0 if not iam_review_enabled else (1.0 - eff_iam))
        # [Patch Payment Gateway] represents an org commitment to close out
        # critical missing patches, so it suppresses the "Missing Critical"
        # patch-status deduction the same way.
        if log.patch_status == "Missing Critical":
            deductions += (log.cvss_score or 10.0) * (1.0 if not patch_enforced else (1.0 - eff_patch))
        # [EDR Health Remediation] restores/replaces unhealthy EDR agents.
        if log.edr_health_status != "Healthy":
            deductions += 4.0 * (1.0 if not edr_remediation_enabled else (1.0 - eff_edr))
        # [Host Isolation & Incident Containment] - the single biggest
        # per-log deduction (a live compromise flag), so this is the
        # highest-cost of the 8 additional controls.
        if log.host_compromise_flags:
            deductions += 20.0 * (1.0 if not host_isolation_enabled else (1.0 - eff_host_isolation))
        # [Public Exposure Hardening (WAF)] closes/shields public exposure.
        if log.public_exposure_flag:
            deductions += 15.0 * (1.0 if not exposure_hardening_enabled else (1.0 - eff_exposure))
        # [CSPM Auto-Remediation] catches known misconfiguration classes
        # automatically but not everything a scanner flags, so it only ever
        # halved rather than zeroed this term - that 50% is now this
        # control's calibrated effectiveness (0.5 prior) too.
        deductions += (log.cloud_misconfigurations_count * 1.0 * ((1.0 - eff_cspm) if cspm_auto_remediation_enabled else 1.0))

    # [Ingestion Engine] Confirmed network-config gaps (weak SNMP string,
    # cleartext enable password, missing BGP neighbor auth, ...) are real,
    # org-wide posture issues an operator has explicitly reviewed and
    # confirmed via the Ingestion Engine (see backend/ingestion_engine.py
    # and the IngestedMapping table) - they aren't tied to a specific
    # asset, so unlike the per-log deductions above this is a flat,
    # always-on deduction rather than something averaged per asset.
    # Weighted by how confident the parser was in the match and how severe
    # the gap is, and capped so a large backlog of confirmed gaps can't by
    # itself floor Control Strength - it still has to combine with actual
    # telemetry-driven weakness to hit the floor. This is what makes the
    # Ingestion Engine's "Confirm Mapping" action visibly move the
    # dashboard's ALE instead of just recording a mapping nobody uses.
    confirmed_mappings = db.exec(select(models.IngestedMapping)).all()
    gap_severity_weight = {"critical": 8.0, "warning": 4.0}
    gap_deduction = min(30.0, sum(
        gap_severity_weight.get(m.severity, 2.0) * m.confidence
        for m in confirmed_mappings if m.kind == "control_gap"
    ))

    # [Training] A trained workforce is what makes every other control on
    # this list actually hold up in practice - MFA enforcement, incident
    # containment, and patch discipline all depend on staff following the
    # process, not just the process existing. Modeled as a flat, always-on
    # Control Strength boost proportional to how many of the 5 canonical
    # modules under /training have at least one completion logged
    # org-wide - not gated by active_controls, same reasoning as the
    # Ingestion Engine gap deduction above: this reflects a real
    # organizational state rather than a per-run what-if toggle. This is
    # the "natural next step" the Training page's roadmap note used to
    # promise and never built.
    training_records = db.exec(select(models.TrainingRecord)).all()
    trained_module_ids = {r.module for r in training_records if r.module in TRAINING_MODULE_IDS}
    training_coverage = len(trained_module_ids) / len(TRAINING_MODULE_IDS)
    training_boost = training_coverage * 10.0  # up to +10 to cs_mode at 100% coverage

    telemetry_deduction = (deductions / max(1, len(latest_logs))) if latest_logs else 0.0
    raw_cs = avg_cs_upstream - telemetry_deduction - gap_deduction + training_boost
    avg_cs = max(5.0, min(100.0, raw_cs))

    # [Explainable Risk Attribution] The dashboard's Control Strength figure
    # used to arrive as a single opaque number - useful for the FAIR math,
    # useless for a board member (or a judge) asking "why did our risk
    # posture move?" Every term that actually built avg_cs above is already
    # sitting in scope right here; this just names and returns them instead
    # of discarding them, so the API/UI can show the real waterfall - blast
    # -radius-adjusted upstream strength, minus live telemetry weaknesses,
    # minus confirmed Ingestion Engine gaps, plus Training coverage - rather
    # than asserting a number nobody can trace. Same idea for TEF: the
    # portfolio-level signal ratios that drove base_tef are named here too,
    # so an ALE swing can be attributed to "more of the fleet reported
    # CRITICAL alerts" instead of just "risk went up."
    risk_drivers = {
        "cs_upstream": round(avg_cs_upstream, 2),
        "avg_effective_vulnerability": round(avg_vulnerability, 2),
        "telemetry_deduction": round(telemetry_deduction, 2),
        "gap_deduction": round(gap_deduction, 2),
        "confirmed_gap_count": sum(1 for m in confirmed_mappings if m.kind == "control_gap"),
        "training_boost": round(training_boost, 2),
        "training_coverage_pct": round(training_coverage * 100.0, 1),
        "trained_module_count": len(trained_module_ids),
        "total_module_count": len(TRAINING_MODULE_IDS),
        "cs_unclamped": round(raw_cs, 2),
        "cs_final": round(avg_cs, 2),
        "cs_was_clamped": raw_cs != avg_cs,
        "tef_base_floor": 8.0,
        "tef_high_threat_ratio": round(high_threat_ratio, 3),
        "tef_kev_ratio": round(kev_ratio, 3),
        "tef_critical_alert_ratio": round(critical_alert_ratio, 3),
        "tef_kev_program_active": kev_patch_program_enabled,
        "tef_soc_monitoring_active": soc_monitoring_enabled,
        "tef_vuln_class_multiplier": round(blended_tef_multiplier, 4),
        "tef_final": round(base_tef, 2),
        "calibration_incident_count": calibration.get("incident_count", 0),
        "calibration_uncertainty_score": calibration.get("uncertainty_score", 100.0),
        "calibration_loss_variance_multiplier": round(loss_variance_multiplier, 4),
    }

    base_plm = total_business_value * 0.05
    base_slm = total_business_value * 0.02

    # --- BEGIN Contextual Statutory Triggers (DPDP Act) ---
    is_dpdp = False
    if not pii_minimized:
        for i, asset in enumerate(assets):
            if asset.data_classification == "PII" and v_eff[i] > 7.0:
                is_dpdp = True
                break

    if dpdp_override is not None:
        is_dpdp = dpdp_override
    # --- END Contextual Triggers ---

    # [Closed-Loop Calibration Engine] the noisier / more inconsistent real
    # incidents have shown this model's ALE predictions to be (see
    # compute_calibration's stdev_prediction_error_pct), the wider the PLM/
    # SLM triangular ranges get - a model whose predictions have swung
    # wildly against reality should show that as real uncertainty on every
    # subsequent Monte Carlo run, not a false-precision fixed 0.5x/2x band.
    return {
        "tef_min": max(5.0, base_tef - 20), "tef_mode": base_tef, "tef_max": base_tef + 50,
        "tc_min": 20.0, "tc_mode": 60.0, "tc_max": 95.0,
        "cs_min": max(5.0, avg_cs - 15), "cs_mode": avg_cs, "cs_max": min(100.0, avg_cs + 10),
        "plm_min": (base_plm * 0.5) / loss_variance_multiplier, "plm_mode": base_plm, "plm_max": (base_plm * 2.0) * loss_variance_multiplier,
        "slm_min": (base_slm * 0.5) / loss_variance_multiplier, "slm_mode": base_slm, "slm_max": (base_slm * 2.0) * loss_variance_multiplier,
        "is_dpdp_applicable": is_dpdp,
        "risk_drivers": risk_drivers,
        "calibration": calibration,
    }


def compute_business_unit_breakdown(
    db: Session,
    total_ale: float,
    calibration: Optional[Dict[str, Any]] = None,
) -> list:
    """
    Allocates the simulation's total Annualized Loss Expectancy across real
    business units, in proportion to each unit's share of total asset
    business_value.

    Replaces the dashboard's "Risk by Business Unit" panel, which was
    previously four fully hardcoded rows (Payment Processing / Retail
    Operations / Corporate IT / Supply Chain with fixed rupee figures and
    bar widths) that never changed no matter what the simulation actually
    produced. This is a proportional allocation, not a per-unit FAIR run -
    it does not know that, say, Payment Processing's assets are riskier
    per-rupee than Corporate IT's; it only knows how much business value
    each unit holds. That's an honest, clearly-labelable approximation
    given the data actually available (Asset.business_unit / business_value),
    versus the fabricated numbers it replaces.

    [Closed-Loop Calibration Engine] calibration (see
    risk_engine.compute_calibration) carries business_unit_multipliers -
    asset criticality weights re-derived from each unit's REALIZED share of
    actual incident loss vs its static business_value share. When present,
    each unit's proportional share is scaled by its multiplier and then
    renormalized so the allocated total still sums to total_ale exactly -
    a unit that's proven costlier than its asset value alone predicted gets
    a larger slice of the same pie, not a bigger pie.
    """
    assets = db.exec(select(models.Asset)).all()
    if not assets:
        return []

    total_value = sum(a.business_value for a in assets) or 1.0

    grouped: Dict[str, Dict[str, Any]] = {}
    for a in assets:
        g = grouped.setdefault(a.business_unit, {"business_value": 0.0, "asset_count": 0})
        g["business_value"] += a.business_value
        g["asset_count"] += 1

    bu_multipliers = (calibration or {}).get("business_unit_multipliers") or {}

    weighted = []
    for unit, g in grouped.items():
        share = g["business_value"] / total_value
        multiplier = bu_multipliers.get(unit, 1.0)
        weighted.append({
            "business_unit": unit,
            "weighted_share": share * multiplier,
            "asset_count": g["asset_count"],
            "criticality_multiplier": multiplier,
        })

    total_weighted = sum(w["weighted_share"] for w in weighted) or 1.0

    breakdown = []
    for w in weighted:
        norm_share = w["weighted_share"] / total_weighted
        breakdown.append({
            "business_unit": w["business_unit"],
            "allocated_ale": total_ale * norm_share,
            "share_pct": norm_share * 100.0,
            "asset_count": w["asset_count"],
            "criticality_multiplier": round(w["criticality_multiplier"], 3),
        })

    breakdown.sort(key=lambda x: x["allocated_ale"], reverse=True)
    return breakdown

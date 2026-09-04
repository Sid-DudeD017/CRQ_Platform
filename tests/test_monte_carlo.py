"""
Unit coverage for quant-engine/monte_carlo.run_fair_monte_carlo - pure
function (numpy/scipy only, no DB), so this runs instantly and offline.
Seeds numpy's global RNG before every call for reproducibility, since the
function itself takes no seed parameter.

Covers the SEBI Cyber Capability Index bound-clamping (each pillar must
stay in [0, 5]) across a spread of realistic-to-extreme inputs, and is a
dedicated regression guard for the cci_contain fix: cci_contain must
compare the sampled secondary_loss against the ceiling it was ACTUALLY
drawn from (slm_max * 2 under DPDP), not the raw slm_max parameter - the
earlier bug compared against the smaller raw value and collapsed contain
toward 0 on every DPDP-applicable run.
"""
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "quant-engine"))

import monte_carlo as quant_mc  # noqa: E402


BASE_INPUTS = dict(
    tef_min=5.0, tef_mode=25.0, tef_max=75.0,
    tc_min=20.0, tc_mode=60.0, tc_max=95.0,
    cs_min=30.0, cs_mode=45.0, cs_max=55.0,
    plm_min=25000.0, plm_mode=50000.0, plm_max=100000.0,
    slm_min=10000.0, slm_mode=20000.0, slm_max=40000.0,
    num_simulations=5000,
)


def test_sebi_resilience_pillars_stay_in_bounds_across_scenarios():
    scenarios = [
        dict(BASE_INPUTS),
        dict(BASE_INPUTS, tef_mode=90.0, tef_max=140.0, cs_min=5.0, cs_mode=10.0, cs_max=20.0),  # bad posture
        dict(BASE_INPUTS, cs_mode=95.0, cs_max=100.0, tef_mode=5.0, tef_max=10.0),                # great posture
        dict(BASE_INPUTS, is_dpdp_applicable=True),
        dict(BASE_INPUTS, plm_min=0.5, plm_mode=1.0, plm_max=2.0, slm_min=0.5, slm_mode=1.0, slm_max=2.0),  # tiny org
    ]
    for scenario in scenarios:
        np.random.seed(42)
        out = quant_mc.run_fair_monte_carlo(**scenario)
        for key, value in out["sebi_resilience"].items():
            assert 0.0 <= value <= 5.0, f"{key} out of [0, 5] bounds: {value} (scenario={scenario})"


def test_cci_contain_does_not_collapse_under_dpdp():
    """Regression guard for the cci_contain fix: comparing against
    slm_max_used (the ceiling actually sampled from) instead of the raw
    slm_max parameter."""
    np.random.seed(7)
    out_dpdp = quant_mc.run_fair_monte_carlo(**dict(BASE_INPUTS, is_dpdp_applicable=True))
    assert out_dpdp["sebi_resilience"]["contain"] > 1.5, out_dpdp["sebi_resilience"]["contain"]


def test_result_shape_and_var_ordering():
    np.random.seed(1)
    out = quant_mc.run_fair_monte_carlo(**BASE_INPUTS)
    for key in ("mean_expected_loss", "var_95", "var_99", "distribution_curve", "sebi_resilience"):
        assert key in out
    assert out["var_99"] >= out["var_95"] >= 0
    assert len(out["distribution_curve"]) == 100

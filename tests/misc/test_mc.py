import sys, os
sys.path.append(os.path.join(os.getcwd(), 'quant-engine'))
from monte_carlo import run_fair_monte_carlo

res = run_fair_monte_carlo(
    tef_min=10.0, tef_mode=50.0, tef_max=100.0,
    tc_min=20.0, tc_mode=60.0, tc_max=95.0,
    cs_min=30.0, cs_mode=50.0, cs_max=80.0,
    plm_min=10000.0, plm_mode=50000.0, plm_max=250000.0,
    slm_min=5000.0, slm_mode=20000.0, slm_max=100000.0,
    is_dpdp_applicable=True
)
print("DPDP True:", res["mean_expected_loss"], res["var_95"])

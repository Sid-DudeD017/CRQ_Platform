import numpy as np
from scipy.stats import gaussian_kde
from typing import Dict, Any

def run_fair_monte_carlo(
    tef_min: float, tef_mode: float, tef_max: float,  # Threat Event Frequency
    tc_min: float, tc_mode: float, tc_max: float,     # Threat Capability (0 to 100)
    cs_min: float, cs_mode: float, cs_max: float,     # Control Strength (0 to 100)
    plm_min: float, plm_mode: float, plm_max: float,  # Primary Loss Magnitude
    slm_min: float, slm_mode: float, slm_max: float,  # Secondary Loss Magnitude
    num_simulations: int = 10000,
    is_dpdp_applicable: bool = False                  # Flag for Native Indian Regulatory Grounding
) -> Dict[str, Any]:
    # 1. Simulate Threat Event Frequency (TEF)
    tef = np.random.triangular(tef_min, tef_mode, tef_max, num_simulations)
    
    # 2. Simulate Vulnerability (Probability that a Threat Event becomes a Loss Event)
    threat_cap = np.random.triangular(tc_min, tc_mode, tc_max, num_simulations)
    control_str = np.random.triangular(cs_min, cs_mode, cs_max, num_simulations)
    
    # Vulnerability is the probability TC > CS, scaled
    vulnerability = np.where(threat_cap > control_str, np.random.uniform(0.6, 0.9, num_simulations), np.random.uniform(0.1, 0.4, num_simulations))
    
    # 3. Calculate Loss Event Frequency (LEF) = TEF * Vulnerability
    lef = tef * vulnerability
    
    # 4. Simulate Probable Loss Magnitude (PLM) = Primary + Secondary Loss
    primary_loss = np.random.triangular(plm_min, plm_mode, plm_max, num_simulations)
    
    if is_dpdp_applicable:
        # [DPDP MANDATE] The DPDP Act's statutory penalties (up to ₹250 Cr
        # for safeguard failures + ₹200 Cr for breach-notification
        # failures = ₹450 Cr) are a regulatory CEILING - the maximum a
        # court could ever levy for the worst possible violation - not a
        # typical per-incident cost. The previous version used that ceiling
        # directly as this distribution's max and added 5% of it
        # (Rs 22.5 Cr) to mode on *every* simulated loss event, which made
        # a rare worst-case fine look like the routine outcome and
        # dominated ALE/VaR by several orders of magnitude. DPDP exposure
        # is real and should raise expected loss - it just shouldn't be
        # modeled as "expect tens of crores in fines on every incident."
        # Scale the existing business-value-derived distribution instead
        # of overriding it with the statutory cap.
        slm_max_adjusted = slm_max * 2.0     # DPDP roughly doubles the realistic worst case
        slm_mode_adjusted = slm_mode * 1.5   # and raises the typical case by half
        secondary_loss = np.random.triangular(slm_min, slm_mode_adjusted, slm_max_adjusted, num_simulations)
        slm_max_used = slm_max_adjusted      # actual ceiling this distribution was drawn from
    else:
        secondary_loss = np.random.triangular(slm_min, slm_mode, slm_max, num_simulations)
        slm_max_used = slm_max
        
    total_loss_magnitude = primary_loss + secondary_loss
    
    # 5. Calculate Annualized Loss Expectancy (ALE)
    annual_losses = lef * total_loss_magnitude
    
    # 6. Extract Metrics
    mean_loss = np.mean(annual_losses)
    var_95 = np.percentile(annual_losses, 95)
    var_99 = np.percentile(annual_losses, 99)
    
    # [NEW SEBI MANDATE] Calculate SEBI Cyber Capability Index (CCI)
    # Mapping mathematical FAIR outputs to the 5 Resilience Goals (0-5 scale)
    # Each pillar clamped to [0, 5] - the upper clamp alone let a high TEF
    # (now common with the blast-radius amplification above) push
    # cci_anticipate, and therefore the overall score, negative.
    cci_anticipate = max(0.0, min(5.0, (100 - np.mean(tef)) / 20))
    cci_withstand = max(0.0, min(5.0, np.mean(control_str) / 20))
    # Contain/Recover used to compare the mean simulated loss against a
    # fixed absolute reference (Rs 1 Cr / Rs 50L) - calibrated for a much
    # larger company than the mock data ever generates (typical plm_mode/
    # slm_mode here are in the low lakhs), so both pinned at the 5/5
    # ceiling on nearly every run regardless of actual posture. Comparing
    # against each company's own worst-case (plm_max/slm_max) instead
    # makes this scale-invariant - the score reflects how close the
    # *typical* simulated outcome runs to *this company's own* worst case,
    # which is what "containment/recovery capability" should mean,
    # whether the company is a startup or a bank.
    # Use slm_max_used (not the raw slm_max parameter) so this stays correct
    # when DPDP applicability widened the actual sampled ceiling above -
    # otherwise contain gets compared against a smaller max than the
    # distribution was actually drawn from and pins near 0.
    cci_contain = max(0.0, min(5.0, 5.0 * (1.0 - (np.mean(secondary_loss) / max(1.0, slm_max_used)))))
    cci_recover = max(0.0, min(5.0, 5.0 * (1.0 - (np.mean(primary_loss) / max(1.0, plm_max)))))
    
    cci_score = (cci_anticipate + cci_withstand + cci_contain + cci_recover) / 4.0
    cci_evolve = max(0.0, min(5.0, cci_score * 1.1)) # Evolution metric
    
    sebi_resilience = {
        "cci_score": float(cci_score),
        "anticipate": float(cci_anticipate),
        "withstand": float(cci_withstand),
        "contain": float(cci_contain),
        "recover": float(cci_recover),
        "evolve": float(cci_evolve)
    }
    
    # 7. Generate Value at Risk Distribution Curve (SciPy KDE)
    kde = gaussian_kde(annual_losses)
    x_vals = np.linspace(min(annual_losses), max(annual_losses), 100)
    y_vals = kde(x_vals)
    
    # Normalize probabilities so the peak is exactly 1.0. 
    # This prevents UI charting libraries (like Recharts) from collapsing 
    # the Y-axis when dealing with extremely small float ranges (1e-10).
    max_y = max(y_vals) if len(y_vals) > 0 and max(y_vals) > 0 else 1.0
    y_vals_normalized = [y / max_y for y in y_vals]
    
    # Format curve for frontend charting
    curve = [{"loss": float(x), "probability": float(y)} for x, y in zip(x_vals, y_vals_normalized)]
    
    return {
        "mean_expected_loss": float(mean_loss),
        "var_95": float(var_95),
        "var_99": float(var_99),
        "distribution_curve": curve,
        "sebi_resilience": sebi_resilience
    }

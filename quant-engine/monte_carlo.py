import numpy as np
from scipy.stats import gaussian_kde
from typing import Dict, Any

def run_fair_monte_carlo(
    tef_min: float, tef_mode: float, tef_max: float,  # Threat Event Frequency
    tc_min: float, tc_mode: float, tc_max: float,     # Threat Capability (0 to 100)
    cs_min: float, cs_mode: float, cs_max: float,     # Control Strength (0 to 100)
    plm_min: float, plm_mode: float, plm_max: float,  # Primary Loss Magnitude
    slm_min: float, slm_mode: float, slm_max: float,  # Secondary Loss Magnitude
    num_simulations: int = 10000
) -> Dict[str, Any]:
    """
    Runs a rigorous FAIR-based Monte Carlo simulation.
    Calculates Loss Event Frequency (LEF) from Threat Event Frequency (TEF) and Vulnerability.
    Calculates Probable Loss Magnitude (PLM) from Primary and Secondary losses.
    Generates Value at Risk distribution curves using SciPy/NumPy.
    """
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
    secondary_loss = np.random.triangular(slm_min, slm_mode, slm_max, num_simulations)
    total_loss_magnitude = primary_loss + secondary_loss
    
    # 5. Calculate Annualized Loss Expectancy (ALE)
    annual_losses = lef * total_loss_magnitude
    
    # 6. Extract Metrics
    mean_loss = np.mean(annual_losses)
    var_95 = np.percentile(annual_losses, 95)
    var_99 = np.percentile(annual_losses, 99)
    
    # 7. Generate Value at Risk Distribution Curve (SciPy KDE)
    kde = gaussian_kde(annual_losses)
    x_vals = np.linspace(min(annual_losses), max(annual_losses), 100)
    y_vals = kde(x_vals)
    
    # Format curve for frontend charting
    curve = [{"loss": float(x), "probability": float(y)} for x, y in zip(x_vals, y_vals)]
    
    return {
        "mean_expected_loss": float(mean_loss),
        "var_95": float(var_95),
        "var_99": float(var_99),
        "distribution_curve": curve
    }

import sys
import os
from langchain_core.tools import tool

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(project_root) # to access backend module

import monte_carlo as quant_mc
import optimizer as quant_opt

@tool
def optimize_budget(budget: float) -> str:
    """
    Calls the Quant Engine's Knapsack Optimizer to maximize Return on Security Investment (ROSI).
    Use this when the user wants to know how best to spend their security budget.
    """
    dummy_patches = [
        {"id": "PATCH-001 (Firewall)", "cost": 5000, "risk_reduction": 20000},
        {"id": "PATCH-002 (EDR Upgrade)", "cost": 15000, "risk_reduction": 60000},
        {"id": "PATCH-003 (IAM Sync)", "cost": 8000, "risk_reduction": 25000},
        {"id": "PATCH-004 (Zero-Trust Proxy)", "cost": 25000, "risk_reduction": 100000},
    ]
    
    opt_results = quant_opt.optimize_budget(dummy_patches, budget)
    return f"Optimized budget for ${budget}: {opt_results}"

@tool
def run_monte_carlo_var() -> str:
    """
    Triggers the FAIR Monte Carlo Engine to generate Value at Risk (VaR) distribution curves.
    """
    mc_results = quant_mc.run_fair_monte_carlo(
        tef_min=10.0, tef_mode=50.0, tef_max=100.0,
        tc_min=20.0, tc_mode=60.0, tc_max=95.0,
        cs_min=30.0, cs_mode=50.0, cs_max=80.0,
        plm_min=10000.0, plm_mode=50000.0, plm_max=250000.0,
        slm_min=5000.0, slm_mode=20000.0, slm_max=100000.0
    )
    return f"Monte Carlo Results: Mean Expected Loss = ${mc_results['mean_expected_loss']:,.2f}, 95th Percentile VaR = ${mc_results['var_95']:,.2f}"

@tool
def query_telemetry(query: str) -> str:
    """
    Queries the central backend database for enterprise telemetry, vulnerability scans, and EDR logs.
    Use this to get context on current network topology (Adjacency Matrix) and active risks.
    """
    try:
        from backend.database import SessionLocal
        from backend.models import TelemetryLog
        db = SessionLocal()
        logs = db.query(TelemetryLog).order_by(TelemetryLog.timestamp.desc()).limit(3).all()
        db.close()
        if not logs:
            return "No telemetry logs found in the database. Please run mock data generation."
        
        results = []
        for log in logs:
            results.append(f"Asset: {log.asset_id}, Vulnerability: {log.vulnerability_score}, Threat: {log.threat_level}, EDR: {log.edr_status}")
        return f"Telemetry results:\n" + "\n".join(results)
    except Exception as e:
        return f"Error querying telemetry: {str(e)}"

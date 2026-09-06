import pulp
from typing import List, Dict, Any

def optimize_budget(patches: List[Dict[str, Any]], budget: float) -> dict:
    """
    Solves a 0/1 Knapsack problem using PuLP to select the optimal set of patches 
    that maximize Return on Security Investment (ROSI) or Risk Reduction, 
    subject to a budget constraint.
    
    Args:
        patches: A list of dictionaries, each containing:
                 - 'id': str, unique identifier for the patch
                 - 'cost': float, cost to implement the patch
                 - 'risk_reduction': float, expected financial risk reduction
        budget: Maximum allowable budget for remediation.
        
    Returns:
        dict containing the optimal selection status, selected patch IDs, 
        total cost, and total risk reduced.
    """
    # Initialize the linear programming maximization problem
    prob = pulp.LpProblem("Security_Budget_Optimization", pulp.LpMaximize)
    
    # Define binary decision variables for each patch
    patch_vars = pulp.LpVariable.dicts("Patch",
                                       [p['id'] for p in patches],
                                       cat=pulp.LpBinary)
    
    # Objective Function: Maximize total risk reduction
    prob += pulp.lpSum([p['risk_reduction'] * patch_vars[p['id']] for p in patches]), "Total_Risk_Reduction"
    
    # Constraint: Total cost must not exceed the budget
    prob += pulp.lpSum([p['cost'] * patch_vars[p['id']] for p in patches]) <= budget, "Budget_Constraint"
    
    # Solve the problem (suppressing output logs)
    prob.solve(pulp.PULP_CBC_CMD(msg=0))
    
    # Extract selected patches
    selected_patches = [p['id'] for p in patches if patch_vars[p['id']].varValue == 1.0]
    
    # Calculate final metrics for the selection
    total_cost = sum([p['cost'] for p in patches if p['id'] in selected_patches])
    total_risk_reduced = sum([p['risk_reduction'] for p in patches if p['id'] in selected_patches])
    
    return {
        "status": pulp.LpStatus[prob.status],
        "selected_patches": selected_patches,
        "total_cost": float(total_cost),
        "total_risk_reduced": float(total_risk_reduced)
    }


def optimize_budget_severity_first(patches: List[Dict[str, Any]], budget: float) -> dict:
    """
    The industry-standard baseline optimize_budget (above) is benchmarked
    against: greedily fund patches in order of severity (a CVSS/KEV-style
    0-10 score - see risk_engine.SECURITY_CONTROLS' "severity" field),
    highest first, until the budget runs out - not by cost-efficiency.

    This mirrors how most organizations actually triage remediation work in
    practice (patch the highest-severity CVEs first) and exists specifically
    so the platform can show, on real numbers, that the 0/1 knapsack
    optimizer above extracts more total_risk_reduced from the same budget
    than severity-first prioritization does - see backend/main.py::
    simulate_risk, which calls both and returns an "optimizer_benchmark"
    comparison alongside the real optimization result.

    Args:
        patches: same shape as optimize_budget's patches, each additionally
                 carrying a 'severity' field (falls back to 0 if absent, so
                 severity-less patches sort last rather than raising).
        budget: same budget constraint as optimize_budget, so the two are
                directly comparable at the same spend.

    Returns:
        dict in the exact same shape as optimize_budget's return value, so
        both can be diffed field-for-field by the caller.
    """
    ranked = sorted(patches, key=lambda p: p.get("severity", 0), reverse=True)

    selected_patches: List[str] = []
    total_cost = 0.0
    total_risk_reduced = 0.0
    remaining = budget

    for p in ranked:
        if p["cost"] <= remaining:
            selected_patches.append(p["id"])
            total_cost += p["cost"]
            total_risk_reduced += p["risk_reduction"]
            remaining -= p["cost"]

    return {
        "status": "Optimal" if selected_patches or not patches else "Infeasible",
        "selected_patches": selected_patches,
        "total_cost": float(total_cost),
        "total_risk_reduced": float(total_risk_reduced),
    }

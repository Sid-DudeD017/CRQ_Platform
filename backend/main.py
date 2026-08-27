import sys
import os
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Any, List

from . import models, database, generators
from .database import engine, get_db

# --- Add sibling directories to path to handle hyphens in folder names ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(project_root, "quant-engine"))
sys.path.append(os.path.join(project_root, "ai-agent"))

import monte_carlo as quant_mc
import optimizer as quant_opt
import graph as ai_graph

# Create the database tables
models.Base.metadata.create_all(bind=engine)

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="CRQ Platform Backend",
    description="Central Router & Data Pipeline for AI-Powered Cyber Risk Quantification",
    version="1.0.0"
)

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins for dev
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Models for Requests ---
class ChatRequest(BaseModel):
    message: str
    context: Dict[str, Any] | None = None

class RiskSimRequest(BaseModel):
    budget: float
    constraints: Dict[str, Any] | None = None

class AuditRequest(BaseModel):
    action: str
    risk_accepted: float
    user_id: str

# --- Endpoints ---

@app.get("/")
def read_root():
    return {"message": "CRQ Platform API Gateway"}

@app.post("/api/generate-mock-data")
def generate_mock_data(db: Session = Depends(get_db)):
    """
    Populates the database with mock enterprise telemetry, assets, and network topology.
    """
    success, message = generators.populate_database(db)
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return {"status": "success", "message": message}

@app.get("/api/telemetry")
def get_telemetry(db: Session = Depends(get_db)):
    """
    Fetch enterprise telemetry data.
    """
    logs = db.query(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(100).all()
    # Mock some data if the database is empty
    if not logs:
        return {
            "status": "success", 
            "data": [{
                "id": 1, 
                "asset_id": "SRV-01", 
                "vulnerability_score": 8.5, 
                "threat_level": "HIGH", 
                "edr_status": "ACTIVE"
            }]
        }
    return {"status": "success", "data": logs}

@app.get("/api/topology")
def get_topology(db: Session = Depends(get_db)):
    """
    Fetch the network topology Adjacency Matrix.
    """
    topology = db.query(models.NetworkTopology).order_by(models.NetworkTopology.timestamp.desc()).first()
    if not topology:
        raise HTTPException(status_code=404, detail="Network topology not found. Run mock data generation first.")
    
    return {
        "status": "success",
        "data": {
            "version": topology.version,
            "adjacency_matrix": topology.adjacency_matrix,
            "node_mapping": topology.node_mapping,
            "timestamp": topology.timestamp
        }
    }

@app.post("/api/simulate-risk")
def simulate_risk(request: RiskSimRequest, db: Session = Depends(get_db)):
    """
    Trigger risk simulation. Routes data to quant-engine (Monte Carlo / Knapsack).
    """
    # 1. Fetch real telemetry and asset data from the database
    assets = db.query(models.Asset).all()
    if not assets:
        raise HTTPException(status_code=400, detail="No assets found. Run /api/generate-mock-data first.")
    
    total_business_value = sum(a.business_value for a in assets)
    
    # Get latest telemetry logs for average vulnerability calculation
    latest_logs = db.query(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).limit(len(assets)).all()
    avg_vulnerability = sum(log.vulnerability_score for log in latest_logs) / len(latest_logs) if latest_logs else 5.0
    
    # Calculate Threat Event Frequency (TEF) based on high threat levels
    high_threat_count = sum(1 for log in latest_logs if log.threat_level in ["HIGH", "CRITICAL"])
    base_tef = 10.0 + (high_threat_count * 5.0)  # More high threats = higher frequency
    
    # Calculate Control Strength (CS) inversely proportional to vulnerability score (0-10)
    # A score of 10 means 0 control strength. A score of 0 means 100 control strength.
    avg_cs = max(10.0, 100.0 - (avg_vulnerability * 10))
    
    # Loss Magnitude (LM) is a fraction of the total business value
    base_plm = total_business_value * 0.05
    base_slm = total_business_value * 0.02
    
    # 2. Run FAIR Monte Carlo using dynamic database values
    mc_results = quant_mc.run_fair_monte_carlo(
        tef_min=max(5.0, base_tef - 10), tef_mode=base_tef, tef_max=base_tef + 20,
        tc_min=20.0, tc_mode=60.0, tc_max=95.0, # Threat capability is generally external, kept constant-ish or modeled
        cs_min=max(5.0, avg_cs - 20), cs_mode=avg_cs, cs_max=min(100.0, avg_cs + 20),
        plm_min=base_plm * 0.5, plm_mode=base_plm, plm_max=base_plm * 2.0,
        slm_min=base_slm * 0.5, slm_mode=base_slm, slm_max=base_slm * 2.0
    )
    
    # 2. Run Knapsack Optimizer with dummy enterprise patches
    dummy_patches = [
        {"id": "PATCH-001 (Firewall)", "cost": 5000, "risk_reduction": 20000},
        {"id": "PATCH-002 (EDR Upgrade)", "cost": 15000, "risk_reduction": 60000},
        {"id": "PATCH-003 (IAM Sync)", "cost": 8000, "risk_reduction": 25000},
        {"id": "PATCH-004 (Zero-Trust Proxy)", "cost": 25000, "risk_reduction": 100000},
    ]
    
    opt_results = quant_opt.optimize_budget(dummy_patches, request.budget)
    
    # Save simulation results to the Postgres database
    sim_record = models.RiskSimulation(
        expected_annual_loss=mc_results["mean_expected_loss"],
        monte_carlo_distribution=mc_results.get("distribution_curve", []),
        optimized_budget_allocation=opt_results
    )
    db.add(sim_record)
    db.commit()
    
    return {
        "status": "success", 
        "message": "Risk simulation completed",
        "budget_used": request.budget,
        "monte_carlo": {
            "mean_expected_loss": mc_results["mean_expected_loss"],
            "var_95": mc_results["var_95"],
            "distribution_curve": mc_results.get("distribution_curve", [])
        },
        "optimization": opt_results
    }

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Interface with the AI Orchestrator & Virtual CISO (Streaming).
    """
    from langchain_core.messages import HumanMessage
    from fastapi.responses import StreamingResponse
    import json
    
    initial_state = {
        "messages": [HumanMessage(content=request.message)]
    }
    
    async def event_stream():
        has_yielded = False
        try:
            # Stream events from LangGraph
            async for event in ai_graph.app.astream_events(initial_state, version="v1"):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        has_yielded = True
                        yield content
                elif kind == "on_chain_end":
                    # If it's one of our fallback nodes emitting an AIMessage
                    if event["name"] in ["security_analyst", "compliance_officer", "quant_analyst"]:
                        msgs = event["data"].get("output", {}).get("messages", [])
                        if msgs and not os.environ.get("OPENAI_API_KEY"):
                            has_yielded = True
                            yield msgs[-1].content
                elif kind == "on_tool_start":
                    has_yielded = True
                    yield f"\n\n[System: Calling tool '{event['name']}']\n\n"
                elif kind == "on_tool_end":
                    has_yielded = True
                    yield f"\n\n[System: Finished tool '{event['name']}']\n\n"
                    
            if not has_yielded:
                yield "I am the Virtual CISO. I can help you query telemetry, optimize budgets, or check compliance frameworks. How can I assist you today?"
        except Exception as e:
            yield f"\n\nError in AI Orchestrator: {str(e)}"

    return StreamingResponse(event_stream(), media_type="text/plain")

def trigger_blockchain_webhook(action: str, risk: float, user: str):
    """
    Mock function to simulate an async webhook to the Hardhat local EVM.
    """
    print(f"\\n[BLOCKCHAIN AUDIT LOG] Successfully committed to AuditLedger.sol!")
    print(f"User: {user} | Action: {action} | Risk Accepted: ${risk:,.2f}\\n")

@app.post("/api/audit")
def log_audit(request: AuditRequest, background_tasks: BackgroundTasks):
    """
    Trigger the blockchain smart contract to log a risk acceptance event.
    """
    # Trigger the smart contract logic in the background so the API returns quickly
    background_tasks.add_task(trigger_blockchain_webhook, request.action, request.risk_accepted, request.user_id)
    
    return {
        "status": "success",
        "message": "Audit logged to Zero-Trust Blockchain Ledger",
        "action": request.action
    }

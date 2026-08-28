import re

with open("backend/main.py", "r") as f:
    content = f.read()

# Add import at the top
if "import blockchain_client" not in content:
    content = content.replace("from typing import Dict, Any, List", "from typing import Dict, Any, List\nfrom . import blockchain_client")

# Replace trigger_blockchain_webhook and log_audit
new_logic = """
def trigger_blockchain_webhook(action: str, risk: float, user: str, decision_id: int, board_approved: bool):
    data_string = f"Action: {action}, Risk: {risk}, DecisionID: {decision_id}"
    tx_hash = blockchain_client.sign_and_send_audit(action, data_string, user, board_approved)
    
    if tx_hash:
        print(f"\\n[BLOCKCHAIN AUDIT LOG] Successfully committed to AuditLedger.sol!")
        print(f"TxHash: {tx_hash} | User: {user} | Action: {action} | Risk: ${risk:,.2f} | Board Approved: {board_approved}\\n")
    else:
        print(f"\\n[BLOCKCHAIN AUDIT LOG] FAILED to commit.\\n")

@app.post("/api/audit")
def log_audit(
    request: AuditRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    decision = models.RiskDecision(
        action=request.action,
        risk_accepted=request.risk_accepted,
        decided_by=current_user,
    )
    db.add(decision)
    db.commit()
    db.refresh(decision)

    # Note: Sending synchronously for hackathon demo to return txHash to UI immediately.
    data_string = f"Action: {request.action}, Risk: {request.risk_accepted}, DecisionID: {decision.id}"
    tx_hash = blockchain_client.sign_and_send_audit(request.action, data_string, current_user, request.board_approved)

    return {
        "status": "success",
        "message": "Audit logged to Zero-Trust Blockchain Ledger",
        "action": request.action,
        "decision_id": decision.id,
        "decided_by": current_user,
        "board_approved": request.board_approved,
        "tx_hash": tx_hash
    }
"""

# Regex replace the old functions
content = re.sub(
    r'def trigger_blockchain_webhook.*?return \{.*?"board_approved": request\.board_approved\n    \}',
    new_logic.strip(),
    content,
    flags=re.DOTALL
)

with open("backend/main.py", "w") as f:
    f.write(content)

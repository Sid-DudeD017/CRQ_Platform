import os
import json
import hashlib
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

RPC_URL = os.getenv("SEPOLIA_RPC_URL", "")
PRIVATE_KEY = os.getenv("PRIVATE_KEY", "")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "")

# Load ABI
abi_path = os.path.join(os.path.dirname(__file__), "AuditLedger.json")
try:
    with open(abi_path, "r") as f:
        contract_json = json.load(f)
        ABI = contract_json.get("abi", [])
except FileNotFoundError:
    ABI = []

def sign_and_send_audit(action: str, data_string: str, user: str, board_approved: bool) -> str:
    if not RPC_URL or not PRIVATE_KEY or not CONTRACT_ADDRESS:
        print("[WARNING] Blockchain credentials not configured. Returning mock hash.")
        return "0xmock_hash_pending_configuration_123456789abcdef"
        
    try:
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        if not w3.is_connected():
            print("[ERROR] Cannot connect to RPC Provider")
            return None
            
        account = w3.eth.account.from_key(PRIVATE_KEY)
        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=ABI)
        
        # Hash the risk data
        data_hash = hashlib.sha256(data_string.encode('utf-8')).hexdigest()
        
        # Build transaction
        nonce = w3.eth.get_transaction_count(account.address)
        
        tx = contract.functions.logRiskAcceptance(
            action, data_hash, user, board_approved
        ).build_transaction({
            'chainId': 11155111, # Sepolia Chain ID
            'gas': 300000,
            'maxFeePerGas': w3.to_wei('10', 'gwei'),
            'maxPriorityFeePerGas': w3.to_wei('2', 'gwei'),
            'nonce': nonce,
        })
        
        # Sign transaction
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
        
        # Send transaction
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction) # type: ignore
        return w3.to_hex(tx_hash)
    except Exception as e:
        print(f"[ERROR] Blockchain transaction failed: {e}")
        return None

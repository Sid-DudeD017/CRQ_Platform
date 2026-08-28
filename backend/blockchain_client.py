"""
Real (local) blockchain client for the AuditLedger smart contract.

Talks to a local Hardhat node - see blockchain/README or plan.md for how
to start one:
    cd blockchain && npm install && npx hardhat node          (tab 1)
    cd blockchain && npx hardhat run scripts/deploy.js --network localhost   (tab 2, once)

Falls back to returning None (mock/no-op) if the node isn't reachable or
the contract hasn't been compiled/deployed yet, so the rest of the app
doesn't break for anyone who isn't running Hardhat locally (e.g. a
teammate just testing /api/simulate-risk on its own).

Uses Hardhat's account #0 as the transaction sender to match
AuditLedger.sol's `onlyServer` modifier, which is set to whichever account
deployed the contract (scripts/deploy.js deploys from the default account,
which is Hardhat's account #0). The private key below is Hardhat's
well-known, publicly-documented default test key - the same for every
Hardhat install everywhere - not a real secret. Never reuse this key or
this approach outside a local Hardhat node.
"""
import json
import os
from pathlib import Path
from typing import Optional

from web3 import Web3

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_PATH = REPO_ROOT / "blockchain" / "artifacts" / "contracts" / "AuditLedger.sol" / "AuditLedger.json"

WEB3_PROVIDER_URL = os.getenv("WEB3_PROVIDER_URL", "http://127.0.0.1:8545")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "0x5FbDB2315678afecb367f032d93F642f64180aa3")
DEPLOYER_PRIVATE_KEY = os.getenv(
    "DEPLOYER_PRIVATE_KEY",
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
)

_contract = None
_w3: Optional[Web3] = None
_account = None


def _get_contract():
    """Lazily connects on first use so importing this module never fails
    just because Hardhat isn't running yet."""
    global _contract, _w3, _account
    if _contract is not None:
        return _contract

    if not ARTIFACT_PATH.exists():
        return None

    try:
        w3 = Web3(Web3.HTTPProvider(WEB3_PROVIDER_URL))
        if not w3.is_connected():
            return None

        with open(ARTIFACT_PATH) as f:
            artifact = json.load(f)

        account = w3.eth.account.from_key(DEPLOYER_PRIVATE_KEY)
        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=artifact["abi"])
    except Exception as e:
        print(f"[blockchain_client] Could not connect to local chain: {e}")
        return None

    _w3, _account, _contract = w3, account, contract
    return _contract


def log_risk_acceptance(action: str, data_hash: str, user: str, board_approved: bool = False) -> Optional[str]:
    """
    Calls AuditLedger.logRiskAcceptance(action, data_hash, user, board_approved)
    on the local Hardhat chain (4-arg signature per Siddharth's RBI-mandate
    contract update - board_approved is recorded on-chain). Returns the
    transaction hash (hex string) on success, or None if no local chain /
    deployed contract is reachable.
    """
    contract = _get_contract()
    if contract is None:
        return None

    try:
        tx = contract.functions.logRiskAcceptance(action, data_hash, user, board_approved).build_transaction({
            "from": _account.address,
            "nonce": _w3.eth.get_transaction_count(_account.address),
        })
        signed = _w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_PRIVATE_KEY)
        raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
        tx_hash = _w3.eth.send_raw_transaction(raw)
        _w3.eth.wait_for_transaction_receipt(tx_hash)
        return tx_hash.hex()
    except Exception as e:
        print(f"[blockchain_client] Transaction failed: {e}")
        return None

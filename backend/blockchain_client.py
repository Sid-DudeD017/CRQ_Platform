"""
Blockchain client for the AuditLedger smart contract.

Talks to whatever EVM JSON-RPC endpoint WEB3_PROVIDER_URL points at - a
local Hardhat node for development, or a real testnet (Sepolia) for a
hosted deployment that can't run its own node:

    Local (Hardhat), see blockchain/README or plan.md:
        cd blockchain && npm install && npx hardhat node                          (tab 1)
        cd blockchain && npx hardhat run scripts/deploy.js --network localhost    (tab 2, once)

    Hosted (Sepolia) - see the README's Deployment section:
        cd blockchain && npx hardhat run scripts/deploy.js --network sepolia

    Either way, `deploy.js` writes WEB3_PROVIDER_URL / CONTRACT_ADDRESS /
    DEPLOYER_PRIVATE_KEY into backend/.env for you - for a hosted backend,
    copy those same three values into its Render env vars (see
    render.yaml) instead of leaving them at the local defaults below.

Falls back to returning None (mock/no-op) if the endpoint isn't reachable
or the contract hasn't been compiled/deployed yet, so the rest of the app
doesn't break for anyone who isn't running a chain at all (e.g. a
teammate just testing /api/simulate-risk on its own).

The transaction sender must match AuditLedger.sol's `onlyServer` modifier,
which is set to whichever account deployed the contract - so
DEPLOYER_PRIVATE_KEY must be that same deployer's key, whether that's
Hardhat's account #0 (local) or your own Sepolia wallet (hosted). The
private key below is Hardhat's well-known, publicly-documented default
test key - the same for every Hardhat install everywhere - not a real
secret, and only a valid default for the LOCAL network. Never reuse this
key, or any other real key, outside a local Hardhat node - see
blockchain/.env.example for how to provision a Sepolia-only wallet.
"""
import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from web3 import Web3

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_PATH = REPO_ROOT / "blockchain" / "artifacts" / "contracts" / "AuditLedger.sol" / "AuditLedger.json"
# [Deployed backend could never reach the chain - fix] ARTIFACT_PATH above
# only exists after someone runs `npx hardhat compile` locally -
# blockchain/artifacts/ is gitignored (it's build output, like any other
# compiled artifact) and Render's build for this service is just
# `pip install -r requirements.txt`; it never touches the blockchain/
# Node project at all. That meant _get_contract() below returned None on
# every single request on the hosted backend, no matter how correctly
# WEB3_PROVIDER_URL/CONTRACT_ADDRESS/DEPLOYER_PRIVATE_KEY were configured
# on Render - "Connect to Blockchain" was never going to work there. The
# actual contract ABI barely changes and is tiny, so it's checked into
# git here and used whenever the Hardhat build output isn't present.
COMMITTED_ABI_PATH = Path(__file__).resolve().parent / "contract_abi.json"

# main.py does `from . import blockchain_client, ...` BEFORE
# `from .database import ...` - database.py is what calls load_dotenv() for
# backend/.env, so without this call this module's os.getenv() calls below
# would run first and silently miss anything set in .env (CONTRACT_ADDRESS
# after a redeploy, a non-default WEB3_PROVIDER_URL, etc). Load it here too
# so this module doesn't depend on some other module's import order.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

WEB3_PROVIDER_URL = os.getenv("WEB3_PROVIDER_URL", "http://127.0.0.1:8545")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "0x5FbDB2315678afecb367f032d93F642f64180aa3")
# Hardhat's well-known, publicly-documented default test private key - the
# same for every Hardhat install everywhere, not a real secret. Only a
# valid default for the LOCAL network (see the module docstring).
_HARDHAT_DEFAULT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # gitleaks:allow
_HARDHAT_DEFAULT_URLS = ("http://127.0.0.1:8545", "http://localhost:8545")
DEPLOYER_PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", _HARDHAT_DEFAULT_KEY)

if DEPLOYER_PRIVATE_KEY == _HARDHAT_DEFAULT_KEY and WEB3_PROVIDER_URL not in _HARDHAT_DEFAULT_URLS:
    # Someone pointed WEB3_PROVIDER_URL at a real network (Sepolia, most
    # likely) but left DEPLOYER_PRIVATE_KEY at Hardhat's public default -
    # every write will fail "Unauthorized" (this key almost certainly
    # didn't deploy that contract) rather than the confusing "can't
    # connect" this module otherwise degrades to silently. Surface it
    # once, at import time, instead of only after the first failed tx.
    print(
        "[blockchain_client] WARNING: WEB3_PROVIDER_URL is set to a non-local "
        "endpoint but DEPLOYER_PRIVATE_KEY is still Hardhat's well-known "
        "default test key. Set DEPLOYER_PRIVATE_KEY to the wallet that "
        "actually deployed AuditLedger.sol on that network (see "
        "blockchain/scripts/deploy.js's output), or every on-chain write "
        "will revert with 'Unauthorized'."
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

    # Prefer a freshly-compiled local Hardhat artifact (covers active
    # contract development), but fall back to the ABI checked into git -
    # this is the only path that exists at all on a hosted backend like
    # Render, which never runs `npx hardhat compile`.
    abi_path = ARTIFACT_PATH if ARTIFACT_PATH.exists() else COMMITTED_ABI_PATH
    if not abi_path.exists():
        return None

    try:
        w3 = Web3(Web3.HTTPProvider(WEB3_PROVIDER_URL))
        if not w3.is_connected():
            return None

        with open(abi_path) as f:
            artifact = json.load(f)

        account = w3.eth.account.from_key(DEPLOYER_PRIVATE_KEY)
        contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=artifact["abi"])
    except Exception as e:
        print(f"[blockchain_client] Could not connect to chain: {e}")
        return None

    _w3, _account, _contract = w3, account, contract
    return _contract


def is_available() -> bool:
    """
    [Degraded-mode / service-health feedback fix] Real, live reachability
    check - attempts the same lazy connection log_risk_acceptance relies
    on (_get_contract) and reports whether it actually succeeded, instead
    of every page finding out only when a specific action (commit-chain)
    fails. Backs GET /api/status below.
    """
    return _get_contract() is not None


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

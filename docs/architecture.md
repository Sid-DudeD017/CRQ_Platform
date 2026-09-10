# System Architecture

## High-level flow

```text
User (Executive / CISO / CFO)
  |
  v
Frontend (Next.js 14 dashboard)
  |
  v
Backend API (FastAPI + SQLModel)
  |
  +--> Ingestion Engine  ---- parses uploaded device configs, proposes compliance mappings
  |
  +--> Quant Engine  ---- FAIR Monte Carlo simulation + 0/1 knapsack budget optimizer
  |
  +--> AI Agent  ---- LangGraph "Virtual CISO", RAG over NIST/RBI/SEBI/DPDP reference docs
  |
  +------------------> Database (PostgreSQL via Neon / SQLite locally)
  |
  v
Blockchain Audit Trail (AuditLedger.sol on Hardhat) -- accepted-risk decisions are hashed and committed
  |
  v
Frontend (results, charts, ledger, reports)
```

## Components

### Frontend (`/frontend`)
Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS. Renders the executive dashboard: Recharts-driven Monte Carlo loss distributions, the Simulation Sandbox, the Investment optimizer, the blockchain-backed Ledger, Calibration, Reports, the Training / Platform Navigation Guide, the CRQ Intelligence rollup view, and a floating Virtual CISO chat widget.

### Backend API (`/backend`)
FastAPI gateway. Owns the database (SQLite locally, PostgreSQL/Neon in production), JWT authentication (PyJWT + bcrypt), rate limiting (slowapi), mock telemetry generation for the Demo data track, the config-ingestion pipeline, and every REST endpoint the frontend calls.

### Ingestion Engine (`/backend/ingestion_engine.py`)
A rule-based parser for uploaded network device configs (Cisco IOS-style / SONiC-grammar). Regex rules match known security-relevant directives line by line (e.g. uRPF, password encryption, SNMP community strings, HTTPS-only management, port security, centralized logging, NTP) plus one cross-line heuristic for BGP neighbor authentication gaps. Each match becomes a `Finding` with a parameter name, risk tag, confidence score, kind (`control_present` / `control_gap`), and severity, which the frontend walks the reviewer through one at a time.

### Quant Engine (`/quant-engine`)
`monte_carlo.py` runs a 10,000+ iteration FAIR simulation (triangular-distributed loss magnitude x frequency) over the active asset/vulnerability/control set to produce Annualized Loss Expectancy (ALE), Value at Risk (VaR) at 95% confidence, and a SEBI Cyber Capability Index. `optimizer.py` solves a 0/1 knapsack problem (via PuLP/CBC) to pick the combination of security controls that reduces the most risk per rupee of a given remediation budget.

### AI Agent (`/ai-agent`)
A LangGraph multi-agent "Virtual CISO" (Security Analyst / Compliance Officer / Quant Analyst sub-agents) backed by Groq (Llama models), with a ChromaDB RAG index over NIST CSF, RBI, SEBI CSCRF, and DPDP Act 2023 reference material. Answers security and compliance questions grounded in the session's actual live risk data - never fed uploaded file content directly (see the ingestion engine's isolation note).

### Blockchain (`/blockchain`)
`AuditLedger.sol`, a Solidity contract deployed via Hardhat. Every "Accept Risk" or "Approve & Log" decision is hashed and committed on-chain, producing a tamper-evident audit trail - a local Hardhat node for development, or a public testnet for a hosted deployment.

### Database
PostgreSQL (via [Neon](https://neon.tech)) in production, SQLite for local development, accessed through SQLModel/SQLAlchemy. Stores users, assets, telemetry, simulation runs, ingestion findings, ledger entries, and compliance training progress.

## Two independent data tracks

The platform keeps **Demo data** and **your own uploaded data** in genuinely separate pools (assets, telemetry, simulations, and mapped ingestion findings are all tagged by `data_source`) - running a simulation in one mode never reads or writes the other's rows. Model training/compliance coverage and the Closed-Loop Calibration Engine are the one exception: they represent real organizational facts, so they stay shared across both modes by design.

## For your own project

This document should stay in sync with the actual services above as the architecture evolves - update the flow diagram and component list whenever a service is added, renamed, or its responsibilities change.

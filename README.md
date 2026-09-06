# 🛡️ CRQ Platform — AI-Powered Cyber Risk Quantification

[![GitHub](https://img.shields.io/badge/GitHub-Sid--DudeD017%2FCRQ__Platform-blue?logo=github)](https://github.com/Sid-DudeD017/CRQ_Platform)
[![CI](https://github.com/Sid-DudeD017/CRQ_Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Sid-DudeD017/CRQ_Platform/actions/workflows/ci.yml)
![SIH](https://img.shields.io/badge/Smart%20India%20Hackathon-2025-orange)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)

An AI-powered **Cyber Risk Quantification (CRQ)** platform that turns raw network telemetry into financial risk numbers — Annualized Loss Expectancy (ALE) and Value at Risk (VaR) — instead of red/yellow/green heatmaps. Built for Smart India Hackathon 2025.

It bridges enterprise telemetry, **FAIR Monte Carlo risk math**, a **0/1 knapsack budget optimizer**, a **LangGraph-based Virtual CISO** for compliance Q&A, and a **blockchain-backed audit trail** so accepted-risk decisions can't be quietly edited after the fact.

---

## 📋 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Tech Stack](#-tech-stack)
- [Features](#-features)
- [Project Structure](#-project-structure)
- [Data Model](#-data-model)
- [Getting Started](#-getting-started)
- [Step-by-Step Run Instructions](#️-step-by-step-run-instructions)
- [Environment Variables](#-environment-variables)
- [API Documentation](#-api-documentation)
- [Testing & CI](#-testing--ci)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Security Notes](#-security-notes)
- [License](#-license)

---

## 🏗️ Architecture Overview

```mermaid
flowchart LR
    User(["Executive / CISO / CFO"]) --> FE["Frontend\nNext.js 14 dashboard"]
    FE -->|"HTTP (NEXT_PUBLIC_API_URL)"| BE["Backend Gateway\nFastAPI + SQLModel"]

    BE --> ING["Ingestion Engine\nParses uploaded network configs"]
    BE --> QE["Quant Engine\nFAIR Monte Carlo + Knapsack optimizer"]
    BE --> AI["AI Agent\nLangGraph + Groq + ChromaDB RAG"]
    BE --> DB[("Database\nPostgres (Neon) / SQLite")]
    BE -->|"Accept Risk (JWT-gated)"| BC["Blockchain Audit Trail\nAuditLedger.sol on Hardhat"]

    AI -.->|RAG| DOCS[("Compliance docs\nNIST / RBI / SEBI / DPDP")]
    ING -.->|"seeds"| DB
```

- **Frontend (`/frontend`)** — Next.js 14 executive dashboard: Recharts-driven Monte Carlo distributions, a budget-optimizer sandbox, a blockchain-backed ledger, a compliance training module, and a floating Virtual CISO chat.
- **Backend API (`/backend`)** — FastAPI gateway. Owns the database (SQLite locally, Postgres/Neon in production), JWT auth, mock telemetry generation, the config-ingestion pipeline, and every REST endpoint the frontend calls.
- **Quant Engine (`/quant-engine`)** — `monte_carlo.py` runs a 10,000+ iteration FAIR simulation (triangular-distributed loss magnitude × frequency) to produce ALE, VaR, and a SEBI Cyber Capability Index; `optimizer.py` solves a 0/1 knapsack (via PuLP/CBC) to pick the set of security controls that cuts the most risk per rupee of budget.
- **AI Agent (`/ai-agent`)** — A LangGraph multi-agent "Virtual CISO" (Security Analyst / Compliance Officer / Quant Analyst sub-agents) backed by Groq, with a ChromaDB RAG index over NIST CSF, RBI, SEBI CSCRF, and DPDP Act 2023 reference material.
- **Blockchain (`/blockchain`)** — `AuditLedger.sol`, a Hardhat/Solidity contract. Every "Accept Risk" decision is hashed and committed on-chain against a local Hardhat node, so the ledger is tamper-evident (disabled in the hosted demo — see [Deployment](#-deployment)).

### Two independent data tracks

The platform keeps **Demo data** and **your own uploaded data** in genuinely separate pools (assets, telemetry, simulations, and mapped ingestion findings are all tagged by `data_source`) — running a simulation in one mode never reads or writes the other's rows. Model training/compliance coverage and the Closed-Loop Calibration Engine are the one exception: they represent real organizational facts, so they stay shared across both modes by design.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Recharts |
| Backend | FastAPI, SQLModel + SQLAlchemy, Pydantic, slowapi (rate limiting) |
| Database | PostgreSQL via [Neon](https://neon.tech) (production) / SQLite (local dev) |
| Auth | JWT (PyJWT), bcrypt password hashing |
| Quant Engine | NumPy, SciPy, PuLP (CBC solver) |
| AI Agent | LangGraph, LangChain, Groq (Llama), ChromaDB (RAG) |
| Blockchain | Solidity, Hardhat, web3.py |
| Testing | pytest, GitHub Actions CI |
| Deployment | Vercel (frontend), Render (backend), Neon (database) |

---

## ✨ Features

| Feature | Description |
|---|---|
| **Demo vs. Own Data** | Run instantly against realistic generated telemetry, or upload your own network configs — kept in fully isolated data pools, switchable anytime without losing either side's history. |
| **Ingestion Engine** | Rule-based parser (`backend/ingestion_engine.py`) that reads uploaded Cisco IOS-style / SONiC configs and finds real, line-addressable security findings (weak SNMP communities, cleartext passwords, missing uRPF/port-security, unauthenticated BGP neighbors, and more) with per-rule confidence scores — not a single hardcoded example mapping. |
| **FAIR Monte Carlo Simulation** | 10,000+ iteration simulation over live telemetry, producing Annualized Loss Expectancy, 95% Value at Risk, a full loss-distribution curve, and a SEBI Cyber Capability Index. |
| **Explainable Risk Attribution** | The dashboard shows the actual control-strength waterfall behind each score — upstream control strength, telemetry deductions, ingestion gap deductions, training boost — not just the final number. |
| **Budget Optimizer** | 0/1 knapsack solver picks the exact set of security controls that maximizes risk reduction per rupee of a given budget. |
| **Blockchain Audit Trail** | Every accepted-risk decision is hashed and committed on-chain (`AuditLedger.sol`), so the ledger can't be quietly edited after the fact. |
| **Virtual CISO (AI Chat)** | LangGraph agent that routes compliance/security/budget questions to specialized sub-agents, backed by a RAG index over real regulatory text (NIST, RBI, SEBI, DPDP). Now requires login. |
| **Closed-Loop Calibration** | Real incident outcomes feed back into the model, narrowing confidence intervals and sharpening future control-effectiveness estimates over time. |
| **Training & Compliance Module** | A standalone module (`/training`) covering security-awareness modules that feed into the Control Strength score, plus a platform navigation guide — independent of picking Demo or Own Data. |
| **Reports & Ledger** | Board-ready report snapshots and a full audit-log ledger, both scoped per data track. |

---

## 📁 Project Structure

```
CRQ_Platform/
│
├── frontend/                       # Next.js 14 dashboard
│   └── src/
│       ├── app/
│       │   ├── overview/           # Demo dashboard (ALE, VaR, loss distribution)
│       │   ├── ingestion/          # Own-data upload + parsed findings (own-data "Overview")
│       │   ├── optimize/           # Budget optimizer sandbox
│       │   ├── ledger/             # Blockchain-backed risk decision ledger
│       │   ├── calibration/        # Closed-loop calibration trends
│       │   ├── reports/            # Board report snapshots
│       │   ├── training/           # Standalone compliance training + nav guide
│       │   ├── docs/ , support/    # In-app documentation & support
│       │   └── page.tsx            # '/' — Home (always; see SharedLayout)
│       ├── components/             # SharedLayout, VirtualCisoChat, CommandPalette, ...
│       ├── context/                # AuthContext, ThemeContext, ToastContext
│       └── lib/                    # api.ts (API_BASE, fetchWithRetry)
│
├── backend/                        # FastAPI gateway
│   ├── main.py                     # All REST endpoints
│   ├── models.py                   # SQLModel tables
│   ├── database.py                 # DB engine + lightweight self-migration
│   ├── risk_engine.py              # FAIR-input derivation, shared by API + AI agent
│   ├── ingestion_engine.py         # Network-config rule parser
│   ├── generators.py               # Mock telemetry + own-data baseline seeding
│   ├── security.py                 # JWT auth, password hashing, demo accounts
│   └── blockchain_client.py        # web3.py client for the Hardhat audit trail
│
├── quant-engine/
│   ├── monte_carlo.py              # FAIR Monte Carlo simulation
│   └── optimizer.py                # 0/1 knapsack budget optimizer (PuLP)
│
├── ai-agent/                       # Virtual CISO
│   ├── graph.py                    # LangGraph multi-agent orchestrator
│   ├── rag.py                      # ChromaDB RAG over compliance docs
│   └── tools.py                    # Tools the agent calls (shares risk_engine math)
│
├── blockchain/                     # Hardhat + Solidity
│   ├── contracts/AuditLedger.sol
│   └── scripts/                    # Deploy scripts
│
├── tests/                          # pytest suite (API, ingestion, Monte Carlo, risk engine)
├── .github/workflows/ci.yml        # Backend tests + frontend lint/build on every push
├── render.yaml                     # Render Blueprint for the backend
└── requirements.txt                # Backend + quant-engine + ai-agent Python deps
```

---

## 🗄️ Data Model

| Table | Purpose |
|---|---|
| `Asset` | Devices/systems in scope, tagged `data_source` (demo vs. own). |
| `TelemetryLog` | Per-asset vulnerability/compromise signals (simulated SIEM/CSPM feed). |
| `NetworkEdge` | Network topology graph for blast-radius calculations. |
| `RiskSimulation` | Stored results of each Monte Carlo run (ALE, VaR, drivers). |
| `RiskDecision` | Accepted-risk audit entries, optionally committed on-chain. |
| `IngestedMapping` | Findings extracted from an uploaded config by the Ingestion Engine. |
| `IncidentRecord` | Real incident outcomes fed into the Closed-Loop Calibration Engine. |
| `CalibrationSnapshot` | Calibration trend over time (uncertainty narrowing, posteriors). |
| `TrainingRecord` | Per-user progress through the compliance training modules. |
| `User` | Real signed-up accounts (bcrypt-hashed passwords), alongside the two hardcoded demo accounts. |

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | v18+ | Frontend |
| Python | 3.10+ | Backend, quant engine, AI agent |
| npm | latest | Frontend package management |
| A Groq API key | free — [console.groq.com/keys](https://console.groq.com/keys) | Virtual CISO agent (`GROQ_API_KEY`) |
| Node.js + npx (optional) | — | Local Hardhat node, for the on-chain audit trail |

An `OPENAI_API_KEY` also works as a fallback if `GROQ_API_KEY` isn't set (see `ai-agent/graph.py`), but costs money — Groq is free and the default.

### 1. Backend Setup

```bash
# From the repo root
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp backend/.env.example backend/.env
# then edit backend/.env — generate a real SECRET_KEY:
#   openssl rand -hex 32

cp ai-agent/.env.example ai-agent/.env
# then paste your own GROQ_API_KEY into ai-agent/.env
```

### 2. Frontend Setup

```bash
cd frontend
npm install
```

Create `frontend/.env.local` if you're pointing at a non-default backend URL (see [Environment Variables](#-environment-variables)).

---

## 🏃‍♂️ Step-by-Step Run Instructions

Run these in separate terminals from the repo root (backend) and `frontend/` (frontend).

**Terminal 1 — Backend (port 8000)**
```bash
source venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
✅ Expected: `Uvicorn running on http://0.0.0.0:8000` — Swagger docs at `http://localhost:8000/docs`.

**Terminal 2 — Frontend (port 3000)**
```bash
cd frontend
npm run dev
```
✅ Expected: `Ready on http://localhost:3000`.

**Terminal 3 — Local Hardhat node (optional, for the on-chain audit trail)**
```bash
cd blockchain
npx hardhat node
```
Without this running, "Accept Risk" decisions still persist to the database — they just won't get a transaction hash.

Open **http://localhost:3000**, sign up or log in, and pick Demo Data, Own Data, or Training on the start screen.

### Quick end-to-end test

1. **Generate mock telemetry** (Demo mode): `curl -X POST http://localhost:8000/api/generate-mock-data`, or trigger it from Swagger at `/docs`.
2. **Run a simulation**: on `/overview`, adjust the budget slider and click Run Simulation — the backend derives FAIR inputs from telemetry, runs the Monte Carlo engine, and plots the VaR distribution.
3. **Talk to the Virtual CISO**: click the floating chat button (bottom-right, any page) and ask something like *"What are the RBI regulations regarding telemetry?"* — you'll need to be logged in.
4. **Accept a risk decision**: from the sandbox, click Accept Risk. This calls `POST /api/audit`, which now requires a bearer token — see [API Documentation](#-api-documentation).

---

## 🔐 Environment Variables

**`backend/.env`**
```bash
# Leave unset for local dev — defaults to a local SQLite file (crq_db.sqlite3)
DATABASE_URL=postgresql://<user>:<password>@<host>.neon.tech/<dbname>?sslmode=require

SECRET_KEY=<generate with: openssl rand -hex 32>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

**`ai-agent/.env`**
```bash
GROQ_API_KEY=<your key from console.groq.com/keys>
OPENAI_API_KEY=            # optional fallback, only used if GROQ_API_KEY is unset
```

**`frontend/.env.local`** *(only needed if the backend isn't on `http://localhost:8000`)*
```bash
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

All of the above are gitignored — never commit real values. `backend/.env.example` and `ai-agent/.env.example` are the templates checked into the repo.

---

## 📚 API Documentation

Full interactive docs (Swagger UI) are always available at `/docs` on a running backend (e.g. `http://localhost:8000/docs`).

| Method | Endpoint | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | Demo accounts (`ciso`/`cfo`) or a real signed-up account. Returns a bearer token. |
| `POST` | `/api/auth/signup` | Creates a real account (bcrypt-hashed password), logs it straight in. |
| `POST` | `/api/generate-mock-data` | (Re)generates the Demo-mode telemetry pool. |
| `GET` | `/api/telemetry` | Latest telemetry per asset. |
| `POST` | `/api/upload-telemetry` | Upload a telemetry file. |
| `GET` | `/api/topology` | Network graph for blast-radius calculations. |
| `POST` | `/api/simulate-risk` | Runs the FAIR Monte Carlo simulation; `data_source` selects Demo vs. Own Data. |
| `GET` | `/api/simulations` | Simulation history, filterable by `data_source`. |
| `POST` | `/api/ingest/parse` | Parses an uploaded config, returns candidate findings. |
| `POST` | `/api/ingest/confirm` | Confirms findings into `IngestedMapping` (own-data only). |
| `GET` | `/api/ingest/mappings` | Confirmed ingestion findings. |
| `POST` / `GET` | `/api/training/complete`, `/api/training/progress` | Compliance training progress. |
| `POST` / `GET` | `/api/incidents` | Real incident records feeding the calibration engine. |
| `GET` | `/api/calibration` | Current calibration snapshot + trend. |
| `POST` | `/api/chat` | **Requires auth.** Streams a Virtual CISO response. |
| `POST` | `/api/audit` | **Requires auth.** Accepts a risk decision; acting user comes from the token, not the request body. |
| `GET` | `/api/audit-log` | Ledger entries, filterable by `data_source`. |
| `POST` | `/api/audit-log/{decision_id}/commit-chain` | Commits a decision on-chain. |
| `DELETE` | `/api/audit-log` | Clears the ledger for a `data_source`. |

**Example — log in, then accept a risk decision:**
```bash
# 1. Log in, get a token
curl -X POST http://localhost:8000/api/auth/login -d "username=ciso&password=demo-ciso-pass"

# 2. Call a protected endpoint with it
curl -X POST http://localhost:8000/api/audit \
  -H "Authorization: Bearer <token from step 1>" \
  -H "Content-Type: application/json" \
  -d '{"action": "accept_risk", "risk_accepted": 50000}'
```

Demo credentials (swap for real accounts before this is anything but a hackathon demo — see `backend/security.py`):

| username | password |
|---|---|
| `ciso` | `demo-ciso-pass` |
| `cfo` | `demo-cfo-pass` |

---

## 🧪 Testing & CI

```bash
pytest -v
```

`tests/` covers the API (`test_api.py`), the ingestion rule parser, the Monte Carlo engine, and the risk engine — all offline, no API keys or live services needed (`test_api.py` forces a throwaway SQLite DB and disables the real Groq call). GitHub Actions (`.github/workflows/ci.yml`) runs this suite plus a frontend lint + build on every push to `main` and every pull request.

---

## ☁️ Deployment

The hosted demo runs the **frontend on Vercel**, the **backend on Render**, backed by a **Neon Postgres** database. `render.yaml` is a Render Blueprint — in the Render dashboard, choose *New → Blueprint*, connect this repo, and it pre-fills the service; you paste in `DATABASE_URL` and `GROQ_API_KEY` yourself, and Render auto-generates a real `SECRET_KEY`.

The on-chain audit trail needs a local Hardhat node, so it's only available when running the stack locally — in the hosted demo, accepted-risk decisions still persist to the database, just without a transaction hash.

> Remember: Vercel/Render only rebuild from what's pushed to GitHub. After merging changes locally, push to `main` (and trigger a redeploy if it isn't set to auto-deploy) before expecting the live site to reflect them.

---

## 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| `address already in use` on port 8000/3000 | Kill the process on that port, or change the port in the run command. |
| Simulation returns no data / "no assets found" | Run `POST /api/generate-mock-data` first (Demo mode), or upload + confirm a config (Own Data mode). |
| Virtual CISO chat says please log in | `/api/chat` requires a bearer token — log in first. |
| `GROQ_API_KEY` missing | Chat falls back to `OPENAI_API_KEY` if set; otherwise the agent can't respond. |
| CORS error in the browser console | Check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches where the backend is actually running. |
| Accept Risk / commit-chain fails | The local Hardhat node (`npx hardhat node` in `blockchain/`) isn't running — decisions still save to the database either way. |

---

## 🔒 Security Notes

- Passwords for real (non-demo) accounts are bcrypt-hashed, never stored in plaintext.
- `/api/chat` and `/api/audit` require a valid bearer token; the acting user is read from the token, not the request body.
- `fetchWithRetry` (frontend) only retries on network errors/5xx responses and forces a clean logout on a 401, instead of retrying or silently failing on bad credentials.
- Demo vs. Own Data are isolated at the query level — a demo run never reads or writes your uploaded data's rows, and vice versa.
- `backend/.env` and `ai-agent/.env` are gitignored; only `.env.example` templates (with placeholder values) are committed.

---

## 📄 License

No license file has been added to this repository yet — all rights reserved by default until one is chosen (MIT is a common choice for hackathon projects; add a `LICENSE` file to make usage terms explicit).

---

## 🙏 Acknowledgments

Built for **Smart India Hackathon 2025** — an AI-powered platform for quantifying cyber risk in financial terms rather than qualitative heatmaps, aligned to NIST CSF, RBI, SEBI CSCRF, and the DPDP Act 2023.

**Repository:** https://github.com/Sid-DudeD017/CRQ_Platform

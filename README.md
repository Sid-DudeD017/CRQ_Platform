# 🛡️ CRQ Platform — AI-Powered Cyber Risk Quantification

[![GitHub](https://img.shields.io/badge/GitHub-Sid--DudeD017%2FCRQ__Platform-blue?logo=github)](https://github.com/Sid-DudeD017/CRQ_Platform)
[![CI](https://github.com/Sid-DudeD017/CRQ_Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Sid-DudeD017/CRQ_Platform/actions/workflows/ci.yml)
![SIH](https://img.shields.io/badge/Smart%20India%20Hackathon-2026-orange)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)

This repository follows the SIH 2026 project submission structure. Source code lives in per-service folders (`frontend/`, `backend/`, `quant-engine/`, `ai-agent/`, `blockchain/`), documentation in `docs/`, screenshots in `assets/screenshots/`, and final submission media in `submission/`.

## 1. Project Information

- **Project Title:** CRQ Platform — AI-Powered Cyber Risk Quantification
- **PS ID:** `<SIH26105>`
- **PS Title:** `<AI-Powered Continuous Cyber Risk Quantification and Investment Optimization Platform>`
- **Category:** Software
- **Theme:** `<Blockchain & Cybersecurity>`
- **Team Name:** `<SecureX>`
- **Team Members:** `<Siddharth Bhakta>`, `<Raghav Gupta>`, `<Shubhika>`, `<Shreeyansh Singh Sajwan>`, `<Vivek Phogat>`, `<Dushyant>`

## 2. Problem Statement

Most organizations still assess cyber risk with qualitative red/yellow/green heatmaps. A heatmap tells a CISO a risk is "high," but it cannot tell a CFO or a board how many rupees that risk is actually worth, whether last quarter's security spend measurably reduced it, or which of ten competing controls should get the next rupee of budget. Risk-acceptance decisions are also rarely tamper-evident — there is usually no auditable record of who accepted what risk, when, and why.

## 3. Proposed Solution

CRQ Platform turns raw network telemetry — either realistic demo data or a real uploaded device configuration — into two numbers every executive understands: **Annualized Loss Expectancy (ALE)** and **Value at Risk (VaR)**, computed by a FAIR-based Monte Carlo engine running 10,000+ simulated loss years. A built-in **0/1 knapsack optimizer** recommends exactly which security controls to fund within a given budget for the largest risk reduction per rupee. Every accepted-risk decision is hashed and committed to a **blockchain-backed audit ledger**, so it can't be quietly edited after the fact. A **LangGraph-based Virtual CISO** answers compliance and security questions grounded in the session's real data, and a **Closed-Loop Calibration Engine** feeds real incident outcomes back into the model so its predictions get sharper over time instead of relying on static assumptions.

## 4. Key Features

- **Ingestion Engine** — upload a real device config; a rule-based parser finds security-relevant lines and proposes standard compliance mappings for you to confirm, one finding at a time.
- **Simulation Sandbox** — set a remediation budget, toggle strategic controls (MFA, Zero Trust, 24/7 SOC monitoring, and more), and run a fresh Monte Carlo simulation for live ALE, VaR, and a loss-distribution chart.
- **Investment Optimizer** — a budget-aware knapsack solver that recommends the exact control mix that cuts the most risk per rupee spent.
- **Blockchain-Backed Ledger** — every accepted risk or approved patch plan is logged and can be committed on-chain for a tamper-evident audit trail.
- **Closed-Loop Calibration** — log real (or near-miss) incident outcomes and the model recalibrates control-effectiveness and confidence bands for every future simulation.
- **Compliance Reports** — a board-ready snapshot with a Framework Coverage Matrix crosswalking active controls to NIST CSF, ISO/IEC 27001, CIS Controls v8, RBI, SEBI CSCRF, and the DPDP Act.
- **Virtual CISO Chat** — an AI assistant answering security/compliance questions using the session's actual live risk data, not generic boilerplate.
- **Training & Platform Navigation Guide** — compliance modules that feed the risk model's Control Strength score, plus a ten-step, real-screenshot walkthrough of every part of the platform so a first-time user needs no one to explain it to them.
- **CRQ Intelligence** — a rollup command view: regional risk exposure, annualized loss trend, decision trust, exposure by business unit, and compliance coverage at a glance.
- **Two independent data tracks** — Demo data and your own uploaded data are kept in genuinely separate pools; switching between them never mixes results.

## 5. Technology Stack

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

## 6. Architecture

See [docs/architecture.md](docs/architecture.md) for the full component breakdown and data-flow diagram.

## 7. Repository Structure

```
CRQ_Platform/
├── frontend/          Next.js 14 dashboard (App Router)
├── backend/           FastAPI gateway, auth, ingestion engine, REST API
├── quant-engine/       FAIR Monte Carlo simulation + knapsack optimizer
├── ai-agent/           LangGraph "Virtual CISO" + RAG over compliance docs
├── blockchain/         AuditLedger.sol (Hardhat/Solidity)
├── docs/               Architecture, threat model, privacy, staging, success metrics
├── tests/              pytest suite
├── assets/screenshots/ Product screenshots for this README
├── submission/         Final presentation + demo video links
├── requirements.txt    Backend/quant-engine/ai-agent Python dependencies
└── render.yaml         Render deployment config
```

## 8. Final Presentation

Upload the final PPT/PPTX to the `submission/` folder when the file size is suitable for GitHub — see [submission/PRESENTATION.md](submission/PRESENTATION.md). If it's too large, share a viewer link there instead.

## 9. Demo Video

See [submission/DEMO.md](submission/DEMO.md) for the demo video link and what it covers.

## 10. Screenshots / Prototype Photos

See [assets/screenshots/](assets/screenshots/README.md) for the recommended screenshot list and naming convention.

## 11. Installation

```bash
git clone https://github.com/Sid-DudeD017/CRQ_Platform.git
cd CRQ_Platform

# Backend / quant-engine / AI agent dependencies
pip install -r requirements.txt

# Frontend dependencies
cd frontend
npm install
cd ..
```

## 12. Run

```bash
# Backend (from the repo root)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (in a second terminal)
cd frontend
npm run dev
```

The frontend runs at `http://localhost:3000` and calls the backend at `http://localhost:8000` (set via `NEXT_PUBLIC_API_URL`).

## 13. Future Scope

- Direct cloud telemetry ingestion (AWS/Azure/GCP APIs) instead of manual config-file upload only.
- Additional framework crosswalks (PCI-DSS, HIPAA) alongside the existing NIST/ISO/CIS/RBI/SEBI/DPDP coverage.
- A production blockchain deployment (public testnet/L2) for the audit ledger, beyond the local Hardhat node.
- ML-based anomaly detection feeding directly into the FAIR model's frequency estimates.
- SSO/enterprise authentication (SAML/OIDC) alongside the existing JWT-based auth.

## Important

Do **not** upload passwords, API keys, access tokens, `.env` files containing secrets, or other confidential credentials.

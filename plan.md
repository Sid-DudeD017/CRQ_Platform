# Master Project Blueprint: AI-Powered Cyber Risk Quantification (CRQ) Platform

## 1. Core Mission & Regulatory Goal
We are building an enterprise-grade, Zero-Trust CRQ platform that translates technical vulnerabilities into financial exposure metrics (Expected Annual Loss) using FAIR statistical models. The platform logic natively aligns with RBI Cyber Security Framework, SEBI CSCRF (August 2024), NIST CSF 2.0, and the DPDP Act 2023. Fines from these frameworks are baked into the financial risk calculations.

## 2. System Architecture & Strict Routing
**CRITICAL RULE:** We are using a Strict API Gateway Pattern. The frontend MUST ONLY communicate with the FastAPI server. The AI, Math Engines, and Blockchain logger are isolated backend services orchestrated by FastAPI. No direct connections from Frontend to AI or Frontend to Blockchain.

## 3. Directory Structure, Technologies & Team Ownership

### `/frontend` (The Executive Dashboard) -> Owner: Frontend Developer
*   **Tech:** Next.js (App Router), React, Tailwind CSS, Recharts.
*   **Role:** A clean, non-technical financial dashboard for the CEO/CFO.
*   **Features:**
    *   Displays Annualized Loss Expectancy and a Monte Carlo loss distribution chart.
    *   Contains a "What-If" Simulation Sandbox with budget sliders.
    *   Has an "Accept Risk" button (triggers blockchain) and an "Approve & Log" optimizer button.
    *   Renders the AI Chat interface by querying the FastAPI gateway exclusively.

### `/backend` (The Central Router & Data Pipeline) -> Owner: Backend Engineer
*   **Tech:** Python, FastAPI, Uvicorn, Neon PostgreSQL.
*   **Role:** The system's foundation and central hub. Every piece of data flows through these routes before reaching ML, AI, or Blockchain layers.
*   **Features:**
    *   Relational database schema for enterprise telemetry.
    *   Mock data generators simulating vulnerability scans and EDR logs.
    *   Mathematical network topology modeling as an Adjacency Matrix.
    *   REST endpoints: `/api/telemetry`, `/api/simulate-risk`, `/api/chat`, `/api/audit`.

### `/blockchain` (The Zero-Trust Audit Ledger) -> Owner: Blockchain Engineer
*   **Tech:** Solidity, Local EVM (Hardhat/Foundry), Webhooks.
*   **Role:** Solves the compliance problem with immutable audit logging.
*   **Features:**
    *   Deployed Solidity smart contracts on a local EVM.
    *   An asynchronous webhook that triggers a cryptographic hash whenever a CISO accepts a risk.
    *   Enforces that ONLY the FastAPI server can trigger the smart contract after authenticating a user's action.

### `/quant-engine` (The Core Math Engine) -> Owner: Quant Engineer
*   **Tech:** Python, SciPy, NumPy, PuLP/OR-Tools.
*   **Role:** Statistical modeling and budget optimization operating as discrete Python modules.
*   **Features:**
    *   **FAIR Monte Carlo Engine:** Runs thousands of probability scenarios to generate "Value at Risk" (VaR) distribution curves.
    *   **0/1 Knapsack Budget Optimizer:** Solves the knapsack problem to output the exact list of patches maximizing Return on Security Investment (ROSI).

### `/ai-agent` (The AI Orchestrator & Virtual CISO) -> Owner: AI Engineer
*   **Tech:** Python, LangGraph, ChromaDB.
*   **Role:** The intelligence layer connecting mathematical outputs and backend data to autonomous AI agents.
*   **Features:**
    *   LangGraph Multi-Agent architecture to reason across telemetry.
    *   Native Python `@tool` calling to expose the Knapsack optimizer and database queries to the agents.
    *   RAG Pipeline using ChromaDB to index SEBI/RBI compliance frameworks.
    *   Securely streams chat responses through the FastAPI endpoints.

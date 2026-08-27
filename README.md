# CRQ Platform (Cyber Risk Quantification Prototype)

An AI-Powered Cyber Risk Quantification (CRQ) Platform that bridges enterprise telemetry, mathematical risk models, and generative AI to provide actionable security investment insights. 

## 🏗 Architecture Overview

The platform operates as a centralized hub, routing data through a FastAPI backend before feeding it into mathematical and AI models:

- **Frontend (`/frontend`)**: Next.js 14 executive dashboard featuring real-time Recharts for Monte Carlo distributions, budget optimization sliders, and a built-in AI Chat panel.
- **Backend API (`/backend`)**: FastAPI server acting as the gateway. It manages SQLite/PostgreSQL databases, handles mock telemetry generation, and serves endpoints for the frontend.
- **Quant Engine (`/quant-engine`)**: Calculates Annualized Loss Expectancy (ALE) and Value at Risk (VaR) using FAIR Monte Carlo simulations. It also uses a Knapsack optimizer to recommend budget allocations.
- **AI Agent (`/ai-agent`)**: A LangGraph-based multi-agent orchestrator ("Virtual CISO"). It dynamically routes queries to sub-agents (Security Analyst, Compliance Officer, Quant Analyst) using RAG (ChromaDB) to fetch regulatory info on NIST, RBI, SEBI, and DPDP.
- **Blockchain (`/blockchain`)**: Mocked Web3 smart contracts (Solidity) for zero-trust auditing of risk acceptance events.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- An OpenAI API Key (Required for the Virtual CISO agent)

### 1. Backend Setup

Open a terminal and navigate to the root directory:

```bash
# 1. Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set your environment variables
export OPENAI_API_KEY="your-api-key-here"
```

### 2. Frontend Setup

Open a second terminal and navigate to the frontend directory:

```bash
cd frontend

# 1. Install Node modules
npm install
```

---

## 🏃‍♂️ Running the Platform

To see the prototype in action, you need to run both the backend and frontend servers simultaneously.

### Start the Backend
In your backend terminal (with the virtual environment activated):
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Start the Frontend
In your frontend terminal:
```bash
npm run dev
```

The executive dashboard will be accessible at [http://localhost:3000](http://localhost:3000).

---

## 🧪 Core Workflows for Testing

Once the platform is running, follow these steps to test the full data pipeline:

1. **Generate Mock Telemetry:** 
   Before running a simulation, the math engine needs data. The system has a built-in procedural generator that creates realistic assets, assigns vulnerabilities (simulating SIEM/CSPM feeds), and maps out a network topology.
   - Run: `curl -X POST http://localhost:8000/api/generate-mock-data` 
   - (Or simply trigger this via backend swagger docs at `http://localhost:8000/docs`)

2. **Run the Simulation:**
   - Go to the frontend dashboard.
   - Adjust the **Security Budget Allocation** slider in the sandbox.
   - Click **Run Simulation**.
   - The backend will fetch the generated database telemetry, calculate the FAIR variables, run 10,000 Monte Carlo iterations, and dynamically plot the VaR distribution curve on the screen.

3. **Talk to the Virtual CISO:**
   - Click the floating `✨` AI Assistant button in the bottom right corner.
   - Try asking: *"What are the RBI regulations regarding telemetry?"* or *"What is our network topology?"*
   - LangGraph will automatically route your query to the correct specialized sub-agent and stream the answer back.

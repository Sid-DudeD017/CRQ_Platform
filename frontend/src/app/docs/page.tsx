const ARCHITECTURE = [
    { layer: 'Frontend', tech: 'Next.js 14 (App Router) + Tailwind', detail: 'Dashboard, ledger, reports, optimizer, chat widget. Talks to the backend only over HTTP via NEXT_PUBLIC_API_URL.' },
    { layer: 'Backend Gateway', tech: 'FastAPI + SQLModel', detail: 'Single entrypoint (backend/main.py) every other layer sits behind - auth, CMDB/telemetry, simulation, chat, audit.' },
    { layer: 'Quant Engine', tech: 'Python (NumPy)', detail: 'FAIR Monte Carlo loss simulation and knapsack budget optimizer (quant-engine/monte_carlo.py, optimizer.py).' },
    { layer: 'AI Agent', tech: 'LangGraph + Groq + ChromaDB', detail: 'Multi-agent orchestrator (security analyst / compliance officer / quant analyst / supervisor) with RAG over self-seeding mock compliance docs.' },
    { layer: 'Database', tech: 'Postgres (Neon) / SQLite', detail: 'Assets, telemetry, simulations, and risk decisions. DATABASE_URL selects Postgres in production, falls back to local SQLite in dev.' },
    { layer: 'Blockchain Audit Trail', tech: 'Solidity + Hardhat + web3.py', detail: 'AuditLedger.sol records each risk-acceptance decision on-chain. Runs against a local Hardhat node in dev; disabled in the hosted demo (decisions still persist to the database, just without a tx hash).' },
];

const API_ENDPOINTS = [
    { method: 'GET', path: '/', desc: 'Health check / API gateway greeting.' },
    { method: 'POST', path: '/api/auth/login', desc: 'Demo login (OAuth2 password form). Returns a bearer token for the CISO/CFO demo accounts.' },
    { method: 'POST', path: '/api/generate-mock-data', desc: 'Seeds assets, telemetry logs, and network topology edges. Run once against a fresh database.' },
    { method: 'GET', path: '/api/telemetry', desc: 'Latest 100 telemetry log rows (CVE, SIEM, IAM, EDR, CSPM, threat-intel fields).' },
    { method: 'GET', path: '/api/topology', desc: "Network adjacency matrix and node mapping, used for the blast-radius vulnerability calc and the topology graph." },
    { method: 'POST', path: '/api/simulate-risk', desc: 'Runs the FAIR Monte Carlo simulation and budget optimizer for a given budget. Returns expected loss, VaR-95, the SEBI resilience score, and the optimized patch plan.' },
    { method: 'POST', path: '/api/chat', desc: 'Streams a response from the LangGraph Virtual CISO agent (Server-Sent text stream).' },
    { method: 'POST', path: '/api/audit', desc: 'Logs a risk-acceptance decision (requires a bearer token) and fires the blockchain webhook as a background task.' },
    { method: 'GET', path: '/api/audit-log', desc: 'Lists every risk-acceptance decision, most recent first, including on-chain status and board approval.' },
];

const DATA_MODEL = [
    { name: 'Asset', detail: 'CMDB entry - id (e.g. "AST-001"), ip_address, data_classification (e.g. PII), business_criticality, business_value.' },
    { name: 'TelemetryLog', detail: 'Point-in-time security signal for an asset - vulnerability_score, threat_level, patch_status, mfa_active, edr_health_status, cisa_kev_presence, and more.' },
    { name: 'NetworkEdge', detail: 'Weighted connection between two assets, used to compute network-effective ("blast radius") vulnerability.' },
    { name: 'RiskSimulation', detail: 'One FAIR Monte Carlo run - expected_annual_loss, var_95, the loss distribution curve, and the optimized budget allocation.' },
    { name: 'RiskDecision', detail: 'One accepted risk - action, risk_accepted, decided_by, board_approved, and (if committed) tx_hash / on_chain.' },
];

const FRAMEWORKS = [
    { tag: 'RBI', detail: 'Board/audit-committee oversight of cyber risk acceptance - enforced via the board_approved flag on every decision.' },
    { tag: 'SEBI CSCRF', detail: 'Five-pillar Cyber Capability Index (Anticipate / Withstand / Contain / Recover / Evolve), each on a 0-5 scale.' },
    { tag: 'DPDP Act', detail: "India's data protection law - auto-triggered when a PII asset's effective vulnerability crosses 7.0." },
    { tag: 'NIST CSF', detail: 'Telemetry-to-function mapping (Identify / Protect / Detect / Respond / Recover) underlying the deduction logic.' },
];

export default function DocsPage() {
    return (
        <div className="max-w-[1000px] mx-auto flex flex-col gap-stack-lg">
            <div>
                <h1 className="font-headline-md text-headline-md text-primary mb-1">Documentation</h1>
                <p className="font-body-md text-body-md text-on-surface-variant">
                    Architecture, API reference, and data model for the CRQ Platform.
                </p>
            </div>

            {/* Architecture */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Architecture</h3>
                <div className="flex flex-col gap-stack-sm">
                    {ARCHITECTURE.map((row, i) => (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-stack-sm pb-stack-sm border-b border-outline-variant last:border-0 last:pb-0">
                            <span className="font-label-caps text-label-caps text-primary w-[180px] flex-shrink-0">{row.layer}</span>
                            <div>
                                <span className="font-data-mono text-data-mono text-on-surface-variant">{row.tech}</span>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">{row.detail}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* API Reference */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">API Reference</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-outline-variant">
                                <th className="py-2 pr-4 font-label-caps text-label-caps text-on-surface-variant">Method</th>
                                <th className="py-2 pr-4 font-label-caps text-label-caps text-on-surface-variant">Endpoint</th>
                                <th className="py-2 font-label-caps text-label-caps text-on-surface-variant">Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            {API_ENDPOINTS.map((ep, i) => (
                                <tr key={i} className="border-b border-outline-variant last:border-0">
                                    <td className="py-2 pr-4 align-top">
                                        <span className={`font-label-caps text-label-caps px-2 py-0.5 rounded ${ep.method === 'GET' ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary-container text-on-primary-container'}`}>
                                            {ep.method}
                                        </span>
                                    </td>
                                    <td className="py-2 pr-4 font-data-mono text-data-mono align-top whitespace-nowrap">{ep.path}</td>
                                    <td className="py-2 font-body-sm text-body-sm text-on-surface-variant">{ep.desc}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Data Model */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Data Model</h3>
                <div className="flex flex-col gap-stack-sm">
                    {DATA_MODEL.map((row, i) => (
                        <div key={i} className="flex gap-stack-sm items-start">
                            <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">table_rows</span>
                            <div>
                                <span className="font-data-mono text-data-mono font-semibold">{row.name}</span>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">{row.detail}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Compliance Frameworks */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Compliance Frameworks Modeled</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-md">
                    {FRAMEWORKS.map((f, i) => (
                        <div key={i} className="flex gap-stack-sm items-start">
                            <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded flex-shrink-0">{f.tag}</span>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">{f.detail}</p>
                        </div>
                    ))}
                </div>
                <a href="/reports" className="inline-block mt-stack-md font-body-sm text-body-sm text-primary hover:underline">
                    See these mapped to live board reports &rarr;
                </a>
            </div>

            {/* Deployment */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Deployment</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">
                    The hosted demo runs the frontend on Vercel and the backend on Render, backed by a Neon Postgres database. The on-chain audit trail requires a local Hardhat node and is only available when running the stack locally - decisions still persist to the database either way.
                </p>
                <div className="flex flex-col gap-1">
                    <div className="font-body-sm text-body-sm"><span className="text-on-surface-variant">Frontend env:</span> <span className="font-data-mono text-data-mono">NEXT_PUBLIC_API_URL</span></div>
                    <div className="font-body-sm text-body-sm"><span className="text-on-surface-variant">Backend env:</span> <span className="font-data-mono text-data-mono">DATABASE_URL, GROQ_API_KEY, SECRET_KEY</span></div>
                </div>
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

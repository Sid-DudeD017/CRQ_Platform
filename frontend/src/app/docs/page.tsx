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
    { method: 'DELETE', path: '/api/audit-log', desc: 'Wipes every logged decision, resetting the ledger and the Committed On-Chain counter back to 0 (requires a bearer token).' },
    { method: 'POST', path: '/api/training/complete', desc: 'Toggles completion of one Training page module for the logged-in user (requires a bearer token). Feeds the org-wide coverage below.' },
    { method: 'GET', path: '/api/training/progress', desc: 'Every logged training completion plus a per-module summary and org-wide coverage_pct - backs the Training page and the Control Strength boost in derive_fair_inputs().' },
    { method: 'POST', path: '/api/incidents', desc: '[Closed-Loop Calibration Engine] Logs one real (or near-miss) incident\'s actual costs (requires a bearer token). Snapshots the most recent predicted ALE, computes prediction_error_pct, recomputes calibration over the full incident history, and persists a CalibrationSnapshot.' },
    { method: 'GET', path: '/api/incidents', desc: 'Every logged incident, most recent first - backs the Calibration page\'s incident log.' },
    { method: 'GET', path: '/api/calibration', desc: 'Current calibration state - per-control Beta-posterior effectiveness (mean + 95% CI), vulnerability-class and business-unit multipliers, loss-variance widening factor, and the 0-100 model uncertainty score - plus the full CalibrationSnapshot trend. See risk_engine.compute_calibration.' },
];

const DATA_MODEL = [
    { name: 'Asset', detail: 'CMDB entry - id (e.g. "AST-001"), ip_address, data_classification (e.g. PII), business_criticality, business_value.' },
    { name: 'TelemetryLog', detail: 'Point-in-time security signal for an asset - vulnerability_score, threat_level, patch_status, mfa_active, edr_health_status, cisa_kev_presence, and more.' },
    { name: 'NetworkEdge', detail: 'Weighted connection between two assets, used to compute network-effective ("blast radius") vulnerability.' },
    { name: 'RiskSimulation', detail: 'One FAIR Monte Carlo run - expected_annual_loss, var_95, the loss distribution curve, and the optimized budget allocation.' },
    { name: 'RiskDecision', detail: 'One accepted risk - action, risk_accepted, decided_by, board_approved, and (if committed) tx_hash / on_chain.' },
    { name: 'TrainingRecord', detail: 'One "module marked complete" record from the Training page - module, completed_by, completed_at. Org-wide coverage feeds a Control Strength boost in derive_fair_inputs().' },
    { name: 'IncidentRecord', detail: '[Closed-Loop Calibration Engine] One real (or near-miss) incident\'s actual outcome - vulnerability_class, control_involved, containment_pct, downtime/recovery/legal/penalty costs, total_actual_loss, the predicted_ale snapshot at logging time, and prediction_error_pct.' },
    { name: 'CalibrationSnapshot', detail: 'A point-in-time copy of compute_calibration()\'s output, persisted after every logged incident - control_effectiveness, vuln_class_multipliers, business_unit_multipliers, loss_variance_multiplier, and uncertainty_score. Backs the Calibration page\'s uncertainty trend chart.' },
];

const FRAMEWORKS = [
    {
        tag: 'RBI',
        detail: "Board/audit-committee oversight of cyber risk acceptance. Every decision on the ledger is stamped board_approved: true/false at accept time and committed with that flag on-chain, so a regulator can trace exactly which risk-acceptances carried explicit sign-off.",
        source: 'Source: GET /api/audit-log → board_approved per decision',
    },
    {
        tag: 'SEBI CSCRF',
        detail: 'Five-pillar Cyber Capability Index (0-5 each), recomputed on every simulation run: Anticipate (inverse of threat-event frequency), Withstand (control strength), Contain (secondary loss containment), Recover (primary loss recovery speed), and Evolve (Withstand extrapolated forward) - averaged into the composite cci_score.',
        source: 'Source: POST /api/simulate-risk → sebi_resilience',
    },
    {
        tag: 'DPDP Act',
        detail: "India's data protection law. Auto-triggers when a PII-classified asset's network-effective vulnerability (intrinsic score plus 20% of connected-neighbor exposure - the “blast radius” calculation) exceeds 7.0; the FAIR loss model then applies DPDP-specific probable-loss magnitudes to the simulation.",
        source: 'Source: POST /api/simulate-risk → contextual is_dpdp_applicable trigger',
    },
    {
        tag: 'NIST CSF',
        detail: 'Maps live telemetry signals - patch status, EDR health, MFA coverage, cloud misconfigurations, CISA KEV presence - onto the five NIST CSF functions (Identify, Protect, Detect, Respond, Recover) that the deduction logic in the risk engine is modeled against.',
        source: 'Source: GET /api/telemetry, deduction logic in backend/main.py::simulate_risk',
    },
    {
        tag: 'ISO/IEC 27001:2022',
        detail: 'Each of the 11 Strategic Controls (Enforce Cloud MFA, Zero Trust, Least-Privilege IAM, EDR Health Remediation, and the rest) is mapped to the single Annex A control it most directly satisfies - e.g. Enforce Cloud MFA to A.8.5 Secure authentication, Host Isolation to A.5.26 Response to information security incidents. A control commonly maps to several Annex A sub-clauses in practice; this is the primary one, not an exhaustive citation.',
        source: 'Source: backend/risk_engine.py CONTROL_FRAMEWORK_MAP, POST /api/simulate-risk → framework_coverage',
    },
    {
        tag: 'CIS Controls v8',
        detail: 'The same 11 Strategic Controls mapped to their CIS Controls v8 Safeguard - e.g. Patch Payment Gateway to Safeguard 7.4 (Automated Application Patch Management), 24/7 SOC Monitoring to Safeguard 13.1 (Centralize Security Event Alerting) - each row also carries whether that control is actually active for the run, not just whether it exists on paper.',
        source: 'Source: backend/risk_engine.py CONTROL_FRAMEWORK_MAP, POST /api/simulate-risk → framework_coverage',
    },
];

export default function DocsPage() {
    return (
        <div className="max-w-[1000px] mx-auto flex flex-col gap-stack-lg">
            <div>
                <h1 className="font-headline-md text-headline-md text-primary mb-1">Documentation</h1>
                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-sm">
                    Architecture, API reference, and data model for the CRQ Platform. Sections below are collapsible - jump to one or expand only what you need.
                </p>
                <nav className="flex flex-wrap gap-2" aria-label="Jump to section">
                    {[
                        ['#architecture', 'Architecture'],
                        ['#api-reference', 'API Reference'],
                        ['#data-model', 'Data Model'],
                        ['#compliance-frameworks', 'Compliance Frameworks'],
                        ['#deployment', 'Deployment'],
                    ].map(([href, label]) => (
                        <a key={href} href={href} className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary px-2 py-1 bg-surface-container rounded border border-outline-variant transition-colors">
                            {label}
                        </a>
                    ))}
                </nav>
            </div>

            {/* Architecture */}
            <details id="architecture" open className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter scroll-mt-gutter">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title-lg text-title-lg text-primary mb-stack-md">
                    Architecture
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                </summary>
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
            </details>

            {/* API Reference */}
            <details id="api-reference" open className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter scroll-mt-gutter">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title-lg text-title-lg text-primary mb-stack-md">
                    API Reference
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                </summary>
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
            </details>

            {/* Data Model - collapsed by default: reference material, not the
                first thing most readers need. */}
            <details id="data-model" className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter scroll-mt-gutter">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title-lg text-title-lg text-primary mb-stack-md group-open:mb-stack-md">
                    Data Model
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                </summary>
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
            </details>

            {/* Compliance Frameworks - collapsed by default */}
            <details id="compliance-frameworks" className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter scroll-mt-gutter">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title-lg text-title-lg text-primary mb-stack-md group-open:mb-stack-md">
                    Compliance Frameworks Modeled
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-md">
                    {FRAMEWORKS.map((f, i) => (
                        <div key={i} className="flex gap-stack-sm items-start">
                            <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded flex-shrink-0">{f.tag}</span>
                            <div>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">{f.detail}</p>
                                <p className="font-data-mono text-data-mono text-on-surface-variant/70 mt-1">{f.source}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <a href="/reports" className="inline-block mt-stack-md font-body-sm text-body-sm text-primary hover:underline">
                    See these mapped to live board reports &rarr;
                </a>
            </details>

            {/* Deployment - collapsed by default */}
            <details id="deployment" className="group bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter scroll-mt-gutter">
                <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title-lg text-title-lg text-primary mb-stack-md group-open:mb-stack-md">
                    Deployment
                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform group-open:rotate-180">expand_more</span>
                </summary>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">
                    The hosted demo runs the frontend on Vercel and the backend on Render, backed by a Neon Postgres database. The on-chain audit trail requires a local Hardhat node and is only available when running the stack locally - decisions still persist to the database either way.
                </p>
                <div className="flex flex-col gap-1">
                    <div className="font-body-sm text-body-sm"><span className="text-on-surface-variant">Frontend env:</span> <span className="font-data-mono text-data-mono">NEXT_PUBLIC_API_URL</span></div>
                    <div className="font-body-sm text-body-sm"><span className="text-on-surface-variant">Backend env:</span> <span className="font-data-mono text-data-mono">DATABASE_URL, GROQ_API_KEY, SECRET_KEY</span></div>
                </div>
            </details>

            <a href="/overview" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

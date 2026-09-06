export default function SupportPage() {
    return (
        <div className="max-w-[900px] mx-auto flex flex-col gap-stack-lg">
            <div>
                <h1 className="font-headline-md text-headline-md text-primary mb-1">Support</h1>
                <p className="font-body-md text-body-md text-on-surface-variant">
                    Quick start, demo access, and troubleshooting for the CRQ Platform.
                </p>
            </div>

            {/* Quick Start */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Quick Start</h3>
                <ol className="flex flex-col gap-stack-sm">
                    {[
                        { title: 'Generate mock data', detail: 'POST /api/generate-mock-data once, from any client, to seed assets, telemetry, and network topology.' },
                        { title: 'Run a simulation', detail: 'Use the budget slider on the Overview page and click "Run Simulation" to see FAIR Monte Carlo results and the optimized patch plan.' },
                        { title: 'Log in', detail: 'Click "Login as CISO" or "Login as CFO" in the top-right - required before accepting any risk.' },
                        { title: 'Accept a risk', detail: 'Click "Accept Risk" next to a business unit - this logs the decision to the database and, if a local blockchain node is running, commits it on-chain to AuditLedger.sol.' },
                        { title: 'Ask the Virtual CISO', detail: 'Open the chat bubble (bottom-right) to ask about telemetry, compliance frameworks, or budget optimization.' },
                    ].map((step, i) => (
                        <li key={i} className="flex gap-stack-sm">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-label-caps text-label-caps font-bold">{i + 1}</span>
                            <div>
                                <div className="font-body-sm text-body-sm font-semibold">{step.title}</div>
                                <div className="font-body-sm text-body-sm text-on-surface-variant">{step.detail}</div>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>

            {/* Demo Credentials */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Demo Credentials</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Used by the &quot;Login as...&quot; buttons in the top navigation. Fixed demo accounts only - see backend/security.py.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-outline-variant">
                                <th className="py-2 pr-4 font-label-caps text-label-caps text-on-surface-variant">Role</th>
                                <th className="py-2 pr-4 font-label-caps text-label-caps text-on-surface-variant">Username</th>
                                <th className="py-2 font-label-caps text-label-caps text-on-surface-variant">Password</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-outline-variant">
                                <td className="py-2 pr-4 font-body-sm text-body-sm">CISO</td>
                                <td className="py-2 pr-4 font-data-mono text-data-mono">ciso</td>
                                <td className="py-2 font-data-mono text-data-mono">demo-ciso-pass</td>
                            </tr>
                            <tr>
                                <td className="py-2 pr-4 font-body-sm text-body-sm">CFO</td>
                                <td className="py-2 pr-4 font-data-mono text-data-mono">cfo</td>
                                <td className="py-2 font-data-mono text-data-mono">demo-cfo-pass</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Troubleshooting */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Troubleshooting</h3>
                <div className="flex flex-col gap-stack-md">
                    {[
                        { issue: 'Simulation / Accept Risk / Chat all fail', fix: 'The backend must be running on port 8000: uvicorn backend.main:app --reload --port 8000 from the repo root.' },
                        { issue: '"Accept Risk" says not authenticated', fix: 'Log in first with one of the demo accounts above (top-right corner) - /api/audit requires a bearer token.' },
                        { issue: 'Chat gives generic, unspecific answers', fix: 'The AI agent needs a GROQ_API_KEY in ai-agent/.env to produce real answers - without one it falls back to basic keyword routing.' },
                        { issue: 'Accept Risk works but nothing shows on-chain', fix: 'The blockchain audit trail needs a local Hardhat node running (npx hardhat node in /blockchain) with the contract deployed (npx hardhat run scripts/deploy.js --network localhost). Without it, the decision still saves to the database, just not on-chain.' },
                    ].map((row, i) => (
                        <div key={i} className="flex gap-stack-sm items-start">
                            <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">help_outline</span>
                            <div>
                                <div className="font-body-sm text-body-sm font-semibold">{row.issue}</div>
                                <div className="font-body-sm text-body-sm text-on-surface-variant">{row.fix}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <a href="/overview" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

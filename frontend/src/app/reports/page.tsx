"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '@/lib/api';

interface Decision {
    id: number;
    action: string;
    risk_accepted: number;
    decided_by: string;
    created_at: string;
    tx_hash: string | null;
    on_chain: boolean;
    board_approved: boolean;
}

const REPORT_LIBRARY = [
    {
        icon: 'account_balance',
        title: 'RBI Cyber Resilience & Board Oversight Report',
        framework: 'RBI',
        body: "Certifies that every risk-acceptance decision above materiality carries explicit board or audit-committee sign-off, per RBI's cyber resilience mandate. Each decision on the ledger is stamped board_approved: true/false at accept time and committed with that flag on-chain.",
        source: 'Source: GET /api/audit-log → board_approved per decision',
    },
    {
        icon: 'shield',
        title: 'SEBI CSCRF Cyber Capability Index',
        framework: 'SEBI',
        body: 'A five-pillar resilience score (0-5 each) recomputed on every simulation run: Anticipate (inverse of threat-event frequency), Withstand (control strength), Contain (secondary loss containment), Recover (primary loss recovery speed), and Evolve (Withstand extrapolated forward). All four are clamped to [0, 5] before averaging into the composite cci_score.',
        source: 'Source: POST /api/simulate-risk → sebi_resilience',
    },
    {
        icon: 'gavel',
        title: 'DPDP Act Impact Assessment',
        framework: 'DPDP',
        body: "Auto-triggers when any PII-classified asset's network-effective vulnerability (intrinsic score plus 20% of connected-neighbor exposure - the 'blast radius' calculation) exceeds 7.0. When triggered, the FAIR loss model applies DPDP-specific probable-loss magnitudes to the simulation.",
        source: 'Source: POST /api/simulate-risk → contextual is_dpdp_applicable trigger',
    },
    {
        icon: 'rule',
        title: 'NIST CSF Alignment Summary',
        framework: 'NIST',
        body: 'Maps live telemetry signals - patch status, EDR health, MFA coverage, cloud misconfigurations, CISA KEV presence - back onto the five NIST CSF functions (Identify, Protect, Detect, Respond, Recover) that the deduction logic in the risk engine is modeled against.',
        source: 'Source: GET /api/telemetry, deduction logic in backend/main.py::simulate_risk',
    },
];

export default function ReportsPage() {
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSnapshot = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/audit-log`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions(data.data || []);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not load the board report snapshot. Is the backend running?');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSnapshot();
    }, [fetchSnapshot]);

    const totalRisk = decisions.reduce((sum, d) => sum + (d.risk_accepted || 0), 0);
    const approvedCount = decisions.filter((d) => d.board_approved).length;
    const onChainCount = decisions.filter((d) => d.on_chain).length;

    return (
        <div className="max-w-[1000px] mx-auto flex flex-col gap-stack-lg">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="font-headline-md text-headline-md text-primary mb-1">Reports</h1>
                    <p className="font-body-md text-body-md text-on-surface-variant">
                        Board-ready risk reporting and regulatory framework mappings, generated from live telemetry and the audit ledger.
                    </p>
                </div>
                <button
                    onClick={fetchSnapshot}
                    disabled={isLoading}
                    className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-60"
                >
                    <span className={`material-symbols-outlined text-[18px] ${isLoading ? 'animate-spin' : ''}`}>refresh</span>
                    Refresh
                </button>
            </div>

            {/* Board Report Snapshot */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Board Report Snapshot</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Cumulative risk-acceptance activity to date, suitable for audit-committee reporting.
                </p>
                {error ? (
                    <p className="font-body-sm text-body-sm text-error">{error}</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-gutter">
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Decisions Logged</div>
                            <div className="font-headline-md text-headline-md text-primary font-data-mono">
                                {isLoading ? '–' : decisions.length}
                            </div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Total Risk Accepted</div>
                            <div className="font-headline-md text-headline-md text-primary font-data-mono">
                                {isLoading ? '–' : `₹${(totalRisk / 10000000).toFixed(2)} Cr`}
                            </div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Board Approved</div>
                            <div className="font-headline-md text-headline-md text-[#15803d] font-data-mono">
                                {isLoading ? '–' : `${approvedCount} / ${decisions.length}`}
                            </div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Committed On-Chain</div>
                            <div className="font-headline-md text-headline-md text-[#15803d] font-data-mono">
                                {isLoading ? '–' : `${onChainCount} / ${decisions.length}`}
                            </div>
                        </div>
                    </div>
                )}
                {!isLoading && !error && decisions.length === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-stack-md">
                        No risk decisions logged yet - accept a risk from the Overview page to populate this snapshot.
                    </p>
                )}
                <a href="/ledger" className="inline-block mt-stack-md font-body-sm text-body-sm text-primary hover:underline">
                    View the full decision-by-decision ledger &rarr;
                </a>
            </div>

            {/* Report Library */}
            <div>
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Regulatory Report Library</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
                    {REPORT_LIBRARY.map((report, i) => (
                        <div key={i} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col gap-stack-sm">
                            <div className="flex items-center gap-stack-sm">
                                <span className="material-symbols-outlined text-[22px] text-primary">{report.icon}</span>
                                <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded">{report.framework}</span>
                            </div>
                            <div className="font-body-sm text-body-sm font-semibold">{report.title}</div>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">{report.body}</p>
                            <p className="font-data-mono text-data-mono text-on-surface-variant/80 mt-auto pt-stack-sm">{report.source}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Note on generation */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex gap-stack-sm items-start">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">info</span>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        These reports are computed on demand from live telemetry and simulation output rather than static exports - run a simulation on the Overview page or accept a risk to refresh the underlying numbers, then hit Refresh above.
                    </p>
                </div>
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

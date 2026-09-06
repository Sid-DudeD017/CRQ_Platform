"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

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

interface SebiResilience {
    cci_score?: number;
    anticipate?: number;
    withstand?: number;
    contain?: number;
    recover?: number;
    evolve?: number;
}

interface OptimizedAllocation {
    status?: string;
    selected_patches?: string[];
    total_cost?: number;
    total_risk_reduced?: number;
}

interface FrameworkCoverageRow {
    id: string;
    active: boolean;
    nist_csf: string;
    iso27001: string;
    cis_controls: string;
}

interface SimRun {
    id: number;
    timestamp: string;
    expected_annual_loss: number;
    var_95: number | null;
    var_99: number | null;
    budget_used: number | null;
    active_controls: Record<string, boolean>;
    optimized_budget_allocation: OptimizedAllocation;
    sebi_resilience: SebiResilience;
    risk_drivers?: Record<string, any>;
    framework_coverage?: FrameworkCoverageRow[];
}

const REPORT_LIBRARY = [
    {
        icon: 'account_balance',
        title: 'RBI Cyber Resilience & Board Oversight',
        framework: 'RBI',
        body: 'Every risk-acceptance decision is stamped with an explicit board_approved sign-off, committed on-chain.',
    },
    {
        icon: 'shield',
        title: 'SEBI CSCRF Cyber Capability Index',
        framework: 'SEBI',
        body: 'Five-pillar resilience score (0-5), recomputed on every simulation run.',
    },
    {
        icon: 'gavel',
        title: 'DPDP Act Impact Assessment',
        framework: 'DPDP',
        body: "Auto-triggers when a PII asset's network-effective vulnerability crosses 7.0.",
    },
    {
        icon: 'rule',
        title: 'NIST CSF Alignment Summary',
        framework: 'NIST',
        body: 'Live telemetry mapped onto the five NIST CSF functions.',
    },
    {
        icon: 'verified_user',
        title: 'ISO/IEC 27001:2022 Annex A Crosswalk',
        framework: 'ISO 27001',
        body: 'Every Strategic Control mapped to its Annex A control, live against the current run - see the Framework Coverage Matrix below.',
    },
    {
        icon: 'checklist',
        title: 'CIS Controls v8 Safeguard Mapping',
        framework: 'CIS',
        body: 'Every Strategic Control mapped to its CIS v8 Safeguard, live against the current run - see the Framework Coverage Matrix below.',
    },
];

// A fixed, realistic sequence of six /api/simulate-risk calls - real
// budgets against real Strategic Control combinations, walked up in
// roughly the same ROSI order the Efficiency Frontier on Investment uses
// (see frontend/src/app/optimize/page.tsx's PATCHES list) - so the
// resulting history tells a coherent "posture improving" story instead of
// random noise. This exists purely to give the Simulation Analysis Ledger
// something real to show before a first real run has happened (e.g.
// right after a fresh clone, or right after Clear Ledger) - every number
// it produces is genuinely computed by the FAIR Monte Carlo engine from
// these inputs, nothing here is fabricated or hardcoded as output.
const SEED_RUNS: { budget: number; controls: Record<string, boolean> }[] = [
    { budget: 500000, controls: {} },
    { budget: 1000000, controls: { 'Enforce Cloud MFA': true } },
    { budget: 2500000, controls: { 'Enforce Cloud MFA': true, 'Least-Privilege IAM Review': true, 'EDR Health Remediation': true } },
    {
        budget: 4500000,
        controls: {
            'Enforce Cloud MFA': true,
            'Least-Privilege IAM Review': true,
            'EDR Health Remediation': true,
            'Host Isolation & Incident Containment': true,
            'Public Exposure Hardening (WAF)': true,
        },
    },
    {
        budget: 6500000,
        controls: {
            'Enforce Cloud MFA': true,
            'Least-Privilege IAM Review': true,
            'EDR Health Remediation': true,
            'Host Isolation & Incident Containment': true,
            'Public Exposure Hardening (WAF)': true,
            'CSPM Auto-Remediation': true,
            'Patch Payment Gateway': true,
        },
    },
    {
        budget: 9000000,
        controls: {
            'Enforce Cloud MFA': true,
            'Least-Privilege IAM Review': true,
            'EDR Health Remediation': true,
            'Host Isolation & Incident Containment': true,
            'Public Exposure Hardening (WAF)': true,
            'CSPM Auto-Remediation': true,
            'Patch Payment Gateway': true,
            'Threat Intel & KEV Patch Program': true,
            '24/7 SOC Monitoring': true,
            'Zero Trust Architecture': true,
            'PII Data Minimization & Tokenization': true,
        },
    },
];

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function activeControlNames(run: SimRun): string[] {
    return Object.entries(run.active_controls || {})
        .filter(([, v]) => !!v)
        .map(([k]) => k);
}

function roiPct(run: SimRun): number | null {
    const opt = run.optimized_budget_allocation;
    if (!opt || !opt.total_cost || opt.total_cost <= 0) return null;
    return ((opt.total_risk_reduced! - opt.total_cost) / opt.total_cost) * 100;
}

interface Insights {
    tone: 'up' | 'down' | 'flat';
    lines: string[];
}

// Every line here is derived from a real diff between the two most recent
// persisted RiskSimulation rows (see GET /api/simulations) - which
// Strategic Controls actually changed, how the SEBI CCI score moved, ROI
// on the optimizer's spend. Nothing here is a guessed root cause: when the
// data doesn't point at a specific driver, the copy says so explicitly
// (Monte Carlo sampling variance) rather than inventing one.
function buildInsights(runs: SimRun[]): Insights | null {
    if (runs.length < 2) return null;
    const [latest, prev] = runs;
    if (!prev.expected_annual_loss) return null;

    const aleDelta = ((latest.expected_annual_loss - prev.expected_annual_loss) / prev.expected_annual_loss) * 100;
    const varDelta = prev.var_95 && latest.var_95 ? ((latest.var_95 - prev.var_95) / prev.var_95) * 100 : null;

    const latestOn = new Set(activeControlNames(latest));
    const prevOn = new Set(activeControlNames(prev));
    const turnedOn = Array.from(latestOn).filter((c) => !prevOn.has(c));
    const turnedOff = Array.from(prevOn).filter((c) => !latestOn.has(c));

    const cciDelta =
        latest.sebi_resilience?.cci_score != null && prev.sebi_resilience?.cci_score != null
            ? latest.sebi_resilience.cci_score - prev.sebi_resilience.cci_score
            : null;

    const roiLatest = roiPct(latest);
    const roiPrev = roiPct(prev);

    const lines: string[] = [];
    const tone: 'up' | 'down' | 'flat' = aleDelta < -1 ? 'down' : aleDelta > 1 ? 'up' : 'flat';
    const aleCr = (v: number) => `₹${(v / 10000000).toFixed(2)} Cr`;

    if (tone === 'down') {
        lines.push(
            `Expected Annual Loss fell ${Math.abs(aleDelta).toFixed(1)}% since the previous run (${aleCr(prev.expected_annual_loss)} → ${aleCr(latest.expected_annual_loss)}).`
        );
        if (turnedOn.length > 0) {
            lines.push(`Likely driver: ${turnedOn.join(', ')} ${turnedOn.length === 1 ? 'was' : 'were'} turned on between these runs.`);
        } else if (cciDelta !== null && cciDelta > 0.1) {
            lines.push(
                `No Strategic Control toggle changed, but the SEBI Withstand/CCI score rose ${cciDelta.toFixed(2)} pts - check the Training and Ingestion Engine pages for what improved Control Strength.`
            );
        } else {
            lines.push(
                'No Strategic Control toggle changed between these runs - most likely Monte Carlo sampling variance (each run resamples 10,000 iterations) rather than an actual change in risk posture.'
            );
        }
    } else if (tone === 'up') {
        lines.push(
            `Expected Annual Loss rose ${aleDelta.toFixed(1)}% since the previous run (${aleCr(prev.expected_annual_loss)} → ${aleCr(latest.expected_annual_loss)}).`
        );
        if (turnedOff.length > 0) {
            lines.push(`Likely driver: ${turnedOff.join(', ')} ${turnedOff.length === 1 ? 'was' : 'were'} turned off between these runs.`);
        } else if (cciDelta !== null && cciDelta < -0.1) {
            lines.push(
                `No Strategic Control toggle changed, but the SEBI Withstand/CCI score dropped ${Math.abs(cciDelta).toFixed(2)} pts - check whether new Ingestion Engine control-gap findings were confirmed since the last run.`
            );
        } else {
            lines.push(
                'No Strategic Control toggle changed between these runs - most likely Monte Carlo sampling variance rather than an actual deterioration in risk posture.'
            );
        }
    } else {
        lines.push(`Expected Annual Loss is essentially flat since the previous run (${aleDelta >= 0 ? '+' : ''}${aleDelta.toFixed(1)}%).`);
    }

    if (varDelta !== null && Math.abs(varDelta) > 1 && Math.abs(aleDelta) > 1 && Math.sign(varDelta) !== Math.sign(aleDelta)) {
        lines.push(
            `Worth a closer look: the average loss (ALE) and the tail risk (VaR-95) moved in opposite directions (VaR-95 ${varDelta > 0 ? 'up' : 'down'} ${Math.abs(varDelta).toFixed(1)}%) - the shape of the loss distribution changed, not just its center. See the Loss Distribution chart on Overview.`
        );
    }

    if (roiLatest !== null && roiPrev !== null && Math.abs(roiLatest - roiPrev) > 2) {
        const roiDelta = roiLatest - roiPrev;
        lines.push(
            `Budget efficiency (ROI on the optimized control spend) ${roiDelta > 0 ? 'improved' : 'declined'} from ${roiPrev.toFixed(0)}% to ${roiLatest.toFixed(0)}%.`
        );
    }

    return { tone, lines };
}

export default function ReportsPage() {
    const { token, username } = useAuth();
    const { showToast } = useToast();

    // [Own-Data / Demo isolation] Same per-account hydration pattern as
    // the Ledger and Investment pages - reads which dashboard this
    // account is on (crq_data_source:${username}) so this page's board
    // report and simulation history only ever query that one dashboard's
    // data instead of interleaving demo and own-data runs into one report.
    const [dataSourceHydrated, setDataSourceHydrated] = useState(false);
    const [dataSource, setDataSource] = useState<'predefined' | 'own'>('predefined');
    useEffect(() => {
        if (!username) { setDataSourceHydrated(true); return; }
        try {
            const stored = localStorage.getItem(`crq_data_source:${username}`);
            setDataSource(stored === 'own' ? 'own' : 'predefined');
        } catch (e) {
            setDataSource('predefined');
        }
        setDataSourceHydrated(true);
    }, [username]);

    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [simulations, setSimulations] = useState<SimRun[]>([]);
    const [isSimLoading, setIsSimLoading] = useState(true);
    const [simError, setSimError] = useState<string | null>(null);

    const [isSeeding, setIsSeeding] = useState(false);
    const [seedProgress, setSeedProgress] = useState<{ current: number; total: number } | null>(null);
    // [Declutter the ledger] Twenty-plus rows made this page feel like a
    // raw data dump - show the most recent handful by default and let
    // anyone who actually wants the full run-by-run history expand it,
    // rather than always rendering every persisted simulation at once.
    const [showAllRuns, setShowAllRuns] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    // Same idea for the Framework Coverage Matrix - a board member cares
    // about what's active far more than the full 11-row reference table,
    // so default to just the active rows and let "Show all" reveal the
    // rest.
    const [showAllFrameworkRows, setShowAllFrameworkRows] = useState(false);

    const fetchSnapshot = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log?data_source=${dataSource}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions(data.data || []);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not load the board report snapshot. Is the backend running?');
        } finally {
            setIsLoading(false);
        }
    }, [dataSource]);

    const fetchSimulations = useCallback(async () => {
        setIsSimLoading(true);
        setSimError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/simulations?limit=20&data_source=${dataSource}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setSimulations(data.data || []);
        } catch (e: any) {
            console.error(e);
            setSimError(e.message || 'Could not load the simulation analysis ledger. Is the backend running?');
        } finally {
            setIsSimLoading(false);
        }
    }, [dataSource]);

    const refreshAll = useCallback(() => {
        fetchSnapshot();
        fetchSimulations();
    }, [fetchSnapshot, fetchSimulations]);

    // Fires each SEED_RUNS entry against the real /api/simulate-risk
    // endpoint, one at a time (sequential, not Promise.all - both so the
    // progress counter means something and so a mid-sequence failure
    // stops cleanly instead of leaving a pile of unresolved requests).
    // If the very first call 400s with "no assets found" - a fresh
    // database that's never had /api/generate-mock-data run against it -
    // this generates that mock telemetry once (requires being logged in,
    // same as the button already on the Overview page) and retries that
    // one run, rather than failing the whole sequence over a one-time
    // setup step.
    const seedDemoHistory = async () => {
        setIsSeeding(true);
        setSeedProgress({ current: 0, total: SEED_RUNS.length });
        try {
            for (let i = 0; i < SEED_RUNS.length; i++) {
                setSeedProgress({ current: i + 1, total: SEED_RUNS.length });
                const run = SEED_RUNS[i];
                const res = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ budget: run.budget, active_controls: run.controls, data_source: 'predefined' }),
                });
                if (res.ok) continue;

                const data = await res.json().catch(() => ({}));
                const isNoAssets = res.status === 400 && /no assets/i.test(data.detail || '');
                if (!(i === 0 && isNoAssets)) {
                    throw new Error(data.detail || `Run ${i + 1} of ${SEED_RUNS.length} failed (${res.status})`);
                }

                // First run, and the database is empty - generate mock
                // telemetry once, then retry this same run before moving on.
                if (!token) {
                    showToast('Log in as CISO or CFO (top-right) first - mock telemetry needs to be generated once before seeding demo runs.', 'error');
                    return;
                }
                showToast('No mock telemetry yet - generating it once, then seeding...', 'info');
                const genRes = await fetchWithRetry(`${API_BASE}/api/generate-mock-data`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!genRes.ok) {
                    const genData = await genRes.json().catch(() => ({}));
                    throw new Error(genData.detail || 'Could not generate mock telemetry.');
                }
                const retryRes = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ budget: run.budget, active_controls: run.controls, data_source: 'predefined' }),
                });
                if (!retryRes.ok) {
                    const retryData = await retryRes.json().catch(() => ({}));
                    throw new Error(retryData.detail || `Run 1 of ${SEED_RUNS.length} failed (${retryRes.status})`);
                }
            }
            showToast(`Seeded ${SEED_RUNS.length} simulation runs across a range of budgets - refreshing the ledger.`, 'success');
            await fetchSimulations();
            await fetchSnapshot();
        } catch (e: any) {
            console.error(e);
            showToast(e.message || 'Could not seed demo history. Is the backend running?', 'error');
        } finally {
            setIsSeeding(false);
            setSeedProgress(null);
        }
    };

    useEffect(() => {
        if (!dataSourceHydrated) return;
        refreshAll();
    }, [refreshAll, dataSourceHydrated]);

    const totalRisk = decisions.reduce((sum, d) => sum + (d.risk_accepted || 0), 0);
    const approvedCount = decisions.filter((d) => d.board_approved).length;
    const onChainCount = decisions.filter((d) => d.on_chain).length;

    const insights = buildInsights(simulations);
    const chartData = [...simulations]
        .reverse()
        .map((r, idx) => ({ name: `Run ${idx + 1}`, ale: r.expected_annual_loss / 10000000, timestamp: r.timestamp }));

    const isLoadingAny = isLoading || isSimLoading;

    const VISIBLE_RUN_COUNT = 5;
    const visibleSimulations = showAllRuns ? simulations : simulations.slice(0, VISIBLE_RUN_COUNT);

    // [Save to local disk] Builds one self-contained, print-friendly HTML
    // document from the exact same data already on screen (Board Approval
    // Basis, the FULL simulation ledger regardless of the collapsed table
    // view above, and the current Framework Coverage Matrix), then hands
    // it to the browser as a real file download - no server round trip,
    // no new dependency. Opens fine as a document on its own, and prints
    // cleanly to PDF straight from the browser's own Print dialog if
    // that's what someone actually wants to hand to a board.
    const downloadReport = () => {
        setIsDownloading(true);
        try {
            const generatedAt = new Date().toLocaleString();
            const coverage = simulations[0]?.framework_coverage || [];

            const ledgerRows = simulations.map((r, idx) => {
                const controls = activeControlNames(r);
                const roi = roiPct(r);
                return `<tr>
                    <td>#${simulations.length - idx}</td>
                    <td>${escapeHtml(new Date(r.timestamp).toLocaleString())}</td>
                    <td>${r.budget_used != null ? `Rs ${(r.budget_used / 10000000).toFixed(2)} Cr` : '—'}</td>
                    <td>Rs ${(r.expected_annual_loss / 10000000).toFixed(2)} Cr</td>
                    <td>${r.var_95 != null ? `Rs ${(r.var_95 / 10000000).toFixed(2)} Cr` : '—'}</td>
                    <td>${roi != null ? `${roi.toFixed(0)}%` : '—'}</td>
                    <td>${r.sebi_resilience?.cci_score != null ? `${r.sebi_resilience.cci_score.toFixed(1)}/5` : '—'}</td>
                    <td>${escapeHtml(controls.length > 0 ? controls.join(', ') : 'None')}</td>
                </tr>`;
            }).join('');

            const coverageRows = coverage.map((row) => `<tr>
                <td>${row.active ? 'Active' : 'Not active'}</td>
                <td>${escapeHtml(row.id)}</td>
                <td>${escapeHtml(row.nist_csf)}</td>
                <td>${escapeHtml(row.iso27001)}</td>
                <td>${escapeHtml(row.cis_controls)}</td>
            </tr>`).join('');

            const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>CRQ Platform - Board Report - ${escapeHtml(generatedAt)}</title>
<style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; max-width: 960px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin-top: 36px; border-bottom: 2px solid #1a1a1a; padding-bottom: 6px; }
    .subtitle { color: #555; font-size: 13px; margin-bottom: 24px; }
    .stats { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0 20px; }
    .stat { min-width: 140px; }
    .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
    .stat .value { font-size: 20px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; }
    th { background: #f2f2f2; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: #444; }
    .footer { margin-top: 40px; font-size: 11px; color: #888; }
    @media print { body { margin: 10px auto; } }
</style>
</head>
<body>
    <h1>CRQ Platform - Board Report</h1>
    <p class="subtitle">Generated ${escapeHtml(generatedAt)} - computed live from the audit trail and every persisted simulation.</p>

    <h2>Board Approval Basis</h2>
    <div class="stats">
        <div class="stat"><div class="label">Decisions Logged</div><div class="value">${decisions.length}</div></div>
        <div class="stat"><div class="label">Total Risk Accepted</div><div class="value">Rs ${(totalRisk / 10000000).toFixed(2)} Cr</div></div>
        <div class="stat"><div class="label">Board Approved</div><div class="value">${approvedCount} / ${decisions.length}</div></div>
        <div class="stat"><div class="label">Committed On-Chain</div><div class="value">${onChainCount} / ${decisions.length}</div></div>
    </div>

    <h2>Simulation Analysis Ledger (${simulations.length} run${simulations.length === 1 ? '' : 's'})</h2>
    <table>
        <thead><tr><th>#</th><th>Date</th><th>Budget</th><th>ALE</th><th>VaR-95</th><th>ROI</th><th>SEBI CCI</th><th>Active Controls</th></tr></thead>
        <tbody>${ledgerRows || '<tr><td colspan="8">No simulations recorded.</td></tr>'}</tbody>
    </table>

    <h2>Framework Coverage Matrix</h2>
    <table>
        <thead><tr><th>Status</th><th>Strategic Control</th><th>NIST CSF</th><th>ISO/IEC 27001:2022</th><th>CIS Controls v8</th></tr></thead>
        <tbody>${coverageRows || '<tr><td colspan="5">No simulation run yet.</td></tr>'}</tbody>
    </table>

    <p class="footer">Generated from the CRQ Platform. Every figure above reflects live telemetry and persisted simulation runs at the time of export - re-download for an updated snapshot.</p>
</body>
</html>`;

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `CRQ_Board_Report_${new Date().toISOString().slice(0, 10)}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Report downloaded - open it in your browser and print to PDF if you need one.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Could not generate the report file.', 'error');
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="max-w-[1100px] mx-auto flex flex-col gap-stack-lg">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
                <div>
                    <h1 className="font-headline-md text-headline-md text-primary mb-1 landing-font landing-heading-gradient">
                        {dataSource === 'own' ? 'Own Data Report' : 'Demo Report'}
                    </h1>
                    <p className="font-body-md text-body-md text-on-surface-variant">
                        {dataSource === 'own'
                            ? "Board-ready risk figures and a run-over-run simulation ledger, computed live from your own ingested environment's audit trail and simulations - kept separate from the demo dashboard's."
                            : 'Board-ready risk figures and a run-over-run simulation ledger, computed live from the demo audit trail and every persisted demo simulation.'}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={downloadReport}
                        disabled={isLoadingAny || isDownloading}
                        title="Downloads a self-contained HTML report - open it in your browser and print to PDF if you need one"
                        className="landing-cta-gradient px-4 py-2 rounded font-body-sm text-body-sm font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap"
                    >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        {isDownloading ? 'Preparing...' : 'Download Report'}
                    </button>
                    <button
                        onClick={refreshAll}
                        disabled={isLoadingAny}
                        className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${isLoadingAny ? 'animate-spin' : ''}`}>refresh</span>
                        Refresh
                    </button>
                </div>
            </div>

            {/* Board Approval Basis */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Board Approval Basis</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    RBI requires explicit board or audit-committee sign-off (<code className="font-data-mono text-data-mono">board_approved</code>) on every risk-acceptance decision above materiality. This is that sign-off record, live from the audit ledger.
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

            {/* Simulation Analysis Ledger */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-stack-sm mb-stack-md">
                    <div>
                        <h3 className="font-title-lg text-title-lg text-primary mb-1">Simulation Analysis Ledger</h3>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                            Every FAIR Monte Carlo run ever computed on Overview, most recent first - budget, ALE, VaR, ROI, and which Strategic Controls were active for that run.
                        </p>
                    </div>
                    {dataSource === 'predefined' && simulations.length < 3 && (
                        <button
                            onClick={seedDemoHistory}
                            disabled={isSeeding}
                            title="Runs 6 real simulations at a range of budgets and control combinations, so the chart and insights below have something real to show"
                            className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-3 py-1.5 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap shrink-0"
                        >
                            {isSeeding ? (
                                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                            ) : (
                                <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                            )}
                            {isSeeding && seedProgress ? `Seeding ${seedProgress.current}/${seedProgress.total}...` : 'Seed Demo Runs'}
                        </button>
                    )}
                </div>

                {isSimLoading ? (
                    <div className="flex flex-col gap-stack-sm">
                        <div className="h-[180px] w-full bg-surface-variant/30 rounded animate-pulse" />
                        <div className="h-16 w-full bg-surface-variant/20 rounded animate-pulse" />
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-10 bg-surface-container-low rounded animate-pulse" />
                        ))}
                    </div>
                ) : simError ? (
                    <p className="font-body-sm text-body-sm text-error">{simError}</p>
                ) : simulations.length === 0 ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        No simulations run yet - click &quot;Run Simulation&quot; on the Overview page to populate this ledger.
                    </p>
                ) : (
                    <>
                        {/* ALE trend chart */}
                        <div className="w-full bg-surface-container-low rounded border border-outline-variant border-dashed mb-stack-md" style={{ height: 180 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--outline-variant)" />
                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--on-surface-variant)' }} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--on-surface-variant)' }} tickFormatter={(v) => `₹${v.toFixed(1)}Cr`} width={64} />
                                    <Tooltip formatter={(value: any) => [`₹${Number(value).toFixed(2)} Cr`, 'Expected Annual Loss']} />
                                    <Line type="monotone" dataKey="ale" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Insights */}
                        {insights ? (
                            <div
                                className={`rounded-lg p-stack-md mb-stack-md border flex gap-stack-sm items-start ${
                                    insights.tone === 'down'
                                        ? 'border-[#15803d]/30 bg-[#15803d]/10'
                                        : insights.tone === 'up'
                                            ? 'border-error/30 bg-error/10'
                                            : 'border-outline-variant bg-surface-container-low'
                                }`}
                            >
                                <span
                                    className={`material-symbols-outlined text-[20px] mt-0.5 ${
                                        insights.tone === 'down' ? 'text-[#15803d]' : insights.tone === 'up' ? 'text-error' : 'text-on-surface-variant'
                                    }`}
                                >
                                    {insights.tone === 'down' ? 'trending_down' : insights.tone === 'up' ? 'trending_up' : 'trending_flat'}
                                </span>
                                <div className="flex flex-col gap-1">
                                    <span className="font-label-caps text-label-caps text-on-surface-variant">Run-over-run analysis</span>
                                    {insights.lines.map((line, i) => (
                                        <p key={i} className="font-body-sm text-body-sm">
                                            {line}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg p-stack-md mb-stack-md border border-outline-variant bg-surface-container-low flex gap-stack-sm items-start">
                                <span className="material-symbols-outlined text-[20px] text-on-surface-variant mt-0.5">info</span>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">
                                    Run at least two simulations from Overview to see trend analysis and suggestions here.
                                </p>
                            </div>
                        )}

                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-surface-container-low border-b border-outline-variant">
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">#</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Date</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Budget</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">ALE</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">VaR-95</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">ROI</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">SEBI CCI</th>
                                        <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Active Controls</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleSimulations.map((r, idx) => {
                                        const controls = activeControlNames(r);
                                        const roi = roiPct(r);
                                        return (
                                            <tr key={r.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                                                <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant">#{simulations.length - idx}</td>
                                                <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
                                                    {new Date(r.timestamp).toLocaleString()}
                                                </td>
                                                <td className="py-3 px-4 font-data-mono text-data-mono">
                                                    {r.budget_used != null ? `₹${(r.budget_used / 10000000).toFixed(2)} Cr` : '—'}
                                                </td>
                                                <td className="py-3 px-4 font-data-mono text-data-mono font-bold">
                                                    ₹{(r.expected_annual_loss / 10000000).toFixed(2)} Cr
                                                </td>
                                                <td className="py-3 px-4 font-data-mono text-data-mono">
                                                    {r.var_95 != null ? `₹${(r.var_95 / 10000000).toFixed(2)} Cr` : '—'}
                                                </td>
                                                <td className="py-3 px-4 font-data-mono text-data-mono">
                                                    {roi != null ? (
                                                        <span className={roi >= 0 ? 'text-[#15803d]' : 'text-error'}>{roi.toFixed(0)}%</span>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 font-data-mono text-data-mono">
                                                    {r.sebi_resilience?.cci_score != null ? r.sebi_resilience.cci_score.toFixed(1) + '/5' : '—'}
                                                </td>
                                                <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant" title={controls.join(', ') || 'None'}>
                                                    {controls.length > 0 ? `${controls.length} active` : 'None'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {simulations.length > VISIBLE_RUN_COUNT && (
                            <button
                                onClick={() => setShowAllRuns((v) => !v)}
                                className="mt-stack-md w-full border border-outline-variant border-dashed rounded py-2 font-label-caps text-label-caps text-on-surface-variant hover:text-primary hover:border-primary transition-colors flex items-center justify-center gap-1"
                            >
                                <span className="material-symbols-outlined text-[16px]">{showAllRuns ? 'expand_less' : 'expand_more'}</span>
                                {showAllRuns ? 'Show fewer runs' : `Show all ${simulations.length} runs`}
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Framework Coverage Matrix */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Framework Coverage Matrix</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Every Strategic Control mapped to the NIST CSF function, ISO/IEC 27001:2022 Annex A control, and CIS Controls v8 Safeguard it satisfies - live from the most recent simulation&apos;s active_controls, not a static reference table.
                </p>
                {isSimLoading ? (
                    <div className="flex flex-col gap-2">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-10 bg-surface-container-low rounded animate-pulse" />
                        ))}
                    </div>
                ) : simulations.length === 0 || !simulations[0]?.framework_coverage || simulations[0].framework_coverage.length === 0 ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        Run at least one simulation from Overview to populate this matrix against your real control posture.
                    </p>
                ) : (
                    (() => {
                        const coverage = simulations[0].framework_coverage!;
                        const activeCount = coverage.filter((r) => r.active).length;
                        const hasInactiveRows = activeCount < coverage.length;
                        // If nothing is active yet, falling back to "active
                        // only" would render an empty table - show
                        // everything in that case regardless of the toggle.
                        const visibleCoverage = (showAllFrameworkRows || activeCount === 0)
                            ? coverage
                            : coverage.filter((r) => r.active);
                        return (
                            <>
                                <div className="flex flex-wrap items-center gap-2 mb-stack-md">
                                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                                        {activeCount} / {coverage.length} controls active
                                    </span>
                                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                                        As of run #{simulations.length} - {new Date(simulations[0].timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface-container-low border-b border-outline-variant">
                                                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Status</th>
                                                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Strategic Control</th>
                                                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">NIST CSF</th>
                                                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">ISO/IEC 27001:2022</th>
                                                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">CIS Controls v8</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleCoverage.map((row) => (
                                                <tr key={row.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                                                    <td className="py-3 px-4">
                                                        <span className={`font-label-caps text-label-caps px-2 py-0.5 rounded ${row.active ? 'bg-[#15803d]/10 text-[#15803d]' : 'bg-surface-container text-on-surface-variant'}`}>
                                                            {row.active ? 'Active' : 'Not active'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 font-body-sm text-body-sm font-medium whitespace-nowrap">{row.id}</td>
                                                    <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant whitespace-nowrap">{row.nist_csf}</td>
                                                    <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant">{row.iso27001}</td>
                                                    <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant">{row.cis_controls}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {hasInactiveRows && activeCount > 0 && (
                                    <button
                                        onClick={() => setShowAllFrameworkRows((v) => !v)}
                                        className="mt-stack-md w-full border border-outline-variant border-dashed rounded py-2 font-label-caps text-label-caps text-on-surface-variant hover:text-primary hover:border-primary transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">{showAllFrameworkRows ? 'expand_less' : 'expand_more'}</span>
                                        {showAllFrameworkRows ? 'Show active controls only' : `Show all ${coverage.length} controls`}
                                    </button>
                                )}
                                <p className="font-body-sm text-body-sm text-on-surface-variant mt-stack-md">
                                    Each control is mapped to its single most representative clause per framework, not an exhaustive citation list - see <a href="/docs#compliance-frameworks" className="text-primary hover:underline">Docs</a> for the full methodology.
                                </p>
                            </>
                        );
                    })()
                )}
            </div>

            {/* Report Library */}
            <div>
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Regulatory Report Library</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
                    {REPORT_LIBRARY.map((report, i) => (
                        <div key={i} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col gap-stack-sm">
                            <div className="flex items-center gap-stack-sm">
                                <span className="material-symbols-outlined text-[22px] text-primary">{report.icon}</span>
                                <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded">{report.framework}</span>
                            </div>
                            <div className="font-body-sm text-body-sm font-semibold">{report.title}</div>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">{report.body}</p>
                        </div>
                    ))}
                </div>
                <a href="/docs#compliance-frameworks" className="inline-block mt-stack-md font-body-sm text-body-sm text-primary hover:underline">
                    Full computation methodology for all six frameworks &rarr;
                </a>
            </div>

            {/* Note on generation */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex gap-stack-sm items-start">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">info</span>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        Every number on this page is computed on demand from live telemetry, the audit ledger, and persisted simulation runs - nothing here is a static export. Run a simulation on Overview or accept a risk, then hit Refresh above.
                    </p>
                </div>
            </div>

            <a href={dataSource === 'own' ? '/ingestion' : '/overview'} className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

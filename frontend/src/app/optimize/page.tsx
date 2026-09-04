"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE } from '@/lib/api';

// Mirrors backend/risk_engine.py's SECURITY_CONTROLS exactly - kept in sync
// manually since the optimizer endpoint only returns which patch IDs were
// selected, not their cost/risk_reduction (those live server-side).
const PATCHES = [
    { id: 'Enforce Cloud MFA', cost: 400000, risk_reduction: 1400000, tag: 'Access' },
    { id: 'Patch Payment Gateway', cost: 1000000, risk_reduction: 1800000, tag: 'Payments' },
    { id: 'Zero Trust Architecture', cost: 1600000, risk_reduction: 2200000, tag: 'Architecture' },
    { id: 'Least-Privilege IAM Review', cost: 200000, risk_reduction: 600000, tag: 'IAM' },
    { id: 'EDR Health Remediation', cost: 500000, risk_reduction: 1200000, tag: 'Endpoint' },
    { id: 'Host Isolation & Incident Containment', cost: 800000, risk_reduction: 1900000, tag: 'Response' },
    { id: 'Public Exposure Hardening (WAF)', cost: 700000, risk_reduction: 1600000, tag: 'Network' },
    { id: 'CSPM Auto-Remediation', cost: 500000, risk_reduction: 1100000, tag: 'Cloud' },
    { id: 'Threat Intel & KEV Patch Program', cost: 800000, risk_reduction: 1400000, tag: 'Threat Intel' },
    { id: '24/7 SOC Monitoring', cost: 900000, risk_reduction: 1500000, tag: 'Monitoring' },
    { id: 'PII Data Minimization & Tokenization', cost: 1000000, risk_reduction: 1300000, tag: 'Data' },
];

// Efficiency frontier: cumulative cost vs. cumulative risk reduction,
// walking the patches in descending ROSI order. This is what diminishing
// returns actually looks like for this exact patch set - not a decorative
// curve baked into fixed pixel coordinates.
const FRONTIER = (() => {
    const sorted = [...PATCHES].sort(
        (a, b) => (b.risk_reduction / b.cost) - (a.risk_reduction / a.cost)
    );
    let cost = 0;
    let reduction = 0;
    const points = [{ cost: 0, reduction: 0 }];
    for (const p of sorted) {
        cost += p.cost;
        reduction += p.risk_reduction;
        points.push({ cost, reduction });
    }
    return points;
})();

// ₹1 Cr - wide enough that all eleven modeled controls (which now total
// ~₹84L after the formula recalibration - see backend/risk_engine.py's
// SECURITY_CONTROLS comment) are comfortably reachable, with the slider's
// top ~15% left as headroom past "buy everything."
const MAX_BUDGET = 10000000;

// Picks lakhs or crores based on magnitude instead of always formatting in
// Cr - after the formula recalibration (see backend/risk_engine.py's
// SECURITY_CONTROLS comment) every control cost and most budget values on
// this page are well under Rs 1 Cr, and "Rs0.02 Cr" reads far worse than
// "Rs2L".
function formatINR(value: number) {
    const cr = value / 10000000;
    if (cr >= 1) return `₹${cr.toFixed(2)} Cr`;
    return `₹${(value / 100000).toFixed(1)}L`;
}

const KPI_ICONS = {
    budget: 'account_balance_wallet',
    reduced: 'trending_down',
    residual: 'shield',
} as const;

export default function OptimizePage() {
    const { token } = useAuth();
    const { showToast } = useToast();
    const [budgetPct, setBudgetPct] = useState(15); // ~₹15L - just past MFA + Payment Gateway combined
    const [result, setResult] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isApproving, setIsApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const budgetValue = (budgetPct / 100) * MAX_BUDGET;
    const requestIdRef = useRef(0);

    const runOptimization = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue }),
            });
            const data = await res.json();
            if (requestId !== requestIdRef.current) return; // a newer request already landed
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setResult(data);
        } catch (e: any) {
            if (requestId !== requestIdRef.current) return;
            console.error(e);
            setError(e.message || 'Could not run the optimizer. Is the backend running, and has /api/generate-mock-data been run at least once?');
        } finally {
            if (requestId === requestIdRef.current) setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [budgetValue]);

    useEffect(() => {
        runOptimization();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const optimization = result?.optimization;
    const selected: string[] = optimization?.selected_patches || [];
    const totalRiskReduced = optimization?.total_risk_reduced || 0;
    const meanExpectedLoss = result?.monte_carlo?.mean_expected_loss || 0;
    const residual = Math.max(meanExpectedLoss - totalRiskReduced, 0);

    const approveOptimizer = async () => {
        if (!optimization) return;
        if (!token) {
            showToast('Please log in first (top-right corner) before approving the plan.', 'error');
            return;
        }
        setIsApproving(true);
        try {
            const res = await fetch(`${API_BASE}/api/audit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: `Approve AI Optimization Plan: ${selected.join(', ')}`,
                    risk_accepted: optimization.total_cost || 0,
                    board_approved: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log approval: ${data.detail || res.status}`, 'error');
                return;
            }
            showToast(`Optimization plan approved and logged. Decision #${data.decision_id}.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running?', 'error');
        } finally {
            setIsApproving(false);
        }
    };

    return (
        <div className="flex flex-col gap-stack-lg">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-stack-md">
                <div>
                    <h2 className="font-headline-md text-headline-md text-primary mb-unit">Investment Optimizer</h2>
                    <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
                        Live knapsack allocation from the real simulate-risk optimizer - drag the budget to see which controls the model actually selects.
                    </p>
                </div>
                <button
                    onClick={approveOptimizer}
                    disabled={!optimization || isApproving}
                    className="bg-primary text-on-primary py-2 px-4 rounded-lg font-body-md text-body-md hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-sm">lock</span>
                    {isApproving ? 'Logging...' : 'Approve & Log to Ledger'}
                </button>
            </div>

            {/* Budget slider */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex justify-between items-center mb-stack-sm">
                    <label htmlFor="optimizer-budget" className="font-body-sm text-body-sm font-semibold">Security Budget Allocation</label>
                    <span className="font-data-mono text-[15px] font-bold text-primary tabular-nums" aria-hidden="true">{formatINR(budgetValue)}</span>
                </div>
                <input
                    id="optimizer-budget"
                    className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary"
                    type="range" min="0" max="100" value={budgetPct}
                    onChange={(e) => setBudgetPct(Number(e.target.value))}
                    onMouseUp={runOptimization}
                    onTouchEnd={runOptimization}
                    onKeyUp={runOptimization}
                    aria-label="Security budget allocation"
                    aria-valuetext={formatINR(budgetValue)}
                />
                {error && <p className="font-body-sm text-body-sm text-error mt-stack-sm">{error}</p>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
                {/* Left column: KPIs + frontier chart */}
                <div className="lg:col-span-8 flex flex-col gap-gutter">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
                        {([
                            { key: 'budget', label: 'Budget', value: budgetValue, tone: 'text-primary', caption: 'Allocated this run' },
                            { key: 'reduced', label: 'Risk Reduced', value: totalRiskReduced, tone: 'text-primary', caption: `From ${selected.length} of ${PATCHES.length} controls` },
                            { key: 'residual', label: 'Residual Exposure', value: residual, tone: 'text-secondary', caption: 'Mean expected loss minus reduction' },
                        ] as const).map((kpi) => (
                            <div key={kpi.key} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
                                <div className="flex items-center gap-2 mb-stack-sm">
                                    <span className={`material-symbols-outlined text-[16px] ${kpi.tone}`}>{KPI_ICONS[kpi.key]}</span>
                                    <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{kpi.label}</span>
                                </div>
                                <div className={`font-data-mono text-[28px] leading-[34px] font-bold tracking-tight tabular-nums ${kpi.tone}`}>
                                    {isLoading ? '–' : formatINR(kpi.value)}
                                </div>
                                <div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">{kpi.caption}</div>
                            </div>
                        ))}
                    </div>

                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex-1 min-h-[400px] flex flex-col">
                        <div className="mb-stack-lg">
                            <h3 className="font-title-lg text-title-lg text-primary">Efficiency Frontier</h3>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">Cumulative cost vs. cumulative risk reduction, walked in ROSI order across all {PATCHES.length} modeled controls.</p>
                        </div>
                        <div className="flex-1 min-h-[280px]">
                            <ResponsiveContainer width="100%" height={320}>
                                <AreaChart data={FRONTIER} margin={{ top: 28, right: 16, left: 0, bottom: 4 }}>
                                    <defs>
                                        <linearGradient id="frontierFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                                            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                                    <XAxis
                                        dataKey="cost"
                                        type="number"
                                        domain={[0, 'dataMax']}
                                        tickFormatter={formatINR}
                                        fontSize={11}
                                        tickLine={false}
                                        axisLine={{ stroke: 'var(--outline-variant)' }}
                                        stroke="var(--on-surface-variant)"
                                        tickMargin={8}
                                    />
                                    <YAxis
                                        tickFormatter={formatINR}
                                        fontSize={11}
                                        tickLine={false}
                                        axisLine={false}
                                        stroke="var(--on-surface-variant)"
                                        width={56}
                                        tickMargin={4}
                                    />
                                    <Tooltip
                                        formatter={(v: number) => [formatINR(v), 'Cumulative reduction']}
                                        labelFormatter={(v: number) => `Cumulative cost: ${formatINR(v)}`}
                                        contentStyle={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)', borderRadius: 8, fontSize: 12 }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="reduction"
                                        stroke="var(--primary)"
                                        strokeWidth={2.5}
                                        fill="url(#frontierFill)"
                                        dot={false}
                                        activeDot={{ r: 5 }}
                                    />
                                    <ReferenceLine
                                        x={budgetValue}
                                        stroke="var(--error)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        label={{ value: 'Current budget', position: 'insideTopRight', fontSize: 10, fill: 'var(--error)', offset: 10 }}
                                    />
                                    {optimization && (
                                        <ReferenceDot
                                            x={optimization.total_cost || 0}
                                            y={optimization.total_risk_reduced || 0}
                                            r={5}
                                            fill="var(--primary)"
                                            stroke="var(--surface-container-lowest)"
                                            strokeWidth={2}
                                            label={{ value: 'Your plan', position: 'top', fontSize: 10, fill: 'var(--primary)', offset: 8 }}
                                        />
                                    )}
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Right column: real optimizer plan */}
                <div className="lg:col-span-4 flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm h-[600px]">
                    <div className="p-stack-md border-b border-outline-variant bg-surface shrink-0">
                        <div className="flex justify-between items-center mb-unit">
                            <h3 className="font-title-lg text-title-lg text-primary">Optimizer Plan</h3>
                            <span className="bg-secondary-container text-on-secondary-container text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide">Knapsack</span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">Live selection from the budget above.</p>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-stack-sm flex flex-col gap-stack-sm custom-scrollbar">
                        {isLoading && !result && (
                            <div className="text-center py-stack-lg shrink-0">
                                <span className="material-symbols-outlined text-[28px] text-outline animate-spin">progress_activity</span>
                            </div>
                        )}
                        {PATCHES.map((p) => {
                            const included = selected.includes(p.id);
                            const rosi = Math.round(((p.risk_reduction - p.cost) / p.cost) * 100);
                            return (
                                <div
                                    key={p.id}
                                    className={`shrink-0 border rounded-lg px-stack-sm py-2 relative overflow-hidden transition-colors ${
                                        included
                                            ? 'bg-surface border-primary/30'
                                            : 'bg-surface-container-low border-outline-variant opacity-60'
                                    }`}
                                >
                                    {included && <div className="absolute top-0 left-0 w-[3px] h-full bg-primary" />}
                                    <div className={`flex items-start justify-between gap-2 ${included ? 'pl-2' : ''}`}>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span
                                                    className="material-symbols-outlined text-[14px] shrink-0"
                                                    style={{ fontVariationSettings: included ? "'FILL' 1" : "'FILL' 0" }}
                                                >
                                                    {included ? 'check_circle' : 'radio_button_unchecked'}
                                                </span>
                                                <h4 className={`font-body-sm text-body-sm font-semibold leading-tight truncate ${included ? 'text-primary' : 'text-on-surface-variant'}`} title={p.id}>
                                                    {p.id}
                                                </h4>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-1 pl-[20px]">
                                                <span className="bg-surface-container-high text-on-surface-variant text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">{p.tag}</span>
                                                <span className={`font-data-mono text-[11px] font-semibold tabular-nums ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{rosi}% ROSI</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className={`font-data-mono text-[13px] font-bold tabular-nums ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{formatINR(p.cost)}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

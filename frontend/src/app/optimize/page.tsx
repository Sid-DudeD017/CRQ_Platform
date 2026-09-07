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

// A small numbered badge + title + one-line "why" caption, reused for
// every step below so the page reads as a guided sequence (set your
// budget, then pick controls, then see the impact, then log the
// decision) instead of a wall of unrelated cards.
function StepHeader({ step, title, why }: { step: number; title: string; why: string }) {
    return (
        <div className="flex items-start gap-stack-sm mb-stack-md">
            <span className="w-7 h-7 rounded-full landing-cta-gradient flex items-center justify-center font-data-mono text-[13px] font-bold shrink-0 mt-0.5">
                {step}
            </span>
            <div>
                <h3 className="font-title-lg text-title-lg text-primary leading-tight">{title}</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{why}</p>
            </div>
        </div>
    );
}

export default function OptimizePage() {
    const { token, username } = useAuth();
    const { showToast } = useToast();
    const [budgetPct, setBudgetPct] = useState(15); // ~₹15L - just past MFA + Payment Gateway combined
    const [result, setResult] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isApproving, setIsApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // [Own-data investment planning] Demo keeps the fully automatic
    // knapsack pick (it's a "watch the algorithm work" demo). Own Data
    // instead hands the wheel to the user - the whole point of ingesting
    // your real environment is deciding what YOU want to invest in next,
    // not having an algorithm decide silently. Read the same
    // hydration-safe way every other page reads it
    // (crq_data_source:<username>).
    const [dataSourceHydrated, setDataSourceHydrated] = useState(false);
    const [dataSource, setDataSource] = useState<'predefined' | 'own'>('predefined');
    useEffect(() => {
        if (!username) {
            setDataSourceHydrated(true);
            return;
        }
        try {
            const stored = localStorage.getItem(`crq_data_source:${username}`);
            setDataSource(stored === 'own' ? 'own' : 'predefined');
        } catch (e) {
            // localStorage unavailable - fall back to the automatic demo flow.
        }
        setDataSourceHydrated(true);
    }, [username]);
    const isOwn = dataSource === 'own';

    // Own-data mode's manual picks - which patch ids the user has checked
    // themselves. Unused (and untouched) in demo mode.
    const [manualSelected, setManualSelected] = useState<Record<string, boolean>>({});
    const togglePatch = (id: string) => {
        setManualSelected((prev) => ({ ...prev, [id]: !prev[id] }));
    };

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
    const autoSelected: string[] = optimization?.selected_patches || [];
    const manualSelectedIds: string[] = PATCHES.filter((p) => manualSelected[p.id]).map((p) => p.id);
    const manualCost = PATCHES.filter((p) => manualSelected[p.id]).reduce((sum, p) => sum + p.cost, 0);
    const manualRiskReduced = PATCHES.filter((p) => manualSelected[p.id]).reduce((sum, p) => sum + p.risk_reduction, 0);

    // Everything downstream (KPIs, the "Your plan" chart marker, the
    // approve action) reads from `selected`/`totalCost`/`totalRiskReduced`
    // so demo vs. own-data only has to branch once, right here.
    const selected: string[] = isOwn ? manualSelectedIds : autoSelected;
    const totalCost = isOwn ? manualCost : (optimization?.total_cost || 0);
    const totalRiskReduced = isOwn ? manualRiskReduced : (optimization?.total_risk_reduced || 0);
    const meanExpectedLoss = result?.monte_carlo?.mean_expected_loss || 0;
    const residual = Math.max(meanExpectedLoss - totalRiskReduced, 0);
    const overBudget = isOwn && manualCost > budgetValue;

    const useRecommendedMix = () => {
        const next: Record<string, boolean> = {};
        autoSelected.forEach((id) => { next[id] = true; });
        setManualSelected(next);
        showToast(`Copied the optimizer's ${autoSelected.length}-control recommendation - feel free to adjust it from here.`, 'info');
    };

    const approveOptimizer = async () => {
        if (isOwn) {
            if (selected.length === 0) {
                showToast('Choose at least one control above before approving a plan.', 'error');
                return;
            }
        } else if (!optimization) {
            return;
        }
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
                    action: isOwn
                        ? `Approve self-selected investment plan: ${selected.join(', ')}`
                        : `Approve AI Optimization Plan: ${selected.join(', ')}`,
                    risk_accepted: totalCost || 0,
                    board_approved: true,
                    data_source: dataSource,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log approval: ${data.detail || res.status}`, 'error');
                return;
            }
            showToast(`${isOwn ? 'Investment plan' : 'Optimization plan'} approved and logged. Decision #${data.decision_id}.`, 'success');
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
            <div>
                <h2 className="font-headline-md text-headline-md landing-font landing-heading-gradient mb-unit">Investment Optimizer</h2>
                <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
                    {isOwn
                        ? "A four-step walkthrough for deciding what to invest in next, calibrated on your own ingested data - you pick the controls, we show you the math."
                        : 'A four-step walkthrough of the live knapsack optimizer - drag the budget to see which controls the model picks and why.'}
                </p>
            </div>

            {/* Step 1: Budget */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <StepHeader
                    step={1}
                    title="Set Your Security Budget"
                    why="Everything below is constrained by this number - it decides what's actually affordable to invest in this cycle."
                />
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

            {/* Step 2: Pick the controls - automatic (demo) or manual (own data) */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex justify-between items-start gap-stack-sm flex-wrap mb-stack-sm">
                    <StepHeader
                        step={2}
                        title={isOwn ? 'Choose Your Controls' : 'Review the Recommended Plan'}
                        why={isOwn
                            ? "You know your environment best - check off the controls you actually plan to invest in. We total the cost and expected risk reduction as you go."
                            : 'Our knapsack optimizer already picked the combination of controls that reduces the most risk per rupee within your budget - this is what it chose, and why.'}
                    />
                    {isOwn && autoSelected.length > 0 && (
                        <button
                            onClick={useRecommendedMix}
                            title="Copy the optimizer's own budget-only suggestion as a starting point - you can still adjust it afterward"
                            className="px-3 py-1.5 border border-outline-variant text-on-surface-variant rounded font-label-caps text-label-caps font-semibold hover:bg-surface-container-low transition-colors active:scale-95 flex items-center gap-1 shrink-0"
                        >
                            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">auto_awesome</span>
                            See What the Optimizer Would Pick
                        </button>
                    )}
                </div>

                {isOwn && (
                    <div className={`flex items-center justify-between gap-stack-sm mb-stack-md px-3 py-2 rounded font-body-sm text-body-sm ${overBudget ? 'bg-error/10 text-error' : 'bg-surface-container-low text-on-surface-variant'}`}>
                        <span className="flex items-center gap-1.5">
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{overBudget ? 'warning' : 'info'}</span>
                            {selected.length} control{selected.length === 1 ? '' : 's'} selected - {formatINR(manualCost)} of your {formatINR(budgetValue)} budget
                        </span>
                        {overBudget && <span className="font-label-caps text-label-caps font-bold">Over budget</span>}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-stack-sm">
                    {isLoading && !result && (
                        <div className="col-span-full text-center py-stack-lg">
                            <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-outline animate-spin">progress_activity</span>
                        </div>
                    )}
                    {PATCHES.map((p) => {
                        const included = selected.includes(p.id);
                        const isRecommended = isOwn && autoSelected.includes(p.id);
                        const rosi = Math.round(((p.risk_reduction - p.cost) / p.cost) * 100);
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={isOwn ? () => togglePatch(p.id) : undefined}
                                disabled={!isOwn}
                                className={`text-left border rounded-lg px-stack-sm py-2 relative overflow-hidden transition-colors disabled:cursor-default ${
                                    included
                                        ? 'bg-surface border-primary/30'
                                        : 'bg-surface-container-low border-outline-variant opacity-70'
                                } ${isOwn ? 'hover:opacity-100 hover:border-primary cursor-pointer active:scale-[0.98]' : ''}`}
                            >
                                {included && <div className="absolute top-0 left-0 w-[3px] h-full bg-primary" />}
                                <div className={`flex items-start justify-between gap-2 ${included ? 'pl-2' : ''}`}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span aria-hidden="true"
                                                className="material-symbols-outlined text-[14px] shrink-0"
                                                style={{ fontVariationSettings: included ? "'FILL' 1" : "'FILL' 0" }}
                                            >
                                                {included ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                            <h4 className={`font-body-sm text-body-sm font-semibold leading-tight truncate ${included ? 'text-primary' : 'text-on-surface-variant'}`} title={p.id}>
                                                {p.id}
                                            </h4>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-1 pl-[20px] flex-wrap">
                                            <span className="bg-surface-container-high text-on-surface-variant text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">{p.tag}</span>
                                            <span className={`font-data-mono text-[11px] font-semibold tabular-nums ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{rosi}% ROSI</span>
                                            {isRecommended && (
                                                <span className="px-1.5 py-0.5 bg-[#15803d]/10 text-[#15803d] rounded font-label-caps text-[9px] flex items-center gap-0.5">
                                                    <span aria-hidden="true" className="material-symbols-outlined text-[10px]">auto_awesome</span>Recommended
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className={`font-data-mono text-[13px] font-bold tabular-nums ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{formatINR(p.cost)}</div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Step 3: Impact - KPIs + efficiency frontier */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <StepHeader
                    step={3}
                    title="See the Impact"
                    why="Compares your plan's cost and risk reduction against the theoretical best use of every rupee across all controls."
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter mb-stack-lg">
                    {([
                        { key: 'budget', label: 'Budget', value: budgetValue, tone: 'text-primary', caption: 'Allocated this run' },
                        { key: 'reduced', label: 'Risk Reduced', value: totalRiskReduced, tone: 'text-primary', caption: `From ${selected.length} of ${PATCHES.length} controls` },
                        { key: 'residual', label: 'Residual Exposure', value: residual, tone: 'text-secondary', caption: 'Mean expected loss minus reduction' },
                    ] as const).map((kpi) => (
                        <div key={kpi.key} className="bg-surface border border-outline-variant rounded-xl p-gutter shadow-sm">
                            <div className="flex items-center gap-2 mb-stack-sm">
                                <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${kpi.tone}`}>{KPI_ICONS[kpi.key]}</span>
                                <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{kpi.label}</span>
                            </div>
                            <div className={`font-data-mono text-[28px] leading-[34px] font-bold tracking-tight tabular-nums ${kpi.tone}`}>
                                {isLoading ? '–' : formatINR(kpi.value)}
                            </div>
                            <div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">{kpi.caption}</div>
                        </div>
                    ))}
                </div>

                <div className="min-h-[280px]">
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
                            {isOwn && optimization && manualCost > 0 && (optimization.total_cost !== manualCost || optimization.total_risk_reduced !== manualRiskReduced) && (
                                <ReferenceDot
                                    x={optimization.total_cost || 0}
                                    y={optimization.total_risk_reduced || 0}
                                    r={4}
                                    fill="var(--on-surface-variant)"
                                    stroke="var(--surface-container-lowest)"
                                    strokeWidth={2}
                                    label={{ value: "Optimizer's pick", position: 'bottom', fontSize: 10, fill: 'var(--on-surface-variant)', offset: 8 }}
                                />
                            )}
                            {selected.length > 0 && (
                                <ReferenceDot
                                    x={totalCost || 0}
                                    y={totalRiskReduced || 0}
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

            {/* Optimizer benchmark: ROSI-optimal vs. severity-first vs. KEV/threat-first -
                three real triage philosophies on the same budget, all numbers from this
                run's actual simulate-risk response (see backend/main.py's optimizer_benchmark). */}
            {result?.optimizer_benchmark && (() => {
                const bench = result.optimizer_benchmark;
                const deltaPct = bench.risk_reduction_delta_pct;
                const kevDeltaPct = bench.kev_risk_reduction_delta_pct;
                const bestBaselineReduction = Math.max(
                    bench.severity_first.total_risk_reduced,
                    bench.kev_first?.total_risk_reduced ?? 0,
                );
                const columns = [
                    {
                        key: 'severity_first',
                        label: 'Severity-First (CVSS greedy)',
                        icon: 'priority_high',
                        data: bench.severity_first,
                    },
                    ...(bench.kev_first ? [{
                        key: 'kev_first',
                        label: 'KEV/Threat-First (greedy)',
                        icon: 'bolt',
                        data: bench.kev_first,
                    }] : []),
                    {
                        key: 'optimal',
                        label: 'ROSI-Optimal (0/1 Knapsack)',
                        icon: 'insights',
                        data: bench.optimal,
                        highlight: true,
                    },
                ];
                return (
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                        <div className="flex items-start justify-between gap-2 flex-wrap mb-stack-md">
                            <div>
                                <h3 className="font-title-lg text-title-lg text-primary">Three Ways to Spend the Same Budget</h3>
                                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-lg">
                                    Most teams triage by CVSS severity, or by what&apos;s actively being exploited (KEV/threat intel).
                                    Here&apos;s what {formatINR(budgetValue)} actually buys under each approach, on this run&apos;s real
                                    numbers - not a scripted example.
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                                {deltaPct != null && (
                                    <span className={`font-label-caps text-label-caps px-2.5 py-1 rounded-full ${bench.risk_reduction_delta > 0 ? 'bg-[#15803d]/10 text-[#15803d]' : 'bg-error/10 text-error'}`}>
                                        {bench.risk_reduction_delta > 0 ? '+' : ''}{deltaPct}% vs. severity-first
                                    </span>
                                )}
                                {kevDeltaPct != null && (
                                    <span className={`font-label-caps text-label-caps px-2.5 py-1 rounded-full ${bench.kev_risk_reduction_delta > 0 ? 'bg-[#15803d]/10 text-[#15803d]' : 'bg-error/10 text-error'}`}>
                                        {bench.kev_risk_reduction_delta > 0 ? '+' : ''}{kevDeltaPct}% vs. KEV-first
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
                            {columns.map((col) => (
                                <div
                                    key={col.key}
                                    className={col.highlight ? 'border border-primary/40 bg-primary/5 rounded-xl p-stack-md' : 'border border-outline-variant rounded-xl p-stack-md'}
                                >
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${col.highlight ? 'text-primary' : 'text-on-surface-variant'}`}>{col.icon}</span>
                                        <span className={`font-label-caps text-label-caps ${col.highlight ? 'text-primary' : 'text-on-surface-variant'}`}>{col.label}</span>
                                    </div>
                                    <div className={`font-data-mono text-[22px] font-bold ${col.highlight ? 'text-primary' : 'text-on-surface-variant'}`}>{formatINR(col.data.total_risk_reduced)}</div>
                                    <div className="font-body-sm text-body-sm text-on-surface-variant">risk reduced from {col.data.selected_patches.length} controls, {formatINR(col.data.total_cost)} spent</div>
                                    {col.highlight && (
                                        <ul className="mt-stack-sm space-y-0.5">
                                            {col.data.selected_patches.map((id: string) => (
                                                <li key={id} className="font-body-sm text-body-sm text-primary flex items-center gap-1">
                                                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">check_circle</span>
                                                    {id}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ))}
                        </div>
                        <p className="font-label-caps text-label-caps text-on-surface-variant mt-stack-sm">
                            Severity-first funds the highest-CVSS controls first; KEV/threat-first funds whatever&apos;s most
                            tied to actively-exploited vulnerabilities first - both ignore cost-efficiency. The 0/1 knapsack
                            optimizer extracts {bestBaselineReduction > 0 ? `${Math.round((bench.optimal.total_risk_reduced / bestBaselineReduction - 1) * 100)}% more` : 'more'} risk reduction than the better of the two, from the exact same rupee.
                        </p>
                    </div>
                );
            })()}

            {/* Step 4: Approve & log */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <StepHeader
                    step={4}
                    title="Approve & Log Your Decision"
                    why="Logging creates a permanent, board-approved audit record for this plan - visit the Ledger afterward to also commit it to the on-chain trail."
                />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-stack-sm">
                    <p className="font-body-sm text-body-sm text-on-surface-variant max-w-lg">
                        {isOwn
                            ? `Approving logs your ${selected.length}-control plan (${formatINR(totalCost)}) as a board-approved decision.`
                            : `Approving logs the optimizer's ${selected.length}-control plan (${formatINR(totalCost)}) as a board-approved decision.`}
                    </p>
                    <button
                        onClick={approveOptimizer}
                        disabled={(isOwn ? selected.length === 0 : !optimization) || isApproving}
                        className="landing-cta-gradient py-2 px-4 rounded-lg font-body-md text-body-md font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
                    >
                        <span aria-hidden="true" className="material-symbols-outlined text-sm">lock</span>
                        {isApproving ? 'Logging...' : 'Approve & Log to Ledger'}
                    </button>
                </div>
            </div>

            <a href={dataSource === 'own' ? '/ingestion' : '/overview'} className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

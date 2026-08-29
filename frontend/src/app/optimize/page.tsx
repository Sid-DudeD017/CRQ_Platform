"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE } from '@/lib/api';

// Mirrors backend/main.py::simulate_risk's dummy_patches exactly - kept in
// sync manually since the optimizer endpoint only returns which patch IDs
// were selected, not their cost/risk_reduction (those live server-side).
const PATCHES = [
    { id: 'Enforce Cloud MFA', cost: 4500000, risk_reduction: 18000000, tag: 'Access' },
    { id: 'Patch Payment Gateway', cost: 12000000, risk_reduction: 40000000, tag: 'Payments' },
    { id: 'Zero Trust Architecture', cost: 35000000, risk_reduction: 90000000, tag: 'Architecture' },
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

// ₹6 Cr - wide enough that all three modeled controls (which total ₹5.15
// Cr) are actually reachable. The Overview page's slider caps at ₹1.5 Cr,
// which makes "Zero Trust Architecture" (₹3.5 Cr) structurally unreachable
// there - this page uses a range that can actually demonstrate the optimizer.
const MAX_BUDGET = 60000000;

function formatCr(value: number) {
    return `₹${(value / 10000000).toFixed(2)} Cr`;
}

export default function OptimizePage() {
    const { token } = useAuth();
    const { showToast } = useToast();
    const [budgetPct, setBudgetPct] = useState(28); // ~₹1.68 Cr - just past MFA + Payment Gateway combined
    const [result, setResult] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isApproving, setIsApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const budgetValue = (budgetPct / 100) * MAX_BUDGET;

    const runOptimization = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setResult(data);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not run the optimizer. Is the backend running, and has /api/generate-mock-data been run at least once?');
        } finally {
            setIsLoading(false);
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
                    <label className="font-body-sm text-body-sm font-semibold">Security Budget Allocation</label>
                    <span className="font-data-mono text-data-mono font-bold text-primary">{formatCr(budgetValue)}</span>
                </div>
                <input
                    className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary"
                    type="range" min="0" max="100" value={budgetPct}
                    onChange={(e) => setBudgetPct(Number(e.target.value))}
                    onMouseUp={runOptimization}
                    onTouchEnd={runOptimization}
                />
                {error && <p className="font-body-sm text-body-sm text-error mt-stack-sm">{error}</p>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
                {/* Left column: KPIs + frontier chart */}
                <div className="lg:col-span-8 flex flex-col gap-gutter">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
                            <div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Budget</div>
                            <div className="font-data-mono text-data-mono text-display-lg text-primary">{isLoading ? '–' : formatCr(budgetValue)}</div>
                            <div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">Allocated this run</div>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
                            <div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Risk Reduced</div>
                            <div className="font-data-mono text-data-mono text-display-lg text-primary">{isLoading ? '–' : formatCr(totalRiskReduced)}</div>
                            <div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">From {selected.length} of {PATCHES.length} controls</div>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
                            <div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Residual Exposure</div>
                            <div className="font-data-mono text-data-mono text-display-lg text-secondary">{isLoading ? '–' : formatCr(residual)}</div>
                            <div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">Mean expected loss minus reduction</div>
                        </div>
                    </div>

                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex-1 min-h-[400px] flex flex-col">
                        <div className="mb-stack-lg">
                            <h3 className="font-title-lg text-title-lg text-primary">Efficiency Frontier</h3>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">Cumulative cost vs. cumulative risk reduction, walked in ROSI order across the three modeled controls.</p>
                        </div>
                        <div className="flex-1 min-h-[280px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={FRONTIER} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                    <XAxis dataKey="cost" tickFormatter={(v) => `₹${(v / 10000000).toFixed(1)}Cr`} fontSize={11} />
                                    <YAxis tickFormatter={(v) => `₹${(v / 10000000).toFixed(1)}Cr`} fontSize={11} />
                                    <Tooltip formatter={(v: number) => formatCr(v)} labelFormatter={(v: number) => `Cumulative cost: ${formatCr(v)}`} />
                                    <Line type="monotone" dataKey="reduction" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
                                    <ReferenceLine x={budgetValue} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'Current Budget', position: 'top', fontSize: 11, fill: '#dc2626' }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Right column: real optimizer plan */}
                <div className="lg:col-span-4 flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm h-full max-h-[800px] overflow-hidden">
                    <div className="p-gutter border-b border-outline-variant bg-surface">
                        <div className="flex justify-between items-center mb-unit">
                            <h3 className="font-title-lg text-title-lg text-primary">Optimizer Plan</h3>
                            <span className="bg-secondary-container text-on-secondary-container text-xs font-bold px-2 py-1 rounded-full">Knapsack Model</span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">Live selection from POST /api/simulate-risk for the budget above.</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-gutter flex flex-col gap-stack-md custom-scrollbar">
                        {PATCHES.map((p) => {
                            const included = selected.includes(p.id);
                            const rosi = Math.round(((p.risk_reduction - p.cost) / p.cost) * 100);
                            return (
                                <div key={p.id} className={`border border-outline-variant rounded-lg p-stack-md relative overflow-hidden ${included ? 'bg-surface' : 'bg-surface-container-low opacity-70'}`}>
                                    {included && <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>}
                                    <div className={`flex justify-between items-start mb-stack-sm ${included ? 'pl-2' : ''}`}>
                                        <div>
                                            <h4 className={`font-title-lg text-title-lg text-base ${included ? 'text-primary' : 'text-on-surface-variant line-through decoration-outline-variant'}`}>{p.id}</h4>
                                            <div className="flex gap-2 mt-1">
                                                <span className="bg-surface-container-high text-on-surface-variant text-[10px] uppercase font-bold px-2 py-0.5 rounded">{p.tag}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`font-data-mono text-data-mono text-sm font-bold ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{formatCr(p.cost)}</div>
                                            <div className="font-body-sm text-body-sm text-on-surface-variant text-xs">Cost</div>
                                        </div>
                                    </div>
                                    <div className={`flex justify-between items-center mt-stack-md pt-stack-sm border-t border-outline-variant ${included ? 'pl-2' : ''}`}>
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: included ? "'FILL' 1" : "'FILL' 0" }}>{included ? 'check_circle' : 'cancel'}</span>
                                            <span className={`font-label-caps text-label-caps ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{included ? 'Included' : 'Excluded'}</span>
                                        </div>
                                        <span className={`font-data-mono text-data-mono text-sm font-bold ${included ? 'text-primary' : 'text-on-surface-variant'}`}>{rosi}% ROSI</span>
                                    </div>
                                </div>
                            );
                        })}
                        {isLoading && (
                            <div className="text-center py-stack-lg">
                                <span className="material-symbols-outlined text-[32px] text-outline animate-spin">progress_activity</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

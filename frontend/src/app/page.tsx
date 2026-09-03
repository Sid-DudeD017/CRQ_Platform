"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE } from '@/lib/api';
import MonteCarloCurve from '@/components/charts/MonteCarloCurve';
import SebiCapabilityRadar from '@/components/charts/SebiCapabilityRadar';
import TornadoChart from '@/components/charts/TornadoChart';
import CrmlDrawer from '@/components/rac/CrmlDrawer';

export default function ExecutiveDashboard() {
    const { token } = useAuth();
    const { showToast } = useToast();
    const [budget, setBudget] = useState(65);
    const [simResults, setSimResults] = useState<any>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    const [controls, setControls] = useState<Record<string, boolean>>({
        'Enforce Cloud MFA': true,
        'Patch Payment Gateway': false,
        'Zero Trust Architecture': false,
    });
    const [optimizerPicks, setOptimizerPicks] = useState<string[] | null>(null);
    const [acceptingRiskFor, setAcceptingRiskFor] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState(false);

    // AI Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatSending, setIsChatSending] = useState(false);

    // CRML Risk-as-Code Drawer
    const [isCrmlOpen, setIsCrmlOpen] = useState(false);

    const toggleControl = (name: string) => {
        setControls((prev) => ({ ...prev, [name]: !prev[name] }));
    };

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBudget(Number(e.target.value));
    };

    const runSimulation = async () => {
        setIsSimulating(true);
        try {
            const budgetValue = (budget / 100) * 15000000;
            const res = await fetch(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue })
            });
            const data = await res.json();
            setSimResults(data);
            const picks: string[] = data.optimization.selected_patches || [];
            setOptimizerPicks(picks);
            setControls((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((name) => {
                    next[name] = picks.includes(name);
                });
                return next;
            });
            showToast(`Simulation complete: ${picks.length} controls recommended within budget.`, 'success');
        } catch (e) {
            console.error(e);
            showToast("Error running simulation. Ensure backend is running on port 8000.", 'error');
        } finally {
            setIsSimulating(false);
        }
    };

    useEffect(() => {
        runSimulation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const acceptRisk = async (label: string, riskAmountRupees: number) => {
        if (!token) {
            showToast('Please log in first (top-right corner) before accepting risk.', 'error');
            return;
        }
        setAcceptingRiskFor(label);
        try {
            const res = await fetch(`${API_BASE}/api/audit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: `Accept residual risk: ${label}`,
                    risk_accepted: riskAmountRupees,
                    board_approved: false,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log audit: ${data.detail || res.status}`, 'error');
                return;
            }
            showToast(`Risk accepted & logged on-chain. Decision #${data.decision_id} by ${data.decided_by}`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error');
        } finally {
            setAcceptingRiskFor(null);
        }
    };

    const approveOptimizer = async () => {
        if (!simResults?.optimization) return;
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
                    action: `Approve AI Optimization Plan: ${(simResults.optimization.selected_patches || []).join(', ')}`,
                    risk_accepted: simResults.optimization.total_cost || 0,
                    board_approved: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log approval: ${data.detail || res.status}`, 'error');
                return;
            }
            showToast(`Optimization plan approved and committed to ledger. Decision #${data.decision_id}.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend.', 'error');
        } finally {
            setIsApproving(false);
        }
    };

    const sendMessage = async () => {
        if (!chatInput.trim()) return;

        const newMessages = [...chatMessages, { role: 'user', content: chatInput }];
        setChatMessages(newMessages);
        setChatInput('');
        setIsChatSending(true);

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: chatInput, context: simResults })
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let assistantResponse = '';

            setChatMessages([...newMessages, { role: 'assistant', content: '' }]);

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    assistantResponse += decoder.decode(value);
                    setChatMessages([...newMessages, { role: 'assistant', content: assistantResponse }]);
                }
            }
        } catch (e) {
            console.error(e);
            setChatMessages([...newMessages, { role: 'assistant', content: "Error communicating with Virtual CISO." }]);
        } finally {
            setIsChatSending(false);
        }
    };

    const formatCr = (val: number) => `₹${(val / 10000000).toFixed(2)} Cr`;

    return (
        <div className="flex flex-col gap-6 max-w-[1440px] mx-auto pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[28px]">shield</span>
                        <h1 className="font-headline-md text-headline-md text-primary font-bold">Portfolio Risk Overview</h1>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                        Continuous mathematical quantification of enterprise cyber risk vs. security capital allocation.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setIsCrmlOpen(true)}
                        className="px-3 py-1.5 bg-[#0f172a] text-[#38bdf8] border border-slate-700 hover:border-slate-500 rounded-lg font-data-mono text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                        title="View Declarative Risk Model Specification"
                    >
                        <span className="material-symbols-outlined text-[15px]">code</span> View Model Spec
                    </button>
                    <span className="font-label-caps text-xs text-on-surface-variant px-2.5 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#10b981]">check_circle</span> Telemetry Active
                    </span>
                    <span className="font-label-caps text-xs text-on-surface-variant px-2.5 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-primary">gavel</span> SEBI | RBI | DPDP | NIST
                    </span>
                    <Link
                        href="/reports"
                        className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container px-3.5 py-1.5 rounded-lg font-body-sm text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                        <span className="material-symbols-outlined text-[16px]">assessment</span> Board Report
                    </Link>
                </div>
            </div>

            {/* Top Row: Executive Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                {/* 1. Expected Annual Loss (ALE) */}
                <div className="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between elevate shadow-sm">
                    <div>
                        <div className="flex justify-between items-start mb-1">
                            <h3 className="font-title-lg font-bold text-primary">Annualized Loss Expectancy</h3>
                            <span className="text-[10px] uppercase font-label-caps px-2 py-0.5 rounded bg-primary-container text-on-primary-container">
                                FAIR ALE
                            </span>
                        </div>
                        <p className="font-body-sm text-xs text-on-surface-variant mb-4">
                            Projected mean financial loss based on current posture and telemetry.
                        </p>
                    </div>
                    <div>
                        <div className="flex items-baseline gap-2">
                            <span className="font-display-lg text-4xl font-extrabold text-primary tracking-tight font-data-mono">
                                {simResults && simResults.monte_carlo
                                    ? formatCr(simResults.monte_carlo.mean_expected_loss)
                                    : "₹4.28 Cr"}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 mt-2 text-[#ef4444] text-xs">
                            <span className="material-symbols-outlined text-[14px]">trending_up</span>
                            <span className="font-data-mono font-semibold">+4.2% YoY without patch remediations</span>
                        </div>
                    </div>
                </div>

                {/* 2. 95% Tail VaR & ROSI Spend Efficiency */}
                <div className="col-span-12 lg:col-span-4 flex flex-col gap-4">
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex-1 flex flex-col justify-center elevate shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                            <h4 className="font-label-caps text-xs text-on-surface-variant uppercase">95% Value at Risk (VaR)</h4>
                            <span className="text-[10px] text-[#f59e0b] font-bold font-data-mono">1-in-20 yr event</span>
                        </div>
                        <div className="font-headline-md text-2xl font-bold text-[#f59e0b] font-data-mono">
                            {simResults && simResults.monte_carlo
                                ? formatCr(simResults.monte_carlo.var_95)
                                : "₹12.50 Cr"}
                        </div>
                        <div className="text-on-surface-variant text-[11px] mt-0.5">Maximum financial loss at 95% confidence</div>
                    </div>

                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex-1 flex flex-col justify-center elevate shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                            <h4 className="font-label-caps text-xs text-on-surface-variant uppercase">ROSI Spend Efficiency</h4>
                            <span className="text-[10px] text-[#10b981] font-bold font-data-mono">Return on Sec. Inv.</span>
                        </div>
                        <div className="font-headline-md text-2xl font-bold text-[#10b981] font-data-mono flex items-center">
                            <span className="material-symbols-outlined mr-1 text-[20px]">arrow_upward</span>
                            {simResults?.optimization?.total_risk_reduced && simResults?.optimization?.total_cost
                                ? `${Math.round(((simResults.optimization.total_risk_reduced - simResults.optimization.total_cost) / simResults.optimization.total_cost) * 100)}%`
                                : "240%"}
                        </div>
                        <div className="text-on-surface-variant text-[11px] mt-0.5">Optimal Knapsack capital multiplier</div>
                    </div>
                </div>

                {/* 3. SEBI Resilience Radar */}
                <div className="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col justify-between elevate shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-title-md font-bold text-primary">SEBI Capability Index</h3>
                            <p className="text-[11px] text-on-surface-variant">5-Pillar CSCRF Resilience Score</p>
                        </div>
                        <span className="text-[10px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded font-label-caps">
                            Mandated 2024
                        </span>
                    </div>
                    <SebiCapabilityRadar resilience={simResults?.sebi_resilience} height={190} />
                </div>
            </div>

            {/* Middle Row: Monte Carlo Curve + Sensitivity Tornado Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Monte Carlo Loss Curve */}
                <div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between elevate shadow-sm">
                    <div className="mb-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-title-lg font-bold text-primary">Monte Carlo Loss Distribution</h3>
                            <span className="text-xs text-on-surface-variant font-data-mono">10,000 Iterations</span>
                        </div>
                        <p className="font-body-sm text-xs text-on-surface-variant">
                            Empirical loss probability density derived from Threat Frequency vs. Control Vulnerability.
                        </p>
                    </div>
                    <MonteCarloCurve
                        distributionCurve={simResults?.monte_carlo?.distribution_curve}
                        meanLoss={simResults?.monte_carlo?.mean_expected_loss}
                        var95={simResults?.monte_carlo?.var_95}
                        var99={simResults?.monte_carlo?.var_99}
                        height={220}
                    />
                </div>

                {/* Sensitivity / Tornado Ranking */}
                <div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between elevate shadow-sm">
                    <div className="mb-2">
                        <h3 className="font-title-lg font-bold text-primary">Sensitivity / Risk Drivers</h3>
                        <p className="font-body-sm text-xs text-on-surface-variant">
                            Ranks parameters causing the largest swings in total financial exposure.
                        </p>
                    </div>
                    <TornadoChart height={220} />
                </div>
            </div>

            {/* Bottom Row: Simulation Sandbox & Business Unit Risk Acceptance */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* What-If Sandbox */}
                <div className="col-span-12 lg:col-span-6 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between elevate shadow-sm">
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-title-lg font-bold text-primary">Simulation Sandbox</h3>
                            <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded font-label-caps text-xs">
                                Draft Mode
                            </span>
                        </div>

                        {/* Budget Slider */}
                        <div className="mb-4">
                            <div className="flex justify-between mb-1.5">
                                <label className="font-body-sm text-xs font-semibold">Security Budget Allocation</label>
                                <span className="font-data-mono font-bold text-primary text-sm">
                                    ₹{((budget / 100) * 1.5).toFixed(2)} Cr
                                </span>
                            </div>
                            <input
                                className="w-full h-1 bg-surface-variant rounded-lg cursor-pointer accent-primary"
                                max="100"
                                min="0"
                                type="range"
                                value={budget}
                                onChange={handleBudgetChange}
                            />
                        </div>

                        {/* Strategic Controls */}
                        <div className="space-y-2 mb-4">
                            <div className="flex items-center justify-between p-2.5 border border-outline-variant rounded bg-surface">
                                <div className="flex items-center gap-2">
                                    <span className="font-body-sm text-xs font-medium">Enforce Cloud MFA</span>
                                    {optimizerPicks?.includes('Enforce Cloud MFA') && (
                                        <span className="px-1.5 py-0.2 bg-[#10b981]/15 text-[#10b981] rounded text-[10px] font-label-caps font-semibold">
                                            Recommended
                                        </span>
                                    )}
                                </div>
                                <span className="font-data-mono text-xs text-on-surface-variant font-bold">₹45 Lakhs</span>
                            </div>
                            <div className="flex items-center justify-between p-2.5 border border-outline-variant rounded bg-surface">
                                <div className="flex items-center gap-2">
                                    <span className="font-body-sm text-xs font-medium">Patch Payment Gateway</span>
                                    {optimizerPicks?.includes('Patch Payment Gateway') && (
                                        <span className="px-1.5 py-0.2 bg-[#10b981]/15 text-[#10b981] rounded text-[10px] font-label-caps font-semibold">
                                            Recommended
                                        </span>
                                    )}
                                </div>
                                <span className="font-data-mono text-xs text-on-surface-variant font-bold">₹1.20 Cr</span>
                            </div>
                            <div className="flex items-center justify-between p-2.5 border border-outline-variant rounded bg-surface">
                                <div className="flex items-center gap-2">
                                    <span className="font-body-sm text-xs font-medium">Zero Trust Architecture</span>
                                    {optimizerPicks?.includes('Zero Trust Architecture') && (
                                        <span className="px-1.5 py-0.2 bg-[#10b981]/15 text-[#10b981] rounded text-[10px] font-label-caps font-semibold">
                                            Recommended
                                        </span>
                                    )}
                                </div>
                                <span className="font-data-mono text-xs text-on-surface-variant font-bold">₹3.50 Cr</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={runSimulation}
                            disabled={isSimulating}
                            className="flex-1 bg-primary text-on-primary py-2.5 rounded-lg font-semibold text-xs hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
                        >
                            <span className={`material-symbols-outlined text-[16px] ${isSimulating ? 'animate-spin' : ''}`}>
                                {isSimulating ? 'progress_activity' : 'refresh'}
                            </span>
                            {isSimulating ? 'Recalculating...' : 'Recalculate Optimizer'}
                        </button>
                        {simResults?.optimization && (
                            <button
                                onClick={approveOptimizer}
                                disabled={isApproving}
                                className="px-4 py-2.5 bg-[#10b981] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-[16px]">lock</span>
                                {isApproving ? 'Logging...' : 'Approve Plan'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Risk by Business Unit Breakdown */}
                <div className="col-span-12 lg:col-span-6 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between elevate shadow-sm">
                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-title-lg font-bold text-primary">Risk by Business Unit</h3>
                            <Link href="/ledger" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                                Detailed Ledger <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            </Link>
                        </div>
                        <p className="text-xs text-on-surface-variant mb-4">
                            Annualized loss per business unit with 1-click on-chain risk acceptance.
                        </p>

                        <div className="space-y-3">
                            {/* Unit 1 */}
                            <div className="p-3 bg-surface border border-outline-variant rounded-lg flex flex-col justify-between gap-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="font-body-sm font-semibold text-xs text-on-surface">Payment Processing & Checkout</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-data-mono font-bold text-xs text-[#ef4444]">₹2.00 Cr/yr</span>
                                        <button
                                            onClick={() => acceptRisk('Payment Processing', 20000000)}
                                            disabled={acceptingRiskFor === 'Payment Processing'}
                                            className="px-2 py-0.5 border border-outline-variant text-[10px] font-label-caps rounded hover:border-[#ef4444] hover:text-[#ef4444] transition-colors"
                                        >
                                            {acceptingRiskFor === 'Payment Processing' ? 'Logging...' : 'Accept Risk'}
                                        </button>
                                    </div>
                                </div>
                                <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                                    <div className="bg-[#ef4444] h-2 rounded" style={{ width: '45%' }}></div>
                                </div>
                            </div>

                            {/* Unit 2 */}
                            <div className="p-3 bg-surface border border-outline-variant rounded-lg flex flex-col justify-between gap-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="font-body-sm font-semibold text-xs text-on-surface">Retail Banking Operations</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-data-mono font-bold text-xs text-[#f59e0b]">₹1.20 Cr/yr</span>
                                        <button
                                            onClick={() => acceptRisk('Retail Operations', 12000000)}
                                            disabled={acceptingRiskFor === 'Retail Operations'}
                                            className="px-2 py-0.5 border border-outline-variant text-[10px] font-label-caps rounded hover:border-[#ef4444] hover:text-[#ef4444] transition-colors"
                                        >
                                            {acceptingRiskFor === 'Retail Operations' ? 'Logging...' : 'Accept Risk'}
                                        </button>
                                    </div>
                                </div>
                                <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                                    <div className="bg-[#f59e0b] h-2 rounded" style={{ width: '28%' }}></div>
                                </div>
                            </div>

                            {/* Unit 3 */}
                            <div className="p-3 bg-surface border border-outline-variant rounded-lg flex flex-col justify-between gap-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="font-body-sm font-semibold text-xs text-on-surface">Corporate IT & Identity</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-data-mono font-bold text-xs text-[#3b82f6]">₹0.68 Cr/yr</span>
                                        <button
                                            onClick={() => acceptRisk('Corporate IT', 6800000)}
                                            disabled={acceptingRiskFor === 'Corporate IT'}
                                            className="px-2 py-0.5 border border-outline-variant text-[10px] font-label-caps rounded hover:border-[#ef4444] hover:text-[#ef4444] transition-colors"
                                        >
                                            {acceptingRiskFor === 'Corporate IT' ? 'Logging...' : 'Accept Risk'}
                                        </button>
                                    </div>
                                </div>
                                <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                                    <div className="bg-[#3b82f6] h-2 rounded" style={{ width: '15%' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-3 border-t border-outline-variant mt-2 text-xs text-on-surface-variant flex justify-between items-center">
                        <span>Total Portfolio Exposure:</span>
                        <span className="font-data-mono font-bold text-primary text-sm">
                            {simResults?.monte_carlo ? formatCr(simResults.monte_carlo.mean_expected_loss) : "₹4.28 Cr"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Declarative Risk Model Inspector Drawer */}
            <CrmlDrawer
                isOpen={isCrmlOpen}
                onClose={() => setIsCrmlOpen(false)}
                meanExpectedLoss={simResults?.monte_carlo?.mean_expected_loss}
                var95={simResults?.monte_carlo?.var_95}
                isDpdpActive={true}
            />

            {/* AI Assistant Chat Panel */}
            {isChatOpen && (
                <div className="fixed bottom-24 right-8 w-96 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl flex flex-col overflow-hidden z-50 animate-fade-scale-in">
                    <div className="bg-primary text-on-primary p-3.5 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                            <h3 className="font-title-md font-bold text-sm">Virtual CISO Agent</h3>
                        </div>
                        <button onClick={() => setIsChatOpen(false)} className="hover:opacity-80">
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>

                    <div className="h-80 overflow-y-auto p-4 bg-surface flex flex-col gap-2 custom-scrollbar">
                        {chatMessages.length === 0 && (
                            <div className="text-on-surface-variant text-xs text-center mt-6">
                                Ask the Virtual CISO about RBI/SEBI/DPDP compliance regulations, telemetry status, or budget optimization...
                            </div>
                        )}
                        {chatMessages.map((msg, idx) => {
                            const sourceMatch = msg.content.match(/\n*Sources?:\s*([A-Za-z0-9,\/ ]+)\s*$/i);
                            const mainText = sourceMatch ? msg.content.slice(0, sourceMatch.index) : msg.content;
                            const sourceTags = sourceMatch
                                ? sourceMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
                                : [];

                            return (
                                <div
                                    key={idx}
                                    className={`p-3 rounded-lg max-w-[85%] text-xs ${msg.role === 'user' ? 'bg-primary-container text-on-primary-container self-end' : 'bg-surface-variant text-on-surface-variant self-start'}`}
                                >
                                    <p className="whitespace-pre-wrap">{mainText}</p>
                                    {sourceTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-outline-variant/40">
                                            {sourceTags.map((tag, i) => (
                                                <span key={i} className="px-1.5 py-0.2 bg-primary-container text-on-primary-container rounded text-[10px] font-label-caps">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-2.5 border-t border-outline-variant bg-surface-container-low flex gap-1.5">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                            placeholder="Ask Virtual CISO..."
                            className="flex-1 bg-surface border border-outline-variant rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={isChatSending}
                            className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90 disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[16px]">
                                {isChatSending ? 'hourglass_top' : 'send'}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Chat Trigger Button */}
            <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-xl z-50 hover:scale-105 active:scale-95 transition-all"
                aria-label="Virtual CISO Assistant"
            >
                <span className="material-symbols-outlined text-[24px]">
                    {isChatOpen ? 'close' : 'auto_awesome'}
                </span>
            </button>
        </div>
    );
}

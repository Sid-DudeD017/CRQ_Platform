"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE, fetchWithRetry } from '@/lib/api';

// Every entry here must exactly match a SECURITY_CONTROLS id in
// backend/risk_engine.py (id, cost) - that's what makes each toggle a
// real, formula-calibrated control instead of a cosmetic switch. Costs
// mirror backend/risk_engine.py's SECURITY_CONTROLS exactly (paise-accurate
// vs. the display label), so the optimizer's "Optimized Cost" and this
// list never disagree about what a control costs.
const STRATEGIC_CONTROLS: { name: string; costLabel: string }[] = [
    { name: 'Enforce Cloud MFA', costLabel: 'Est. Cost: ₹4L' },
    { name: 'Patch Payment Gateway', costLabel: 'Est. Cost: ₹10L' },
    { name: 'Zero Trust Architecture', costLabel: 'Est. Cost: ₹16L' },
    { name: 'Least-Privilege IAM Review', costLabel: 'Est. Cost: ₹2L' },
    { name: 'EDR Health Remediation', costLabel: 'Est. Cost: ₹5L' },
    { name: 'Host Isolation & Incident Containment', costLabel: 'Est. Cost: ₹8L' },
    { name: 'Public Exposure Hardening (WAF)', costLabel: 'Est. Cost: ₹7L' },
    { name: 'CSPM Auto-Remediation', costLabel: 'Est. Cost: ₹5L' },
    { name: 'Threat Intel & KEV Patch Program', costLabel: 'Est. Cost: ₹8L' },
    { name: '24/7 SOC Monitoring', costLabel: 'Est. Cost: ₹9L' },
    { name: 'PII Data Minimization & Tokenization', costLabel: 'Est. Cost: ₹10L' },
];

type DriftInsight = { tone: 'up' | 'down' | 'flat'; lines: string[] };

// Ported from reports/page.tsx's run-diffing logic, but attributes to a
// named risk_drivers component (see risk_engine.derive_fair_inputs'
// "Explainable Risk Attribution" waterfall) instead of only a control-
// toggle diff, and is meant for an at-a-glance callout right on Overview -
// "risk just moved, here's why" - rather than requiring a trip to the
// Reports ledger. Never fabricates a cause it can't point to in the data;
// falls back to naming a control toggle, then to an honest "sampling
// variance" line, exactly like the Reports page does.
function buildDriftInsight(latest: any, prev: any): DriftInsight | null {
    if (!latest || !prev || !prev.expected_annual_loss) return null;
    const aleDelta = ((latest.expected_annual_loss - prev.expected_annual_loss) / prev.expected_annual_loss) * 100;
    const tone: 'up' | 'down' | 'flat' = aleDelta < -1 ? 'down' : aleDelta > 1 ? 'up' : 'flat';
    const aleCr = (v: number) => `₹${(v / 10000000).toFixed(2)} Cr`;
    const lines: string[] = [];

    if (tone === 'flat') {
        lines.push(`ALE is steady vs. your last run (${aleDelta >= 0 ? '+' : ''}${aleDelta.toFixed(1)}%, ${aleCr(latest.expected_annual_loss)}).`);
        return { tone, lines };
    }

    lines.push(
        tone === 'down'
            ? `Risk moved: ALE fell ${Math.abs(aleDelta).toFixed(1)}% vs. your last run (${aleCr(prev.expected_annual_loss)} → ${aleCr(latest.expected_annual_loss)}).`
            : `Risk moved: ALE rose ${aleDelta.toFixed(1)}% vs. your last run (${aleCr(prev.expected_annual_loss)} → ${aleCr(latest.expected_annual_loss)}).`
    );

    let attributed = false;
    const rd = latest.risk_drivers, prd = prev.risk_drivers;
    if (rd && prd && Object.keys(rd).length > 0 && Object.keys(prd).length > 0) {
        // Each contribution is expressed as its effect ON Control Strength
        // (positive = strengthened posture = pushes ALE down), so the
        // biggest-magnitude one is the real story, whichever direction.
        const contributions: { name: string; impact: number; detail: string | null }[] = [
            {
                name: 'confirmed Ingestion Engine gaps',
                impact: -(rd.gap_deduction - prd.gap_deduction),
                detail: `${prd.confirmed_gap_count} → ${rd.confirmed_gap_count} confirmed gap(s)`,
            },
            {
                name: 'Training coverage',
                impact: rd.training_boost - prd.training_boost,
                detail: `${(prd.training_coverage_pct ?? 0).toFixed(0)}% → ${(rd.training_coverage_pct ?? 0).toFixed(0)}% of modules`,
            },
            {
                name: 'live telemetry (MFA, patches, EDR, exposure...)',
                impact: -(rd.telemetry_deduction - prd.telemetry_deduction),
                detail: null,
            },
            {
                name: 'blast-radius / vulnerability posture',
                impact: rd.cs_upstream - prd.cs_upstream,
                detail: null,
            },
        ].filter((c) => Math.abs(c.impact) > 0.05);

        if (contributions.length > 0) {
            contributions.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
            const top = contributions[0];
            lines.push(
                `Driver: ${top.name} ${top.impact > 0 ? 'strengthened' : 'weakened'} Control Strength (${top.impact > 0 ? '+' : ''}${top.impact.toFixed(1)} pts)${top.detail ? ` – ${top.detail}` : ''}.`
            );
            attributed = true;
        } else if (typeof rd.tef_final === 'number' && typeof prd.tef_final === 'number' && Math.abs(rd.tef_final - prd.tef_final) > 0.5) {
            lines.push(`Driver: Threat Event Frequency moved ${rd.tef_final > prd.tef_final ? 'up' : 'down'} (${prd.tef_final.toFixed(1)} → ${rd.tef_final.toFixed(1)}/yr) – live threat telemetry, not your controls.`);
            attributed = true;
        }
    }

    if (!attributed) {
        const latestOn = new Set(Object.entries(latest.active_controls || {}).filter(([, v]) => !!v).map(([k]) => k));
        const prevOn = new Set(Object.entries(prev.active_controls || {}).filter(([, v]) => !!v).map(([k]) => k));
        const turnedOn = Array.from(latestOn).filter((c) => !prevOn.has(c));
        const turnedOff = Array.from(prevOn).filter((c) => !latestOn.has(c));
        if (tone === 'down' && turnedOn.length > 0) {
            lines.push(`Driver: ${turnedOn.join(', ')} turned on.`);
            attributed = true;
        } else if (tone === 'up' && turnedOff.length > 0) {
            lines.push(`Driver: ${turnedOff.join(', ')} turned off.`);
            attributed = true;
        }
    }

    if (!attributed) {
        lines.push('No control or driver moved enough to explain this – likely Monte Carlo sampling variance.');
    }

    return { tone, lines };
}

export default function ExecutiveDashboard() {
    const router = useRouter();
    const { token } = useAuth();
    const { showToast } = useToast();
    const [budget, setBudget] = useState(65);
    const [simResults, setSimResults] = useState<any>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    const [controls, setControls] = useState<Record<string, boolean>>(
        Object.fromEntries(STRATEGIC_CONTROLS.map((c) => [c.name, c.name === 'Enforce Cloud MFA']))
    );
    const [optimizerPicks, setOptimizerPicks] = useState<string[] | null>(null);
    const simRequestIdRef = useRef(0);

    const toggleControl = (name: string) => {
        setControls((prev) => ({ ...prev, [name]: !prev[name] }));
    };

    // Explicit, opt-in version of what runSimulation used to do silently -
    // adopts the optimizer's last recommendation as the toggle state, only
    // when someone actually clicks for it.
    const applyRecommended = () => {
        if (!optimizerPicks) return;
        setControls((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((name) => {
                next[name] = optimizerPicks.includes(name);
            });
            return next;
        });
        showToast(`Applied the recommended mix - ${optimizerPicks.length} of ${STRATEGIC_CONTROLS.length} controls. Run Simulation again to see its effect.`, 'info');
    };
    // [Explainable Risk Attribution] "risk just moved, here's why" - a
    // proactive callout, not a diagnostic someone has to visit Reports to
    // find. Diffs the two most recent persisted /api/simulations rows
    // (fetched fresh on mount and again after every run this tab
    // triggers), so it stays accurate even if the last run happened in a
    // different tab/session.
    const [driftInsight, setDriftInsight] = useState<DriftInsight | null>(null);
    const fetchDrift = async () => {
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/simulations?limit=2`);
            if (!res.ok) return;
            const data = await res.json();
            const rows: any[] = data.data || [];
            setDriftInsight(rows.length >= 2 ? buildDriftInsight(rows[0], rows[1]) : null);
        } catch (e) {
            console.error(e);
            // Silent - this is a bonus callout, not core simulation flow;
            // no toast needed if a slow/offline backend can't fetch history.
        }
    };
    useEffect(() => { fetchDrift(); }, []);
    const [acceptingRiskFor, setAcceptingRiskFor] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatSending, setIsChatSending] = useState(false);

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBudget(Number(e.target.value));
    };

    const runSimulation = async () => {
        const requestId = ++simRequestIdRef.current;
        setIsSimulating(true);
        try {
            // budget here is 0-100 (slider %). Max budget is Rs 1 Cr =
            // 10,000,000 rupees - recalibrated alongside
            // risk_engine.SECURITY_CONTROLS (see that module's comment):
            // the 11 controls now total ~Rs 84L, so a Rs 1 Cr ceiling
            // comfortably reaches "buy everything" with a little headroom,
            // instead of the old Rs 15 Cr ceiling that left ~94% of the
            // slider doing nothing.
            const budgetValue = (budget / 100) * 10000000;
            const res = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue, active_controls: controls })
            });
            const data = await res.json();
            // A slower, older request can resolve after a newer one - only
            // the most recently *fired* request is allowed to touch state,
            // otherwise a quick second click could get clobbered a moment
            // later by the first click's late response, which looked
            // exactly like the sandbox being "stuck on the previous run".
            if (requestId !== simRequestIdRef.current) return;
            if (!res.ok) {
                // Previously this branch didn't exist - a non-2xx response
                // (rate limit, validation error, no-assets-found, etc.)
                // still got passed to setSimResults, which silently left
                // every panel in its "Run a simulation..." empty state with
                // no visible explanation of what went wrong.
                showToast(`Simulation failed: ${data.detail || res.status}`, 'error');
                return;
            }
            setSimResults(data);
            const picks: string[] = data.optimization.selected_patches || [];
            setOptimizerPicks(picks);
            // Bug fix: this used to force every Strategic Controls toggle
            // to match the optimizer's own budget-only recommendation
            // right after every run - so no matter which controls someone
            // actually chose (and the ALE just computed WAS based on that
            // real choice), the checkboxes snapped back to the same fixed
            // set a moment later. Since the optimizer's pick for a given
            // budget doesn't depend on active_controls at all, it's
            // deterministic - so it kept snapping back to the identical
            // set every time, which is exactly why manual choices looked
            // like they were being ignored and results looked "stuck".
            // The "Recommended" badge (driven by optimizerPicks, set
            // above) is the intended way to surface this - it's advisory,
            // not something that should silently overwrite what someone
            // just chose. See applyRecommended() below for an explicit,
            // opt-in way to adopt it instead.
            showToast(`Simulation complete - ${picks.length} of ${STRATEGIC_CONTROLS.length} controls recommended within this budget.`, 'success');
            console.log("Sim Results:", data);
            // This run was just persisted server-side (see /api/simulate-risk),
            // so refresh the drift callout against the real two-most-recent
            // history instead of trying to diff client-side state.
            fetchDrift();
        } catch (e) {
            if (requestId !== simRequestIdRef.current) return;
            console.error(e);
            showToast("Error running simulation. Ensure FastAPI is running on port 8000.", 'error');
        } finally {
            if (requestId === simRequestIdRef.current) setIsSimulating(false);
        }
    };

    const acceptRisk = async (label: string, riskAmountRupees: number) => {
        if (!token) {
            showToast('Please log in first (top-right corner) before accepting risk.', 'error');
            return;
        }
        setAcceptingRiskFor(label);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: `Accept residual risk: ${label}`,
                    risk_accepted: riskAmountRupees,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log audit: ${data.detail || res.status}`, 'error');
                return;
            }
            showToast(`Risk accepted and logged to the audit trail.\nDecision #${data.decision_id} - Decided by: ${data.decided_by}`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error');
        } finally {
            setAcceptingRiskFor(null);
        }
    };

    // Logs the AI-optimized patch plan as a single board-approved audit
    // decision (in addition to accepting/rejecting individual risks above) -
    // ports Siddharth's "Approve & Log" idea onto the real auth/toast
    // plumbing instead of a hardcoded re-login on every click.
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
            showToast(`Optimization plan approved and logged. Decision #${data.decision_id}.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error');
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
            
            // Add a placeholder for assistant response
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

    return (
        <>
            <main className="flex-1 p-container-padding bg-background overflow-y-auto">
<div className="mb-stack-lg flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
<div>
<h1 className="font-headline-md text-headline-md text-primary mb-1">Portfolio Risk Overview</h1>
<p className="font-body-md text-body-md text-on-surface-variant">Real-time quantification of cyber exposure vs. security investment.</p>
</div>
<div className="flex flex-wrap items-center gap-2">
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1 whitespace-nowrap">
  <span className="material-symbols-outlined text-[14px] text-[#15803d]">check_circle</span> SIEM & CSPM Sync
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1 whitespace-nowrap">
  <span className="material-symbols-outlined text-[14px] text-primary">policy</span> NIST CSF | RBI | SEBI
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant whitespace-nowrap hidden sm:inline-flex">FY 2024</span>
<button onClick={() => router.push('/reports')} className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 whitespace-nowrap">
<span className="material-symbols-outlined text-[18px]">download</span> Export Report
                     </button>
</div>
</div>
{driftInsight && (
    <div className={`mb-stack-lg rounded-xl border p-stack-md flex items-start gap-3 animate-fade-scale-in ${
        driftInsight.tone === 'up' ? 'bg-error/5 border-error/30' : driftInsight.tone === 'down' ? 'bg-[#15803d]/5 border-[#15803d]/30' : 'bg-surface-container border-outline-variant'
    }`}>
    <span className={`material-symbols-outlined text-[20px] mt-0.5 shrink-0 ${
        driftInsight.tone === 'up' ? 'text-error' : driftInsight.tone === 'down' ? 'text-[#15803d]' : 'text-on-surface-variant'
    }`}>
        {driftInsight.tone === 'up' ? 'trending_up' : driftInsight.tone === 'down' ? 'trending_down' : 'trending_flat'}
    </span>
    <div className="flex-1 min-w-0">
        {driftInsight.lines.map((line, i) => (
            <p key={i} className={`font-body-sm text-body-sm ${i === 0 ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}`}>{line}</p>
        ))}
    </div>
    <a href="/reports" className="font-label-caps text-label-caps text-primary hover:underline whitespace-nowrap flex items-center gap-1 shrink-0">
        Full ledger <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
    </a>
    </div>
)}
{/*  Bento Grid Layout  */}
<div className="grid grid-cols-12 gap-gutter mb-stack-lg">
{/*  Centerpiece: ALE  */}
<div className="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col justify-between elevate">
<div>
<div className="flex justify-between items-start mb-stack-sm">
<h3 className="font-title-lg text-title-lg text-primary">Annualized Loss Expectancy</h3>
<button className="text-on-surface-variant hover:text-primary"><span className="material-symbols-outlined text-[20px]">info</span></button>
</div>
<p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Projected financial impact based on current control posture.</p>
</div>
<div>
<div key={simResults ? 'loaded-ale' : 'default-ale'} className="flex items-baseline gap-2 animate-fade-scale-in">
{simResults && simResults.monte_carlo ? (
    <>
    <span className="font-display-lg text-display-lg text-primary tracking-tighter">
      ₹{(simResults.monte_carlo.mean_expected_loss / 10000000).toFixed(2)}
    </span>
    <span className="font-headline-sm text-headline-sm text-on-surface-variant">Cr</span>
    </>
) : isSimulating ? (
    <div className="h-[56px] w-40 bg-surface-variant/50 rounded-lg animate-pulse" aria-label="Calculating annualized loss expectancy" />
) : (
    <span className="font-body-md text-body-md text-on-surface-variant">Run a simulation to see your ALE</span>
)}
</div>
{/*
  No historical simulation runs are stored per-org yet, so there is no
  honest baseline to compute a YoY delta against - the previous "+4.2%
  YoY" was a fixed string shown regardless of what the simulation
  actually produced. Removed rather than left fabricated; reintroduce
  once /api/simulate-risk results are tracked over time per org.
*/}
{/*
  Closed-Loop Calibration Engine: confidence band + model uncertainty
  score on the headline ALE figure, sourced from POST /api/simulate-risk's
  new confidence_band/calibration fields (backend/risk_engine.py::
  compute_calibration). Cold-start (zero logged incidents) still shows a
  band - it's derived from FAIR's own dispersion, not just calibration -
  but the copy makes clear precision improves as incidents are logged.
*/}
{simResults?.confidence_band && (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-data-mono font-body-sm text-body-sm text-on-surface-variant">
            ₹{(simResults.confidence_band.ale_low / 10000000).toFixed(2)}–{(simResults.confidence_band.ale_high / 10000000).toFixed(2)} Cr
        </span>
        <span className="font-body-sm text-body-sm text-on-surface-variant">{simResults.confidence_band.band_pct}% confidence band</span>
        {typeof simResults?.calibration?.uncertainty_score === 'number' && (
            <span className={`font-label-caps text-label-caps px-1.5 py-0.5 rounded ${
                simResults.calibration.uncertainty_score <= 35 ? 'bg-[#15803d]/10 text-[#15803d]' :
                simResults.calibration.uncertainty_score <= 65 ? 'bg-amber-500/10 text-amber-600' :
                'bg-error/10 text-error'
            }`} title={
                simResults.calibration.incident_count > 0
                    ? `Calibrated against ${simResults.calibration.incident_count} logged incident${simResults.calibration.incident_count !== 1 ? 's' : ''}`
                    : 'Cold start - no incidents logged yet, log one to sharpen this'
            }>
                Uncertainty {simResults.calibration.uncertainty_score.toFixed(0)}/100
            </span>
        )}
    </div>
)}
</div>
</div>
{/*  Scorecards  */}
<div className="col-span-12 lg:col-span-3 flex flex-col gap-gutter">
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md flex-1 flex flex-col justify-center elevate">
<h4 className="font-label-caps text-label-caps text-on-surface-variant mb-1">95% Value at Risk (VaR)</h4>
<div className="font-headline-md text-headline-md text-primary font-data-mono">
  {simResults && simResults.monte_carlo ? (
      `₹${(simResults.monte_carlo.var_95 / 10000000).toFixed(2)} Cr`
  ) : isSimulating ? (
      <span className="inline-block h-6 w-20 bg-surface-variant/50 rounded animate-pulse align-middle" />
  ) : "—"}
</div>
<div className="text-on-surface-variant font-body-sm text-body-sm mt-1">Tail risk exposure</div>
{typeof simResults?.calibration?.uncertainty_score === 'number' && (
    <div className="font-label-caps text-label-caps text-on-surface-variant mt-1">
        Model uncertainty {simResults.calibration.uncertainty_score.toFixed(0)}/100
    </div>
)}
</div>
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md flex-1 flex flex-col justify-center elevate">
<h4 className="font-label-caps text-label-caps text-on-surface-variant mb-1">Overall ROI of Spend</h4>
{(() => {
    const opt = simResults?.optimization;
    // Real ROI = (risk reduced - cost of the selected controls) / cost,
    // computed from the same optimizer output the "Optimized Cost" line
    // above already shows - not a fixed "18%" that never changed. Only
    // meaningful once a plan with nonzero cost has actually been selected.
    if (opt && opt.total_cost > 0) {
        const roiPct = ((opt.total_risk_reduced - opt.total_cost) / opt.total_cost) * 100;
        const positive = roiPct >= 0;
        return (
            <div className={`font-headline-md text-headline-md font-data-mono flex items-center ${positive ? 'text-[#15803d]' : 'text-error'}`}>
                <span className="material-symbols-outlined mr-1">{positive ? 'arrow_upward' : 'arrow_downward'}</span>
                {Math.abs(roiPct).toFixed(0)}%
            </div>
        );
    }
    if (isSimulating) {
        return <div className="h-8 w-16 bg-surface-variant/50 rounded animate-pulse" />;
    }
    return <div className="font-headline-md text-headline-md text-on-surface-variant font-data-mono">—</div>;
})()}
<div className="text-on-surface-variant font-body-sm text-body-sm mt-1">Security efficiency</div>
</div>
</div>
{/*  Loss Distribution Chart  */}
<div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col elevate">
<h3 className="font-title-lg text-title-lg text-primary mb-1">Loss Distribution</h3>
<p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Monte Carlo simulation (10,000 iterations)</p>
<div className="flex-1 w-full bg-surface-container-low rounded relative border border-outline-variant border-dashed overflow-hidden flex items-end justify-center pb-4">
{simResults && simResults.monte_carlo && simResults.monte_carlo.distribution_curve ? (
    <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={simResults.monte_carlo.distribution_curve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
                <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.45}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
            </defs>
            <XAxis dataKey="loss" hide={true} />
            <YAxis hide={true} />
            <Tooltip 
                formatter={(value: any, name: any, props: any) => [`${(props.payload.loss / 10000000).toFixed(2)} Cr`, 'Loss']}
                labelFormatter={() => ''}
            />
            <Area type="monotone" dataKey="probability" stroke="var(--primary)" strokeWidth={2} fillOpacity={1} fill="url(#colorLoss)" />
        </AreaChart>
    </ResponsiveContainer>
) : isSimulating ? (
    <div className="w-full h-32 flex flex-col items-center justify-center gap-2 text-on-surface-variant font-body-sm">
        <span className="material-symbols-outlined text-[24px] animate-spin">progress_activity</span>
        Calculating loss distribution...
    </div>
) : (
    <div className="w-full h-32 flex items-center justify-center text-on-surface-variant font-body-sm">
        Run simulation to view loss distribution
    </div>
)}
</div>
</div>
</div>
{/*  Explainable Risk Attribution  */}
<div className="grid grid-cols-12 gap-gutter mb-stack-lg">
<div className="col-span-12 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
<div className="flex justify-between items-start mb-stack-md flex-wrap gap-2">
<div>
<h3 className="font-title-lg text-title-lg text-primary">Explainable Risk Attribution</h3>
<p className="font-body-sm text-body-sm text-on-surface-variant">What actually built this run&apos;s Control Strength score - the real waterfall behind the number, not just the number.</p>
</div>
{simResults?.risk_drivers?.cs_final != null && (
<div className="text-right shrink-0">
<div className="font-headline-sm text-headline-sm text-primary font-data-mono">{simResults.risk_drivers.cs_final.toFixed(0)}<span className="text-on-surface-variant text-body-sm">/100</span></div>
<div className="font-label-caps text-label-caps text-on-surface-variant">Final Control Strength</div>
</div>
)}
</div>
{simResults && simResults.risk_drivers && Object.keys(simResults.risk_drivers).length > 0 ? (
    (() => {
        const rd = simResults.risk_drivers;
        const steps: { label: string; sub: string; value: number; kind: 'base' | 'deduct' | 'boost' }[] = [
            { label: 'Upstream Control Strength', sub: 'Blast-radius-adjusted, from live vulnerability telemetry', value: rd.cs_upstream, kind: 'base' },
            { label: 'Live telemetry deductions', sub: 'MFA / IAM / patch / EDR / exposure / CSPM signals', value: -rd.telemetry_deduction, kind: 'deduct' },
            { label: 'Confirmed Ingestion Engine gaps', sub: rd.confirmed_gap_count > 0 ? `${rd.confirmed_gap_count} confirmed config gap(s) - see Ingestion Engine` : 'No confirmed gaps', value: -rd.gap_deduction, kind: 'deduct' },
            { label: 'Training coverage boost', sub: `${rd.trained_module_count}/${rd.total_module_count} modules completed org-wide`, value: rd.training_boost, kind: 'boost' },
        ];
        const scale = Math.max(100, rd.cs_upstream, 1);
        return (
            <div className="space-y-3">
                {steps.map((s) => (
                    <div key={s.label}>
                        <div className="flex justify-between items-baseline mb-1 gap-2">
                            <div className="min-w-0">
                                <span className="font-body-sm text-body-sm font-medium">{s.label}</span>
                                <span className="block font-label-caps text-label-caps text-on-surface-variant">{s.sub}</span>
                            </div>
                            <span className={`font-data-mono text-data-mono font-bold shrink-0 ${s.value > 0 ? 'text-[#15803d]' : s.value < 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                                {s.value > 0 ? '+' : ''}{s.value.toFixed(1)}
                            </span>
                        </div>
                        <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                            <div
                                className={`h-2 rounded ${s.kind === 'base' ? 'bg-primary-container' : s.kind === 'boost' ? 'bg-[#15803d]' : 'bg-error'}`}
                                style={{ width: `${Math.min(100, (Math.abs(s.value) / scale) * 100)}%` }}
                            />
                        </div>
                    </div>
                ))}
                <hr className="border-outline-variant border-dashed" />
                <div className="flex justify-between items-center gap-2">
                    <div>
                        <span className="font-body-sm text-body-sm font-semibold">Final Control Strength (this run)</span>
                        {rd.cs_was_clamped && (
                            <span className="block font-label-caps text-label-caps text-on-surface-variant">Clamped to the 5-100 scale (raw sum: {rd.cs_unclamped.toFixed(1)})</span>
                        )}
                    </div>
                    <span className="font-headline-sm text-headline-sm text-primary font-data-mono shrink-0">{rd.cs_final.toFixed(1)}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                        Threat Event Frequency this run: {rd.tef_final.toFixed(1)}/yr
                    </span>
                    {rd.tef_kev_program_active && (
                        <span className="font-label-caps text-label-caps text-[#15803d] px-2 py-1 bg-[#15803d]/10 rounded border border-[#15803d]/30">KEV patch program halves exploited-CVE exposure</span>
                    )}
                    {rd.tef_soc_monitoring_active && (
                        <span className="font-label-caps text-label-caps text-[#15803d] px-2 py-1 bg-[#15803d]/10 rounded border border-[#15803d]/30">24/7 SOC halves CRITICAL-alert exposure</span>
                    )}
                </div>
            </div>
        );
    })()
) : isSimulating ? (
    <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-9 w-full bg-surface-variant/50 rounded animate-pulse" />)}
    </div>
) : (
    <div className="w-full py-6 flex items-center justify-center text-on-surface-variant font-body-sm text-center">
        Run a simulation to see what&apos;s actually driving your Control Strength score
    </div>
)}
</div>
</div>
{/*  Bottom Row: Sandbox & Breakdown  */}
<div className="grid grid-cols-12 gap-gutter">
{/*  What-If Sandbox  */}
<div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
<div className="flex justify-between items-center mb-stack-lg">
<h3 className="font-title-lg text-title-lg text-primary">Simulation Sandbox</h3>
<span className="bg-secondary-container text-on-secondary-container px-2 py-1 rounded font-label-caps text-label-caps">Draft Mode</span>
</div>
<div className="space-y-stack-lg">
{/*  Budget Slider  */}
<div>
<div className="flex justify-between mb-2">
<label htmlFor="sandbox-budget" className="font-body-sm text-body-sm font-semibold">Security Budget Allocation</label>
<span className="font-data-mono text-data-mono font-bold" aria-hidden="true">{budget >= 100 ? `₹${(budget/100).toFixed(2)} Cr` : `₹${((budget/100)*100).toFixed(0)}L`}</span>
</div>
<input
    id="sandbox-budget"
    className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary"
    max="100" min="0" type="range" value={budget} onChange={handleBudgetChange}
    aria-label="Security budget allocation"
    aria-valuetext={budget >= 100 ? `${(budget/100).toFixed(2)} crore rupees` : `${((budget/100)*100).toFixed(0)} lakh rupees`}
/>
<div className="flex justify-between mt-1 text-on-surface-variant font-label-caps text-label-caps">
<span className="">₹0</span>
<span className="">₹1 Cr+</span>
</div>
</div>
<hr className="border-outline-variant border-dashed" />
{/*  Strategic Controls  */}
<div>
<div className="flex justify-between items-center mb-stack-md">
  <h4 className="font-body-sm text-body-sm font-semibold">Strategic Controls</h4>
  {simResults?.optimization?.total_cost ? (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="font-label-caps text-label-caps text-on-surface-variant">
        Optimized Cost: ₹{(Number(simResults.optimization.total_cost) / 100000).toFixed(1)}L
      </span>
      <button
        onClick={applyRecommended}
        title="Toggle every Strategic Control to match the recommended mix above - your current toggles are left alone until you click this"
        className="px-3 py-1 border border-outline-variant text-on-surface-variant rounded font-label-caps text-label-caps font-semibold hover:bg-surface-container-low transition-colors active:scale-95 flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[14px]">auto_awesome</span>Use Recommended Mix
      </button>
      <button
        onClick={approveOptimizer}
        disabled={isApproving}
        className="px-3 py-1 bg-[#15803d] text-white rounded font-label-caps text-label-caps font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors active:scale-95"
      >
        {isApproving ? 'Logging...' : 'Approve & Log'}
      </button>
    </div>
  ) : null}
</div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
{STRATEGIC_CONTROLS.map((c) => (
<div key={c.name} className="flex items-center justify-between p-3 border border-outline-variant rounded bg-surface hover:bg-surface-container-low transition-colors">
<div className="flex flex-col">
<div className="flex items-center gap-2">
<span className="font-body-sm text-body-sm font-medium">{c.name}</span>
{optimizerPicks && optimizerPicks.includes(c.name) && (
    <span className="px-1.5 py-0.5 bg-[#15803d]/10 text-[#15803d] rounded font-label-caps text-label-caps flex items-center gap-0.5">
        <span className="material-symbols-outlined text-[12px]">auto_awesome</span>Recommended
    </span>
)}
</div>
<span className="font-label-caps text-label-caps text-on-surface-variant mt-1">{c.costLabel}</span>
</div>
<label className="relative inline-flex items-center cursor-pointer">
<input checked={!!controls[c.name]} onChange={() => toggleControl(c.name)} className="sr-only peer" type="checkbox" value="" />
<div className="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-sm after:h-4 after:w-4 after:transition-all after:duration-200 peer-checked:bg-primary"></div>
</label>
</div>
))}
</div>
</div>
<button onClick={runSimulation} disabled={isSimulating} className="w-full bg-primary text-on-primary font-body-sm text-body-sm py-3 rounded font-semibold hover:bg-opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                            {isSimulating && <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
                            {isSimulating ? 'Running Simulation...' : 'Run Simulation'}
                        </button>
</div>
</div>
{/*  Strategic Breakdown  */}
<div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
<h3 className="font-title-lg text-title-lg text-primary mb-stack-lg">Risk by Business Unit</h3>
<div className="space-y-4">
{simResults && simResults.business_unit_breakdown && simResults.business_unit_breakdown.length > 0 ? (
    (() => {
        const barColors = ['bg-error', 'bg-[#ca8a04]', 'bg-[#eab308]', 'bg-primary-container', 'bg-[#0891b2]', 'bg-[#7c3aed]'];
        const maxShare = Math.max(...simResults.business_unit_breakdown.map((u: any) => u.share_pct), 1);
        return simResults.business_unit_breakdown.map((unit: any, idx: number) => {
            const riskRupees = unit.allocated_ale;
            return (
                <div key={unit.business_unit}>
                <div className="flex justify-between items-end mb-1">
                <span className="font-body-sm text-body-sm font-medium">{unit.business_unit}</span>
                <span className="font-data-mono text-data-mono font-bold">
                  ₹{(riskRupees / 10000000).toFixed(2)} Cr/yr
                </span>
                <button
                    onClick={() => acceptRisk(unit.business_unit, riskRupees)}
                    disabled={acceptingRiskFor === unit.business_unit}
                    className="ml-2 px-2 py-0.5 border border-outline-variant text-on-surface-variant hover:border-error hover:text-error rounded text-label-caps font-label-caps transition-colors active:scale-95 disabled:opacity-60"
                >
                    {acceptingRiskFor === unit.business_unit ? 'Logging...' : 'Accept Risk'}
                </button>
                </div>
                <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                <div className={`${barColors[idx % barColors.length]} h-2 rounded`} style={{width: `${Math.max(4, (unit.share_pct / maxShare) * 100)}%`}}></div>
                </div>
                </div>
            );
        });
    })()
) : isSimulating ? (
    <div className="flex flex-col gap-3">
        {[100, 75, 55].map((w, i) => (
            <div key={i} className="flex flex-col gap-1">
                <div className="h-3 w-24 bg-surface-variant/50 rounded animate-pulse" />
                <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                    <div className="h-2 rounded bg-surface-variant/50 animate-pulse" style={{ width: `${w}%` }} />
                </div>
            </div>
        ))}
    </div>
) : (
    <div className="w-full py-6 flex items-center justify-center text-on-surface-variant font-body-sm text-center">
        Run a simulation to allocate ALE across business units
    </div>
)}
</div>
<a href="/ledger" className="mt-stack-lg text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1 hover:underline w-fit">
                        View Detailed Ledger <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
</a>
</div>
</div>
</main>
{/* AI Chat Panel */}
{isChatOpen && (
    <div className="fixed bottom-24 right-8 w-96 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl flex flex-col overflow-hidden z-50 animate-fade-scale-in">
        <div className="bg-primary text-on-primary p-4 flex justify-between items-center">
            <h3 className="font-title-md font-bold">Virtual CISO</h3>
            <button onClick={() => setIsChatOpen(false)} className="hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
            </button>
        </div>
        <div className="h-80 overflow-y-auto p-4 bg-surface flex flex-col gap-2 custom-scrollbar">
            {chatMessages.length === 0 && (
                <div className="text-on-surface-variant text-body-sm text-center mt-4">
                    Ask me about the risk simulation or compliance frameworks...
                </div>
            )}
            {chatMessages.map((msg, idx) => {
                // Compliance answers end with a "Sources: RBI, SEBI" line (see
                // ai-agent/rag.py) - split it out and render as chips instead of
                // plain trailing text, so the citation actually stands out as a
                // trust signal rather than blending into the paragraph.
                const sourceMatch = msg.content.match(/\n*Sources?:\s*([A-Za-z0-9,\/ ]+)\s*$/i);
                const mainText = sourceMatch ? msg.content.slice(0, sourceMatch.index) : msg.content;
                const sourceTags = sourceMatch
                    ? sourceMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
                    : [];

                return (
                    <div key={idx} className={`p-3 rounded-lg max-w-[85%] animate-fade-scale-in ${msg.role === 'user' ? 'bg-primary-container text-on-primary-container self-end' : 'bg-surface-variant text-on-surface-variant self-start'}`}>
                        {msg.role === 'assistant' && !msg.content && isChatSending ? (
                            <div className="flex gap-1 py-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                        ) : (
                            <>
                                <p className="text-body-sm whitespace-pre-wrap">{mainText}</p>
                                {sourceTags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-outline-variant/50">
                                        <span className="material-symbols-outlined text-[14px] text-on-surface-variant mt-0.5">verified</span>
                                        {sourceTags.map((tag, i) => (
                                            <span key={i} className="px-2 py-0.5 bg-primary-container text-on-primary-container rounded font-label-caps text-label-caps">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
        </div>
        <div className="p-3 border-t border-outline-variant bg-surface-container-low flex gap-2">
            <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type your message..." 
                className="flex-1 bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
            />
            <button onClick={sendMessage} disabled={isChatSending} className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90 active:scale-90 transition-transform disabled:opacity-60">
                <span className="material-symbols-outlined">{isChatSending ? 'hourglass_top' : 'send'}</span>
            </button>
        </div>
    </div>
)}

<button 
    onClick={() => setIsChatOpen(!isChatOpen)}
    className="fixed bottom-stack-lg right-stack-lg w-[60px] h-[60px] rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-lg z-50 hover:bg-opacity-90 hover:scale-105 transition-all active:scale-95" 
    aria-label="AI Assistant"
>
    <span className={`material-symbols-outlined text-[28px] fill-icon transition-transform duration-300 ${isChatOpen ? 'rotate-90' : 'rotate-0'}`}>
        {isChatOpen ? 'close' : 'auto_awesome'}
    </span>
</button>
        </>
    );
}

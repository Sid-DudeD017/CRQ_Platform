"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import { formatRupeesCr } from '@/lib/format';
import CountUp from '@/components/CountUp';
import RiskSandbox, { STRATEGIC_CONTROLS } from '@/components/RiskSandbox';

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
    const aleCr = formatRupeesCr;
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
    const { token, username } = useAuth();
    const { showToast } = useToast();
    const [budget, setBudget] = useState(65);
    const [simResults, setSimResults] = useState<any>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    // [P0-STALE-006 - failed refresh] A failed Run Simulation used to
    // leave the previous (still-accurate-for-its-own-scenario) results on
    // screen with nothing but a toast that vanishes in a few seconds - so
    // anyone who glanced at the dashboard moments later saw what looked
    // like a perfectly normal, current result with no sign that the most
    // recent attempt to refresh it had actually failed. This tracks that
    // persistently so the sandbox can say so until the next attempt.
    const [lastRunFailed, setLastRunFailed] = useState(false);
    const [controls, setControls] = useState<Record<string, boolean>>(
        Object.fromEntries(STRATEGIC_CONTROLS.map((c) => [c.name, c.name === 'Enforce Cloud MFA']))
    );
    const [optimizerPicks, setOptimizerPicks] = useState<string[] | null>(null);
    // Which account mode this run belongs to - needed so a saved report
    // gets written under the right crq_sim_state:<user>:<mode> key (see
    // the mount effect below and "report being saved" in runSimulation).
    const [mode, setMode] = useState<'predefined' | 'own'>('predefined');
    const simRequestIdRef = useRef(0);
    // [Deploy-level polish] Bumped on every simulation that actually
    // returns new results (see runSimulation below) and used as the
    // RiskSandbox `key` where it's rendered - forcing a clean remount so
    // the result panels' entrance animation (animate-result-reveal) plays
    // again on every run, not just the very first time data shows up.
    const [resultVersion, setResultVersion] = useState(0);
    // Scroll target for the sandbox results - smooth-scrolled into view
    // after a manual "Run Simulation" click so the freshly regenerated
    // graph is immediately visible instead of requiring a manual scroll.
    const resultsRef = useRef<HTMLDivElement>(null);

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
            const res = await fetchWithRetry(`${API_BASE}/api/simulations?limit=2&data_source=predefined`);
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
    // [Get Started checklist] Three real, verifiable signals - not a fake
    // progress bar - so it only ever shows steps that actually happened in
    // this browser: real telemetry generated, a real simulation returned,
    // a real audit-logged decision. Persisted so it doesn't re-nag on every
    // reload once someone's actually done the pipeline once.
    const [dataGenerated, setDataGenerated] = useState(false);
    const [riskLogged, setRiskLogged] = useState(false);
    const [isGeneratingData, setIsGeneratingData] = useState(false);
    const [checklistDismissed, setChecklistDismissed] = useState(false);
    useEffect(() => {
        try {
            setDataGenerated(localStorage.getItem('crq_step_data_generated') === '1');
            setRiskLogged(localStorage.getItem('crq_step_risk_logged') === '1');
            setChecklistDismissed(localStorage.getItem('crq_checklist_dismissed') === '1');
        } catch (e) {
            // localStorage unavailable - checklist just starts fresh each load
        }
    }, []);
    const generateDemoData = async () => {
        if (!token) {
            showToast('Please log in first (top-right corner) before generating demo data.', 'error');
            return;
        }
        setIsGeneratingData(true);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/generate-mock-data`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not generate demo data: ${data.detail || res.status}`, 'error');
                return;
            }
            setDataGenerated(true);
            try { localStorage.setItem('crq_step_data_generated', '1'); } catch (e) {}
            showToast(data.message || 'Demo telemetry generated.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running?', 'error');
        } finally {
            setIsGeneratingData(false);
        }
    };
    const dismissChecklist = () => {
        setChecklistDismissed(true);
        try { localStorage.setItem('crq_checklist_dismissed', '1'); } catch (e) {}
    };
    const [acceptingRiskFor, setAcceptingRiskFor] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState(false);

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBudget(Number(e.target.value));
    };

    // `silent` powers the auto-bootstrap effect below (dashboard shows a
    // live run the moment it opens, instead of an empty "Run a
    // simulation..." state) - same pipeline as a manual click, just a
    // softer toast and, crucially, a one-time auto-seed-and-retry if
    // there's no telemetry yet at all.
    const runSimulation = async (opts?: { silent?: boolean; allowSeed?: boolean }) => {
        const requestId = ++simRequestIdRef.current;
        // [Deploy-level polish] A silent auto-bootstrap run shouldn't make
        // anyone wait, but a manual click should feel like real work
        // happened rather than an instant, jarring swap - see the minimum
        // elapsed-time check in the `finally` block below.
        const startedAt = Date.now();
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
            let res = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue, active_controls: controls, data_source: 'predefined' })
            });
            let data = await res.json();
            // First time anyone opens the dashboard there's no telemetry
            // to simulate against yet - rather than surface that as a
            // failure, seed the same demo data the Get Started card
            // offers and retry once, so a brand-new account (or one that
            // hasn't generated data yet) still gets a live run instead of
            // an error. Only kicks in on this specific backend error, and
            // only if logged in (seeding requires a token).
            if (!res.ok && token && opts?.allowSeed !== false && /no assets found/i.test(data.detail || '')) {
                const seedRes = await fetchWithRetry(`${API_BASE}/api/generate-mock-data`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (requestId !== simRequestIdRef.current) return;
                if (seedRes.ok) {
                    setDataGenerated(true);
                    try { localStorage.setItem('crq_step_data_generated', '1'); } catch (e) {}
                    res = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ budget: budgetValue, active_controls: controls, data_source: 'predefined' })
                    });
                    data = await res.json();
                }
            }
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
                // no visible explanation of what went wrong. The silent
                // auto-bootstrap swallows this instead - the manual Run
                // Simulation button (and its own error toast) is still
                // right there below.
                if (!opts?.silent) showToast(`Simulation failed: ${data.detail || res.status}`, 'error', { dataSaved: 'no', retrySafe: true });
                setLastRunFailed(true);
                return;
            }
            setSimResults(data);
            setLastRunFailed(false);
            if (!dataGenerated) {
                setDataGenerated(true);
                try { localStorage.setItem('crq_step_data_generated', '1'); } catch (e) {}
            }
            const picks: string[] = data.optimization.selected_patches || [];
            setOptimizerPicks(picks);
            // [Report saved each time] So switching to Own Data or Training
            // via "Switch Dashboard" and coming back to the demo doesn't
            // lose this run - restored by the mount effect below.
            try {
                if (username) {
                    localStorage.setItem(`crq_sim_state:${username}:${mode}`, JSON.stringify({ budget, controls, simResults: data, optimizerPicks: picks }));
                }
            } catch (e) {}
            // [Deploy-level polish] Force the sandbox to remount so its
            // result panels fade/slide in fresh on every run, and - for a
            // manual click only, not the silent auto-bootstrap - smooth-
            // scroll the freshly regenerated results into view.
            setResultVersion((v) => v + 1);
            if (!opts?.silent) {
                requestAnimationFrame(() => {
                    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
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
            if (opts?.silent) {
                showToast('Dashboard is live - ran a simulation automatically on demo data. Adjust the budget and Strategic Controls below to see risk move.', 'info');
            } else {
                showToast(`Simulation complete - ${picks.length} of ${STRATEGIC_CONTROLS.length} controls recommended within this budget.`, 'success');
            }
            console.log("Sim Results:", data);
            // This run was just persisted server-side (see /api/simulate-risk),
            // so refresh the drift callout against the real two-most-recent
            // history instead of trying to diff client-side state.
            fetchDrift();
        } catch (e) {
            if (requestId !== simRequestIdRef.current) return;
            console.error(e);
            if (!opts?.silent) showToast("Error running simulation. Ensure FastAPI is running on port 8000.", 'error', { dataSaved: 'no', retrySafe: true });
            setLastRunFailed(true);
        } finally {
            if (requestId === simRequestIdRef.current) {
                // [Deploy-level polish] A manual run that resolves in
                // 40ms reads as broken, not fast - hold the loading state
                // open to a 0.5s floor so the skeletons/spinners are
                // actually visible before the real numbers replace them.
                // Skipped for silent auto-bootstrap runs, which should
                // stay invisible-fast.
                if (!opts?.silent) {
                    const elapsed = Date.now() - startedAt;
                    const minDelayMs = 500;
                    if (elapsed < minDelayMs) {
                        await new Promise((resolve) => setTimeout(resolve, minDelayMs - elapsed));
                    }
                }
                setIsSimulating(false);
            }
        }
    };

    // The demo-vs-own-data choice now happens on a dedicated page
    // (SharedLayout's data-source gate) before Overview ever mounts, so
    // crq_data_source is guaranteed to already be 'predefined' or 'own'
    // by the time this effect runs here - 'predefined' is only a
    // defensive fallback in case that gate was ever somehow bypassed.
    useEffect(() => {
        if (!username) return; // wait for AuthContext to hydrate the real account name
        let source: string | null = null;
        try { source = localStorage.getItem(`crq_data_source:${username}`); } catch (e) {}
        const resolvedMode: 'predefined' | 'own' = source === 'own' ? 'own' : 'predefined';
        setMode(resolvedMode);
        // [Report saved each time] Restore the last saved run for this
        // account+mode instead of starting blank every time this page is
        // revisited (e.g. after using "Switch Dashboard" to look at
        // Training and coming back) - only auto-run a fresh simulation
        // when nothing has been saved here yet.
        let cached: any = null;
        try {
            const raw = localStorage.getItem(`crq_sim_state:${username}:${resolvedMode}`);
            if (raw) cached = JSON.parse(raw);
        } catch (e) {}
        if (cached) {
            if (typeof cached.budget === 'number') setBudget(cached.budget);
            if (cached.controls) setControls(cached.controls);
            if (cached.simResults) setSimResults(cached.simResults);
            if (cached.optimizerPicks) setOptimizerPicks(cached.optimizerPicks);
            return;
        }
        if (resolvedMode === 'own') {
            runSimulation({ silent: true, allowSeed: false });
        } else {
            runSimulation({ silent: true, allowSeed: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [username]);

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
                    data_source: 'predefined',
                    // [Risk Decision Passport] the same real numbers already
                    // on screen right now - see backend/main.py::log_audit,
                    // which computes the evidence hash/unfunded-control
                    // comparison from active_controls/budget server-side.
                    residual_ale: simResults?.monte_carlo?.mean_expected_loss ?? null,
                    p95: simResults?.monte_carlo?.var_95 ?? null,
                    accepted_scenario: simResults?.scenario_breakdown?.scenarios?.[0]?.scenario ?? null,
                    // [Risk Decision Passport integrity fix] These used to
                    // read live `controls`/`budget` state - if you nudged a
                    // toggle or the slider after Run Simulation but before
                    // clicking Accept Risk (without re-running), the
                    // logged "what was accepted" config wouldn't match the
                    // residual_ale/p95 actually being accepted above. Now
                    // sourced from the same completed run those numbers
                    // came from, same as approveOptimizer already does.
                    active_controls: simResults?.active_controls_used ?? controls,
                    budget: simResults?.budget_used ?? (budget / 100) * 10000000,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log audit: ${data.detail || res.status}`, 'error', { dataSaved: 'no', retrySafe: true });
                return;
            }
            setRiskLogged(true);
            try { localStorage.setItem('crq_step_risk_logged', '1'); } catch (e) {}
            showToast(`Risk accepted and logged to the audit trail.\nDecision #${data.decision_id} - Decided by: ${data.decided_by}`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
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
                    data_source: 'predefined',
                    residual_ale: simResults?.monte_carlo?.mean_expected_loss ?? null,
                    p95: simResults?.monte_carlo?.var_95 ?? null,
                    accepted_scenario: simResults?.scenario_breakdown?.scenarios?.[0]?.scenario ?? null,
                    // The plan actually being approved here is the
                    // optimizer's own recommendation, not whatever the
                    // sandbox sliders currently show - so the passport's
                    // "recommended control not funded" comparison is
                    // against what THIS approval actually funds.
                    active_controls: Object.fromEntries(
                        (simResults.optimization.selected_patches || []).map((id: string) => [id, true])
                    ),
                    budget: simResults.optimization.total_cost || (budget / 100) * 10000000,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log approval: ${data.detail || res.status}`, 'error', { dataSaved: 'no', retrySafe: true });
                return;
            }
            setRiskLogged(true);
            try { localStorage.setItem('crq_step_risk_logged', '1'); } catch (e) {}
            showToast(`Optimization plan approved and logged. Decision #${data.decision_id}.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
        } finally {
            setIsApproving(false);
        }
    };

    return (
        <>
            <main className="flex-1 p-container-padding bg-background overflow-y-auto">
<div className="relative">
<div className="ambient-glow" aria-hidden="true" />
<div className="relative z-10">
<div className="mb-stack-lg flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
<div>
<h1 className="font-headline-md text-headline-md landing-font landing-heading-gradient mb-1">Portfolio Risk Overview</h1>
<p className="font-body-md text-body-md text-on-surface-variant">Real-time quantification of cyber exposure vs. security investment.</p>
</div>
<div className="flex flex-wrap items-center gap-2">
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1 whitespace-nowrap">
  <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-[#15803d]">check_circle</span> SIEM & CSPM Sync
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1 whitespace-nowrap">
  <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-primary">policy</span> ISO 27001 | RBI | SEBI
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant whitespace-nowrap hidden sm:inline-flex">FY 2026</span>
<button onClick={() => router.push('/reports')} className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 whitespace-nowrap">
<span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span> Export Report
                     </button>
</div>
</div>
{driftInsight && (
    <div className={`mb-stack-lg rounded-xl border p-stack-md flex items-start gap-3 animate-fade-scale-in ${
        driftInsight.tone === 'up' ? 'bg-error/5 border-error/30' : driftInsight.tone === 'down' ? 'bg-[#15803d]/5 border-[#15803d]/30' : 'bg-surface-container border-outline-variant'
    }`}>
    <span aria-hidden="true" className={`material-symbols-outlined text-[20px] mt-0.5 shrink-0 ${
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
        Full ledger <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_forward</span>
    </a>
    </div>
)}
{!checklistDismissed && !(dataGenerated && !!simResults && riskLogged) && (
    <div className="mb-stack-lg rounded-xl border border-outline-variant bg-surface-container-lowest p-gutter elevate animate-fade-scale-in">
        <div className="flex items-start justify-between gap-3 mb-stack-md">
            <div>
                <h3 className="font-title-lg text-title-lg text-primary">Get Started</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Three steps to see the full risk pipeline in action.</p>
            </div>
            <button onClick={dismissChecklist} className="text-on-surface-variant hover:text-primary shrink-0" aria-label="Dismiss checklist">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-stack-md">
            <div className={`rounded-lg border p-stack-md flex flex-col gap-2 ${dataGenerated ? 'border-[#15803d]/40 bg-[#15803d]/5' : 'border-outline-variant'}`}>
                <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${dataGenerated ? 'text-[#15803d]' : 'text-on-surface-variant'}`}>
                        {dataGenerated ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className="font-body-sm text-body-sm font-semibold">1. Generate demo telemetry</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Seeds assets, telemetry &amp; network topology so there&apos;s real data to simulate against.</p>
                {!dataGenerated && (
                    <button onClick={generateDemoData} disabled={isGeneratingData} className="mt-auto self-start px-3 py-1.5 bg-primary text-on-primary rounded font-label-caps text-label-caps font-semibold hover:bg-opacity-90 active:scale-95 transition-all disabled:opacity-60">
                        {isGeneratingData ? 'Generating...' : 'Generate Data'}
                    </button>
                )}
            </div>
            <div className={`rounded-lg border p-stack-md flex flex-col gap-2 ${simResults ? 'border-[#15803d]/40 bg-[#15803d]/5' : 'border-outline-variant'}`}>
                <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${simResults ? 'text-[#15803d]' : 'text-on-surface-variant'}`}>
                        {simResults ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className="font-body-sm text-body-sm font-semibold">2. Run a simulation</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Drag the budget slider in the Simulation Sandbox below, then click Run Simulation.</p>
            </div>
            <div className={`rounded-lg border p-stack-md flex flex-col gap-2 ${riskLogged ? 'border-[#15803d]/40 bg-[#15803d]/5' : 'border-outline-variant'}`}>
                <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${riskLogged ? 'text-[#15803d]' : 'text-on-surface-variant'}`}>
                        {riskLogged ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className="font-body-sm text-body-sm font-semibold">3. Log a risk decision</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Click Accept Risk or Approve &amp; Log below to write it to the audit trail.</p>
            </div>
        </div>
    </div>
)}
</div>
</div>
<div ref={resultsRef}>
<RiskSandbox
    runVersion={resultVersion}
    simResults={simResults}
    isSimulating={isSimulating}
    lastRunFailed={lastRunFailed}
    budget={budget}
    handleBudgetChange={handleBudgetChange}
    controls={controls}
    toggleControl={toggleControl}
    optimizerPicks={optimizerPicks}
    applyRecommended={applyRecommended}
    approveOptimizer={approveOptimizer}
    isApproving={isApproving}
    runSimulation={runSimulation}
    acceptRisk={acceptRisk}
    acceptingRiskFor={acceptingRiskFor}
/>
</div>
</main>
        </>
    );
}

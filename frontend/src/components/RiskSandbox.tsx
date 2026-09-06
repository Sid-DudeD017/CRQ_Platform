"use client";
import React, { useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import CountUp from './CountUp';

// Every entry here must exactly match a SECURITY_CONTROLS id in
// backend/risk_engine.py (id, cost) - that's what makes each toggle a
// real, formula-calibrated control instead of a cosmetic switch. Costs
// mirror backend/risk_engine.py's SECURITY_CONTROLS exactly (paise-accurate
// vs. the display label), so the optimizer's "Optimized Cost" and this
// list never disagree about what a control costs.
//
// Shared by both dashboards - the demo Overview (/) and the own-data
// dashboard (/ingestion) - via RiskSandbox below, so a control added here
// shows up, and costs the same, in either place.
export const STRATEGIC_CONTROLS: { name: string; costLabel: string }[] = [
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

export interface RiskSandboxProps {
    simResults: any;
    isSimulating: boolean;
    budget: number;
    handleBudgetChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    controls: Record<string, boolean>;
    toggleControl: (name: string) => void;
    optimizerPicks: string[] | null;
    applyRecommended: () => void;
    approveOptimizer: () => void;
    isApproving: boolean;
    runSimulation: (opts?: any) => void;
    acceptRisk: (label: string, riskAmountRupees: number) => void;
    acceptingRiskFor: string | null;
    // [Deploy-level polish] Bumped by the parent every time a simulation
    // returns fresh results - used only to re-trigger the entrance
    // animation below in place (see the effect in the component body),
    // never as a React `key`, so the Loss Distribution chart doesn't get
    // torn down and rebuilt (and flash) on every run.
    runVersion: number;
    // 'whatIf' (used by the own-data Ingestion dashboard) collapses the
    // budget/Strategic Controls card behind a disclosure, since in that
    // mode the results above are already driven by what you confirmed or
    // ignored in the Ingestion Engine - this panel becomes an optional
    // "model extra spend on top of that" tool instead of a required step.
    // 'interactive' (the demo Overview default) always shows it open.
    sandboxMode?: 'interactive' | 'whatIf';
}

// The full "run a simulation, tune Strategic Controls, watch ALE/VaR/Loss
// Distribution move, accept or approve the resulting risk" experience -
// pulled out of the demo Overview page so the own-data dashboard
// (Ingestion, once real data is entered) can offer the exact same, fully
// working sandbox instead of a stripped-down read-only preview. Every
// prop name matches the local variable it used to be on Overview, so the
// JSX below is byte-for-byte what Overview always rendered.
export default function RiskSandbox({
    simResults,
    isSimulating,
    budget,
    handleBudgetChange,
    controls,
    toggleControl,
    optimizerPicks,
    applyRecommended,
    approveOptimizer,
    isApproving,
    runSimulation,
    acceptRisk,
    acceptingRiskFor,
    runVersion,
    sandboxMode = 'interactive',
}: RiskSandboxProps) {
    // [Deploy-level polish] Replay the "pop up nicely" entrance animation
    // on every completed run without unmounting anything. A React `key`
    // remount used to do this but also tore down and rebuilt the Loss
    // Distribution chart (Recharts needs a tick to measure its container on
    // mount), which is what made a run look like the whole page flashing/
    // refreshing. Toggling the CSS class off and back on - forcing a
    // reflow in between so the browser treats it as a fresh animation
    // start, not a no-op - restarts it in place instead.
    const heroSectionRef = useRef<HTMLDivElement>(null);
    const attributionSectionRef = useRef<HTMLDivElement>(null);
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        [heroSectionRef.current, attributionSectionRef.current, bottomSectionRef.current].forEach((el) => {
            if (!el) return;
            el.classList.remove('animate-result-reveal');
            void el.offsetWidth;
            el.classList.add('animate-result-reveal');
        });
    }, [runVersion]);

    // Extracted so the exact same budget/Strategic Controls/Run Simulation
    // markup can render either always-open (interactive) or behind a
    // <details> disclosure (whatIf) without duplicating it.
    const sandboxControls = (
        <>
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
        <button onClick={() => runSimulation()} disabled={isSimulating} className="w-full landing-cta-gradient font-body-sm text-body-sm py-3 rounded font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {isSimulating && <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
            {isSimulating ? 'Running Simulation...' : 'Run Simulation'}
        </button>
        </>
    );

    return (
        <>
{/*  Bento Grid Layout  */}
<div ref={heroSectionRef} className="grid grid-cols-12 gap-gutter mb-stack-lg animate-result-reveal">
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
      ₹<CountUp value={simResults.monte_carlo.mean_expected_loss / 10000000} formatter={(v) => v.toFixed(2)} />
    </span>
    <span className="font-headline-sm text-headline-sm text-on-surface-variant">Cr</span>
    </>
) : isSimulating ? (
    <div className="h-[56px] w-40 bg-surface-variant/50 rounded-lg animate-pulse" aria-label="Calculating annualized loss expectancy" />
) : (
    <span className="font-body-md text-body-md text-on-surface-variant">Run a simulation to see your ALE</span>
)}
</div>
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
      <>₹<CountUp value={simResults.monte_carlo.var_95 / 10000000} formatter={(v) => v.toFixed(2)} /> Cr</>
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
                <CountUp value={Math.abs(roiPct)} formatter={(v) => `${v.toFixed(0)}%`} />
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
<div ref={attributionSectionRef} className="grid grid-cols-12 gap-gutter mb-stack-lg animate-result-reveal">
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
{/*  Evidence/provenance trail for ALE/VaR  */}
<div className="grid grid-cols-12 gap-gutter mb-stack-lg">
<div className="col-span-12 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
{simResults?.provenance ? (() => {
    const p = simResults.provenance;
    const fi = p.fair_inputs || {};
    const rows: { label: string; range: string }[] = [
        { label: 'Threat Event Frequency (events/yr)', range: `${fi.tef_min?.toFixed(1)} – ${fi.tef_mode?.toFixed(1)} – ${fi.tef_max?.toFixed(1)}` },
        { label: 'Threat Capability (0–100)', range: `${fi.tc_min?.toFixed(1)} – ${fi.tc_mode?.toFixed(1)} – ${fi.tc_max?.toFixed(1)}` },
        { label: 'Control Strength (0–100)', range: `${fi.cs_min?.toFixed(1)} – ${fi.cs_mode?.toFixed(1)} – ${fi.cs_max?.toFixed(1)}` },
        { label: 'Primary Loss Magnitude (₹)', range: `${(fi.plm_min / 100000)?.toFixed(1)}L – ${(fi.plm_mode / 100000)?.toFixed(1)}L – ${(fi.plm_max / 100000)?.toFixed(1)}L` },
        { label: 'Secondary Loss Magnitude (₹)', range: `${(fi.slm_min / 100000)?.toFixed(1)}L – ${(fi.slm_mode / 100000)?.toFixed(1)}L – ${(fi.slm_max / 100000)?.toFixed(1)}L` },
    ];
    return (
        <details className="group">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-2 select-none">
                <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] transition-transform duration-150 group-open:rotate-90">chevron_right</span>
                    <div>
                        <span className="font-title-lg text-title-lg text-primary">Where these numbers come from</span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">The exact FAIR ranges and live data behind this run&apos;s ALE and VaR - not just the headline figure.</p>
                    </div>
                </div>
                <span className="font-label-caps text-label-caps text-on-surface-variant shrink-0">{p.num_simulations?.toLocaleString()} Monte Carlo iterations</span>
            </summary>
            <div className="mt-stack-md space-y-3">
                <div className="flex flex-wrap gap-2">
                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                        {p.data_source === 'own' ? 'Own Data' : 'Demo Data'}
                    </span>
                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                        {p.asset_count} asset{p.asset_count === 1 ? '' : 's'}
                    </span>
                    <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                        {p.telemetry_log_count} telemetry log{p.telemetry_log_count === 1 ? '' : 's'}
                    </span>
                    {p.confirmed_mapping_count > 0 && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                            {p.confirmed_mapping_count} confirmed ingestion finding{p.confirmed_mapping_count === 1 ? '' : 's'}
                        </span>
                    )}
                    {p.latest_telemetry_at && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">
                            Freshest telemetry: {new Date(p.latest_telemetry_at).toLocaleString()}
                        </span>
                    )}
                </div>
                <div className="border border-outline-variant rounded-lg overflow-hidden">
                    <div className="grid grid-cols-2 bg-surface-container px-3 py-1.5">
                        <span className="font-label-caps text-label-caps text-on-surface-variant">FAIR input (triangular)</span>
                        <span className="font-label-caps text-label-caps text-on-surface-variant text-right">min – mode – max</span>
                    </div>
                    {rows.map((r) => (
                        <div key={r.label} className="grid grid-cols-2 px-3 py-1.5 border-t border-outline-variant">
                            <span className="font-body-sm text-body-sm">{r.label}</span>
                            <span className="font-data-mono text-data-mono text-right">{r.range}</span>
                        </div>
                    ))}
                </div>
                <p className="font-label-caps text-label-caps text-on-surface-variant">
                    These ranges feed run_fair_monte_carlo directly - the same {p.num_simulations?.toLocaleString()}-iteration simulation that produced the ALE and VaR figures above, drawn from exactly the live asset/telemetry rows counted here.
                </p>
            </div>
        </details>
    );
})() : null}
</div>
</div>
{/*  Bottom Row: Sandbox & Breakdown  */}
<div ref={bottomSectionRef} className="grid grid-cols-12 gap-gutter animate-result-reveal">
{/*  What-If Sandbox  */}
<div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
<div className="flex justify-between items-center mb-stack-lg gap-stack-sm">
<div>
<h3 className="font-title-lg text-title-lg text-primary">Simulation Sandbox</h3>
{sandboxMode === 'whatIf' && (
    <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 max-w-md">Your results above already reflect what you&apos;ve confirmed in the Ingestion Engine - open this only to model extra investment on top of that.</p>
)}
</div>
<span className="bg-secondary-container text-on-secondary-container px-2 py-1 rounded font-label-caps text-label-caps shrink-0">Draft Mode</span>
</div>
{sandboxMode === 'whatIf' ? (
    <details className="group">
        <summary className="cursor-pointer list-none flex items-center gap-1.5 font-body-sm text-body-sm font-semibold text-primary mb-stack-md select-none w-fit">
            <span className="material-symbols-outlined text-[18px] transition-transform duration-150 group-open:rotate-90">chevron_right</span>
            Model an additional what-if budget
        </summary>
        <div className="space-y-stack-lg">
            {sandboxControls}
        </div>
    </details>
) : (
    <div className="space-y-stack-lg">
        {sandboxControls}
    </div>
)}
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
        </>
    );
}

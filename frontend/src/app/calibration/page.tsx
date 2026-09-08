"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import { formatRupeesCompact } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

/*
  [Closed-Loop "Prediction vs. Actual Loss" Calibration Engine]
  Frontend for backend/main.py's three new endpoints (POST /api/incidents,
  GET /api/incidents, GET /api/calibration) and backend/risk_engine.py's
  compute_calibration. Lets a CISO log what an incident actually cost
  after the fact, then shows exactly how that evidence is reshaping the
  model: per-control effectiveness (Beta-Bernoulli posteriors with 95%
  CIs), vulnerability-class and business-unit multipliers derived from
  realized prediction error and realized loss share, the loss-variance
  widening factor, and the 0-100 model uncertainty score that also now
  annotates the ALE/VaR figures on Overview.
*/

interface ControlEffectiveness {
    mean: number;
    ci_low: number;
    ci_high: number;
    n_observations: number;
    prior_mean: number;
}

interface VulnClassError {
    n: number;
    mean_prediction_error_pct: number | null;
}

interface Calibration {
    incident_count: number;
    control_effectiveness: Record<string, ControlEffectiveness>;
    vuln_class_multipliers: Record<string, number>;
    vuln_class_errors: Record<string, VulnClassError>;
    blended_tef_multiplier: number;
    business_unit_multipliers: Record<string, number>;
    loss_variance_multiplier: number;
    mean_prediction_error_pct: number | null;
    stdev_prediction_error_pct: number | null;
    uncertainty_score: number;
}

interface CalibrationSnapshotRow {
    id: number;
    timestamp: string;
    incident_id: number | null;
    incident_count: number;
    uncertainty_score: number;
    mean_prediction_error_pct: number | null;
    stdev_prediction_error_pct: number | null;
    loss_variance_multiplier: number;
}

interface IncidentRow {
    id: number;
    logged_at: string;
    incident_date: string;
    business_unit: string | null;
    vulnerability_class: string;
    control_involved: string | null;
    was_contained: boolean;
    containment_pct: number;
    downtime_cost: number;
    recovery_cost: number;
    legal_cost: number;
    penalty_cost: number;
    total_actual_loss: number;
    predicted_ale_at_time: number | null;
    prediction_error_pct: number | null;
    notes: string | null;
    logged_by: string;
}

// Mirrors backend/risk_engine.py::VULN_CLASSES exactly - what
// IncidentLogRequest.vulnerability_class is validated against server-side.
const VULN_CLASSES = [
    'phishing-credential-theft',
    'ransomware',
    'unpatched-exploit',
    'misconfiguration-exposure',
    'insider-privilege-abuse',
    'supply-chain-third-party',
];

const VULN_CLASS_LABELS: Record<string, string> = {
    'phishing-credential-theft': 'Phishing / Credential Theft',
    'ransomware': 'Ransomware',
    'unpatched-exploit': 'Unpatched Exploit',
    'misconfiguration-exposure': 'Misconfiguration Exposure',
    'insider-privilege-abuse': 'Insider Privilege Abuse',
    'supply-chain-third-party': 'Supply Chain / Third-Party',
};

// Mirrors backend/risk_engine.py::SECURITY_CONTROLS ids - same convention
// as Overview's STRATEGIC_CONTROLS - because these are also exactly the
// CONTROL_EFFECTIVENESS_PRIOR keys the calibration matrix below renders.
const CONTROL_IDS = [
    'Enforce Cloud MFA',
    'Patch Payment Gateway',
    'Zero Trust Architecture',
    'Least-Privilege IAM Review',
    'EDR Health Remediation',
    'Host Isolation & Incident Containment',
    'Public Exposure Hardening (WAF)',
    'CSPM Auto-Remediation',
    'Threat Intel & KEV Patch Program',
    '24/7 SOC Monitoring',
    'PII Data Minimization & Tokenization',
];

// Mirrors backend/generators.py::BUSINESS_UNITS.
const BUSINESS_UNITS = [
    'Payment Processing', 'Retail Operations', 'Customer Data Platform',
    'Corporate IT', 'Cloud Infrastructure', 'HR & Payroll',
];

const inputCls = 'w-full bg-surface border border-outline-variant rounded-lg px-3.5 py-2.5 text-body-sm shadow-sm transition-all duration-150 placeholder:text-on-surface-variant/50 hover:border-outline focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';
const selectCls = `${inputCls} appearance-none pr-9 cursor-pointer`;
const labelCls = 'font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wide mb-1.5 block';

function money(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatRupeesCompact(v);
}

function pct(v: number | null | undefined, digits = 1): string {
    if (v === null || v === undefined) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function uncertaintyTone(score: number): { text: string; bg: string; label: string } {
    if (score <= 35) return { text: 'text-[#15803d]', bg: 'bg-[#15803d]/10', label: 'High confidence' };
    if (score <= 65) return { text: 'text-amber-600', bg: 'bg-amber-500/10', label: 'Moderate confidence' };
    return { text: 'text-error', bg: 'bg-error/10', label: 'Low confidence' };
}

const emptyForm = {
    incident_date: new Date().toISOString().slice(0, 10),
    business_unit: '',
    vulnerability_class: VULN_CLASSES[0],
    control_involved: '',
    was_contained: false,
    containment_pct: '',
    downtime_cost: '',
    recovery_cost: '',
    legal_cost: '',
    penalty_cost: '',
    notes: '',
};

export default function CalibrationPage() {
    const { token } = useAuth();
    const { showToast } = useToast();

    const [calibration, setCalibration] = useState<Calibration | null>(null);
    const [trend, setTrend] = useState<CalibrationSnapshotRow[]>([]);
    const [isCalLoading, setIsCalLoading] = useState(true);
    const [calError, setCalError] = useState<string | null>(null);

    const [incidents, setIncidents] = useState<IncidentRow[]>([]);
    const [isIncLoading, setIsIncLoading] = useState(true);
    const [incError, setIncError] = useState<string | null>(null);

    const [form, setForm] = useState(emptyForm);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchCalibration = useCallback(async () => {
        setIsCalLoading(true);
        setCalError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/calibration`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setCalibration(data.calibration);
            setTrend(data.trend || []);
        } catch (e: any) {
            console.error(e);
            setCalError(e.message || 'Could not load calibration state. Is the backend running?');
        } finally {
            setIsCalLoading(false);
        }
    }, []);

    const fetchIncidents = useCallback(async () => {
        setIsIncLoading(true);
        setIncError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/incidents?limit=50`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setIncidents(data.data || []);
        } catch (e: any) {
            console.error(e);
            setIncError(e.message || 'Could not load the incident log. Is the backend running?');
        } finally {
            setIsIncLoading(false);
        }
    }, []);

    const refreshAll = useCallback(() => {
        fetchCalibration();
        fetchIncidents();
    }, [fetchCalibration, fetchIncidents]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    const updateField = (field: keyof typeof emptyForm, value: string | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const submitIncident = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) {
            showToast('Please log in first (top-right corner) before logging an incident.', 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            const payload = {
                incident_date: form.incident_date ? new Date(form.incident_date).toISOString() : undefined,
                business_unit: form.business_unit || null,
                vulnerability_class: form.vulnerability_class,
                control_involved: form.control_involved || null,
                was_contained: form.was_contained,
                containment_pct: form.containment_pct === '' ? 0 : Number(form.containment_pct),
                downtime_cost: form.downtime_cost === '' ? 0 : Number(form.downtime_cost),
                recovery_cost: form.recovery_cost === '' ? 0 : Number(form.recovery_cost),
                legal_cost: form.legal_cost === '' ? 0 : Number(form.legal_cost),
                penalty_cost: form.penalty_cost === '' ? 0 : Number(form.penalty_cost),
                notes: form.notes || null,
            };
            const res = await fetchWithRetry(`${API_BASE}/api/incidents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);

            const errPct = data.incident?.prediction_error_pct;
            showToast(
                errPct !== null && errPct !== undefined
                    ? `Incident logged - actual loss came in ${pct(errPct)} vs. the model's prediction. Calibration updated.`
                    : 'Incident logged. Calibration updated.',
                'success'
            );
            setForm({ ...emptyForm, incident_date: new Date().toISOString().slice(0, 10) });
            refreshAll();
        } catch (e: any) {
            console.error(e);
            showToast(e.message || 'Could not log this incident.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLoadingAny = isCalLoading || isIncLoading;
    const tone = calibration ? uncertaintyTone(calibration.uncertainty_score) : null;

    return (
        <div className="max-w-[1100px] mx-auto flex flex-col gap-stack-lg">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
                <div>
                    <h1 className="font-headline-md text-headline-md landing-font landing-heading-gradient mb-1">Calibration</h1>
                    <p className="font-body-md text-body-md text-on-surface-variant">
                        Closed-loop prediction-vs-actual-loss engine. Log what an incident really cost, and every control-effectiveness score, loss multiplier, and confidence interval on this platform updates from it.
                    </p>
                </div>
                <button
                    onClick={refreshAll}
                    disabled={isLoadingAny}
                    className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap"
                >
                    <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${isLoadingAny ? 'animate-spin' : ''}`}>refresh</span>
                    Refresh
                </button>
            </div>

            {/* Model Uncertainty Overview */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Model Uncertainty</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Falls as more incident evidence accumulates, and stays elevated if that evidence has been inconsistent - see risk_engine.compute_calibration. This score now annotates the ALE and VaR figures on Overview.
                </p>
                {calError ? (
                    <p className="font-body-sm text-body-sm text-error">{calError}</p>
                ) : isCalLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-gutter">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-14 bg-surface-container-low rounded animate-pulse" />
                        ))}
                    </div>
                ) : calibration ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-gutter">
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Uncertainty Score</div>
                            <div className={`inline-flex items-center gap-2 font-headline-md text-headline-md font-data-mono px-2 py-0.5 rounded ${tone?.bg} ${tone?.text}`}>
                                {calibration.uncertainty_score.toFixed(0)}/100
                            </div>
                            <div className={`font-label-caps text-label-caps mt-1 ${tone?.text}`}>{tone?.label}</div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Incidents Logged</div>
                            <div className="font-headline-md text-headline-md text-primary font-data-mono">{calibration.incident_count}</div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Mean Prediction Error</div>
                            <div className={`font-headline-md text-headline-md font-data-mono ${
                                calibration.mean_prediction_error_pct === null ? 'text-on-surface-variant' :
                                calibration.mean_prediction_error_pct > 0 ? 'text-error' : 'text-[#15803d]'
                            }`}>
                                {pct(calibration.mean_prediction_error_pct)}
                            </div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Prediction Error Stdev</div>
                            <div className="font-headline-md text-headline-md text-primary font-data-mono">
                                {calibration.stdev_prediction_error_pct === null ? '—' : `${calibration.stdev_prediction_error_pct.toFixed(1)}%`}
                            </div>
                        </div>
                        <div>
                            <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Loss Variance Multiplier</div>
                            <div className="font-headline-md text-headline-md text-primary font-data-mono">{calibration.loss_variance_multiplier.toFixed(2)}x</div>
                        </div>
                    </div>
                ) : null}
                {!isCalLoading && !calError && calibration && calibration.incident_count === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-stack-md">
                        No incidents logged yet - every control still runs on its prior effectiveness assumption. Log your first incident below to start calibrating against reality.
                    </p>
                )}
            </div>

            {/* Log an Incident */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Log an Incident</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Record what actually happened - downtime, recovery, legal, and penalty costs - after a real incident or near-miss. The model snapshots its most recent ALE prediction at logging time, computes the prediction error, and recalibrates.
                </p>
                <form onSubmit={submitIncident} className="flex flex-col gap-stack-lg">
                    <div className="bg-surface-container-low/50 border border-outline-variant/70 rounded-lg p-stack-md">
                        <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wide mb-stack-sm flex items-center gap-1.5">
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">event_note</span>
                            Incident Details
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-stack-md">
                            <div>
                                <label className={labelCls} htmlFor="inc-date">Incident Date</label>
                                <input id="inc-date" type="date" className={inputCls} value={form.incident_date}
                                    onChange={(e) => updateField('incident_date', e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-bu">Business Unit</label>
                                <div className="relative">
                                    <select id="inc-bu" className={selectCls} value={form.business_unit}
                                        onChange={(e) => updateField('business_unit', e.target.value)}>
                                        <option value="">— Unspecified —</option>
                                        {BUSINESS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
                                </div>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-vc">Vulnerability Class</label>
                                <div className="relative">
                                    <select id="inc-vc" className={selectCls} value={form.vulnerability_class}
                                        onChange={(e) => updateField('vulnerability_class', e.target.value)}>
                                        {VULN_CLASSES.map((vc) => <option key={vc} value={vc}>{VULN_CLASS_LABELS[vc]}</option>)}
                                    </select>
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
                                </div>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-control">Control Involved</label>
                                <div className="relative">
                                    <select id="inc-control" className={selectCls} value={form.control_involved}
                                        onChange={(e) => updateField('control_involved', e.target.value)}>
                                        <option value="">— None / not control-specific —</option>
                                        {CONTROL_IDS.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-surface-container-low/50 border border-outline-variant/70 rounded-lg p-stack-md">
                        <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wide mb-stack-sm flex items-center gap-1.5">
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">shield</span>
                            Containment
                        </h4>
                        <div className="flex flex-wrap items-end gap-stack-lg">
                            <div className="w-full sm:w-52">
                                <label className={labelCls} htmlFor="inc-containment">Containment %</label>
                                <input id="inc-containment" type="number" min={0} max={100} step={1} className={`${inputCls} no-spinner`}
                                    placeholder="0-100" value={form.containment_pct}
                                    onChange={(e) => updateField('containment_pct', e.target.value)} />
                            </div>
                            <label className="inline-flex items-center gap-2.5 cursor-pointer pb-2.5">
                                <input type="checkbox" checked={form.was_contained} className="peer sr-only"
                                    onChange={(e) => updateField('was_contained', e.target.checked)} />
                                <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/15 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-surface-variant after:rounded-full after:h-5 after:w-5 after:shadow-sm after:transition-all after:duration-200 peer-checked:bg-primary relative transition-colors duration-200"></div>
                                <span className="font-body-sm text-body-sm font-medium">Fully contained</span>
                            </label>
                        </div>
                    </div>

                    <div className="bg-surface-container-low/50 border border-outline-variant/70 rounded-lg p-stack-md">
                        <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wide mb-stack-sm flex items-center gap-1.5">
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">payments</span>
                            Financial Impact
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-stack-md">
                            <div>
                                <label className={labelCls} htmlFor="inc-downtime">Downtime Cost</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-data-mono text-data-mono text-on-surface-variant pointer-events-none">₹</span>
                                    <input id="inc-downtime" type="number" min={0} step={1} className={`${inputCls} no-spinner pl-8`}
                                        placeholder="0" value={form.downtime_cost}
                                        onChange={(e) => updateField('downtime_cost', e.target.value)} />
                                </div>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-recovery">Recovery Cost</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-data-mono text-data-mono text-on-surface-variant pointer-events-none">₹</span>
                                    <input id="inc-recovery" type="number" min={0} step={1} className={`${inputCls} no-spinner pl-8`}
                                        placeholder="0" value={form.recovery_cost}
                                        onChange={(e) => updateField('recovery_cost', e.target.value)} />
                                </div>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-legal">Legal Cost</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-data-mono text-data-mono text-on-surface-variant pointer-events-none">₹</span>
                                    <input id="inc-legal" type="number" min={0} step={1} className={`${inputCls} no-spinner pl-8`}
                                        placeholder="0" value={form.legal_cost}
                                        onChange={(e) => updateField('legal_cost', e.target.value)} />
                                </div>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="inc-penalty">Penalty Cost</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-data-mono text-data-mono text-on-surface-variant pointer-events-none">₹</span>
                                    <input id="inc-penalty" type="number" min={0} step={1} className={`${inputCls} no-spinner pl-8`}
                                        placeholder="0" value={form.penalty_cost}
                                        onChange={(e) => updateField('penalty_cost', e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <div className="mt-stack-md">
                            <label className={labelCls} htmlFor="inc-notes">Notes</label>
                            <input id="inc-notes" type="text" className={inputCls}
                                placeholder="Optional context for the audit trail" value={form.notes}
                                onChange={(e) => updateField('notes', e.target.value)} />
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-stack-md pt-stack-sm border-t border-outline-variant">
                        <div className="font-body-sm text-body-sm text-on-surface-variant">
                            Total actual loss:{' '}
                            <span className="font-data-mono font-bold text-on-surface">
                                {money(
                                    (Number(form.downtime_cost) || 0) +
                                    (Number(form.recovery_cost) || 0) +
                                    (Number(form.legal_cost) || 0) +
                                    (Number(form.penalty_cost) || 0)
                                )}
                            </span>
                        </div>
                        <button type="submit" disabled={isSubmitting}
                            className="bg-primary text-on-primary font-body-sm text-body-sm px-6 py-3 rounded-lg font-semibold shadow-sm hover:shadow-md hover:bg-opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center gap-2 w-full sm:w-auto justify-center">
                            {isSubmitting && <span aria-hidden="true" className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
                            {isSubmitting ? 'Logging...' : 'Log Incident & Recalibrate'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Control Effectiveness Matrix */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Control Effectiveness Matrix</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Beta-Bernoulli posterior for each control&apos;s real-world effectiveness, updated from logged containment_pct observations against it - the &quot;EDR contained 60%, not 85% as assumed&quot; calibration in action.
                </p>
                {isCalLoading ? (
                    <div className="flex flex-col gap-2">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-10 bg-surface-container-low rounded animate-pulse" />
                        ))}
                    </div>
                ) : !calibration ? (
                    <p className="font-body-sm text-body-sm text-error">{calError}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface-container-low border-b border-outline-variant">
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Control</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Prior Assumption</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Calibrated Effectiveness</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">95% CI</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Observations</th>
                                </tr>
                            </thead>
                            <tbody>
                                {CONTROL_IDS.map((id) => {
                                    const entry = calibration.control_effectiveness[id];
                                    if (!entry) return null;
                                    const drift = entry.mean - entry.prior_mean;
                                    const hasEvidence = entry.n_observations > 0;
                                    return (
                                        <tr key={id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                                            <td className="py-3 px-4 font-body-sm text-body-sm font-medium whitespace-nowrap">{id}</td>
                                            <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant">{(entry.prior_mean * 100).toFixed(0)}%</td>
                                            <td className="py-3 px-4">
                                                <span className={`font-data-mono text-data-mono font-semibold ${
                                                    !hasEvidence ? 'text-on-surface-variant' : drift < -0.005 ? 'text-error' : drift > 0.005 ? 'text-[#15803d]' : 'text-on-surface'
                                                }`}>
                                                    {(entry.mean * 100).toFixed(1)}%
                                                </span>
                                                {hasEvidence && Math.abs(drift) > 0.005 && (
                                                    <span className={`ml-2 font-label-caps text-label-caps ${drift < 0 ? 'text-error' : 'text-[#15803d]'}`}>
                                                        {drift > 0 ? '+' : ''}{(drift * 100).toFixed(1)}pt vs. prior
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant whitespace-nowrap">
                                                {hasEvidence ? `${(entry.ci_low * 100).toFixed(0)}% – ${(entry.ci_high * 100).toFixed(0)}%` : '—'}
                                            </td>
                                            <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant">{entry.n_observations}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Vulnerability-Class & Business-Unit Multipliers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                    <h3 className="font-title-lg text-title-lg text-primary mb-1">Vulnerability-Class Multipliers</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                        Exploitation-likelihood multiplier per class, derived from realized prediction error on incidents of that class. 1.00x = no adjustment yet.
                    </p>
                    {isCalLoading ? (
                        <div className="flex flex-col gap-2">
                            {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-surface-container-low rounded animate-pulse" />)}
                        </div>
                    ) : calibration ? (
                        <div className="flex flex-col gap-2">
                            {VULN_CLASSES.map((vc) => {
                                const m = calibration.vuln_class_multipliers[vc] ?? 1.0;
                                const errInfo = calibration.vuln_class_errors[vc];
                                return (
                                    <div key={vc} className="flex items-center justify-between py-1.5 border-b border-outline-variant last:border-0">
                                        <div>
                                            <div className="font-body-sm text-body-sm font-medium">{VULN_CLASS_LABELS[vc]}</div>
                                            <div className="font-label-caps text-label-caps text-on-surface-variant">
                                                {errInfo && errInfo.n > 0 ? `${errInfo.n} incident${errInfo.n !== 1 ? 's' : ''}, ${pct(errInfo.mean_prediction_error_pct)} avg error` : 'No incidents logged'}
                                            </div>
                                        </div>
                                        <span className={`font-data-mono text-data-mono font-semibold px-2 py-0.5 rounded ${
                                            m > 1.01 ? 'bg-error/10 text-error' : m < 0.99 ? 'bg-[#15803d]/10 text-[#15803d]' : 'bg-surface-container text-on-surface-variant'
                                        }`}>
                                            {m.toFixed(2)}x
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                    <h3 className="font-title-lg text-title-lg text-primary mb-1">Business-Unit Criticality Weights</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                        Reweights each unit&apos;s ALE share when its realized incident-loss share has outrun (or undershot) its static asset-value share. 1.00x = no adjustment yet.
                    </p>
                    {isCalLoading ? (
                        <div className="flex flex-col gap-2">
                            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-surface-container-low rounded animate-pulse" />)}
                        </div>
                    ) : calibration && Object.keys(calibration.business_unit_multipliers).length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {Object.entries(calibration.business_unit_multipliers).map(([unit, m]) => (
                                <div key={unit} className="flex items-center justify-between py-1.5 border-b border-outline-variant last:border-0">
                                    <span className="font-body-sm text-body-sm font-medium">{unit}</span>
                                    <span className={`font-data-mono text-data-mono font-semibold px-2 py-0.5 rounded ${
                                        m > 1.01 ? 'bg-error/10 text-error' : m < 0.99 ? 'bg-[#15803d]/10 text-[#15803d]' : 'bg-surface-container text-on-surface-variant'
                                    }`}>
                                        {m.toFixed(2)}x
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                            No assets found yet - run mock data generation from Overview first.
                        </p>
                    )}
                </div>
            </div>

            {/* Uncertainty Trend */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Uncertainty Trend</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Model uncertainty score after each logged incident, oldest to newest - should trend down as evidence accumulates, and stay flatter when that evidence is consistent.
                </p>
                {isCalLoading ? (
                    <div className="h-[220px] w-full bg-surface-variant/30 rounded animate-pulse" />
                ) : trend.length < 2 ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        Log at least two incidents to see the uncertainty trend chart.
                    </p>
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={trend.map((t) => ({
                            ts: new Date(t.timestamp).toLocaleDateString(),
                            uncertainty: t.uncertainty_score,
                        }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--outline-variant)" />
                            <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: number) => [`${v.toFixed(0)}/100`, 'Uncertainty']} />
                            <Line type="monotone" dataKey="uncertainty" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Incident Log */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter elevate">
                <h3 className="font-title-lg text-title-lg text-primary mb-1">Incident Log</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">
                    Every logged incident, most recent first, with the predicted ALE snapshot at the time and the resulting prediction error.
                </p>
                {incError ? (
                    <p className="font-body-sm text-body-sm text-error">{incError}</p>
                ) : isIncLoading ? (
                    <div className="flex flex-col gap-2">
                        {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-surface-container-low rounded animate-pulse" />)}
                    </div>
                ) : incidents.length === 0 ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        No incidents logged yet - use the form above to log your first one.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface-container-low border-b border-outline-variant">
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Date</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Class</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Control</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Unit</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Actual Loss</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Predicted ALE</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Error</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Logged By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {incidents.map((inc) => (
                                    <tr key={inc.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors">
                                        <td className="py-3 px-4 font-body-sm text-body-sm whitespace-nowrap">{new Date(inc.incident_date).toLocaleDateString()}</td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm">{VULN_CLASS_LABELS[inc.vulnerability_class] || inc.vulnerability_class}</td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">{inc.control_involved || '—'}</td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">{inc.business_unit || '—'}</td>
                                        <td className="py-3 px-4 font-data-mono text-data-mono">{money(inc.total_actual_loss)}</td>
                                        <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant">{money(inc.predicted_ale_at_time)}</td>
                                        <td className="py-3 px-4 font-data-mono text-data-mono">
                                            <span className={inc.prediction_error_pct === null ? 'text-on-surface-variant' : inc.prediction_error_pct > 0 ? 'text-error' : 'text-[#15803d]'}>
                                                {pct(inc.prediction_error_pct)}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant">{inc.logged_by}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

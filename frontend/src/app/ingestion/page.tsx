"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import RiskSandbox, { STRATEGIC_CONTROLS } from '@/components/RiskSandbox';

interface Finding {
    line_number: number;
    snippet: string;
    parameter: string;
    risk_tag: string;
    confidence: number;
    kind: 'control_present' | 'control_gap';
    severity: 'info' | 'warning' | 'critical';
    rationale: string;
}

interface ReviewItem extends Finding {
    status: 'pending' | 'confirmed' | 'ignored';
}

const SEVERITY_STYLES: Record<Finding['severity'], { badge: string; label: string; dot: string }> = {
    info: { badge: 'bg-[#15803d]/10 text-[#15803d]', label: 'Control Present', dot: 'bg-[#15803d]' },
    warning: { badge: 'bg-[#ca8a04]/10 text-[#ca8a04]', label: 'Gap - Review', dot: 'bg-[#ca8a04]' },
    critical: { badge: 'bg-error/10 text-error', label: 'Critical Gap', dot: 'bg-error' },
};

// [Ingestion upload guidance fix] Accepted types/size/encoding, spelled
// out in the UI and enforced client-side before a file is even read -
// previously the only signal was the native picker's `accept` filter
// (bypassable via drag-drop) and an unbounded FileReader.readAsText with
// no size cap and no feedback on a binary/garbled upload.
const ACCEPTED_EXTENSIONS = ['.txt', '.cfg', '.conf', '.json', '.log'];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB - generous for a text device config
const MAX_FILE_SIZE_LABEL = '2 MB';

const SAMPLE_CONFIGS: { label: string; href: string; filename: string }[] = [
    { label: 'Cisco IOS sample', href: '/samples/cisco-ios-sample.cfg', filename: 'cisco-ios-sample.cfg' },
    { label: 'SONiC sample', href: '/samples/sonic-sample.cfg', filename: 'sonic-sample.cfg' },
];

export default function IngestionPage() {
    const { token, username } = useAuth();
    const { showToast } = useToast();

    // [Report saved each time] One localStorage blob per account holds
    // everything needed to pick up exactly where you left off - the
    // uploaded file, its review progress, and the sandbox's last run -
    // so switching to Demo or Training via "Switch Dashboard" and coming
    // back here doesn't lose any of it. Merges into whatever's already
    // saved rather than overwriting the whole blob on every call.
    const persistIngestionState = useCallback((patch: Record<string, any>) => {
        if (!username) return;
        try {
            const key = `crq_sim_state:${username}:own`;
            const raw = localStorage.getItem(key);
            const existing = raw ? JSON.parse(raw) : {};
            localStorage.setItem(key, JSON.stringify({ ...existing, ...patch }));
        } catch (e) {
            // Non-critical - worst case a revisit starts from scratch.
        }
    }, [username]);

    const [fileName, setFileName] = useState<string | null>(null);
    const [rawContent, setRawContent] = useState<string>('');
    const [items, setItems] = useState<ReviewItem[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [trainedCount, setTrainedCount] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // [Own-data dashboard] This is the full Simulation Sandbox from the
    // demo Overview page - budget slider, Strategic Controls, ALE/VaR/Loss
    // Distribution, Explainable Risk Attribution, Business Unit breakdown -
    // reused via the shared RiskSandbox component so ingesting your own
    // data leads to the exact same working dashboard the demo gets, just
    // calibrated on what you actually confirmed below instead of demo
    // telemetry. Unlike Overview's runSimulation, this one never seeds
    // mock data on a "no assets found" error - own-data mode only ever
    // reflects what was actually ingested and confirmed.
    const [budget, setBudget] = useState(50);
    const [simResults, setSimResults] = useState<any>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    // [P0-STALE-006 - failed refresh] Same fix as the demo dashboard -
    // a failed Run Simulation used to leave the previous result on screen
    // with nothing but a toast to say the refresh attempt didn't land.
    const [lastRunFailed, setLastRunFailed] = useState(false);
    const [controls, setControls] = useState<Record<string, boolean>>(
        Object.fromEntries(STRATEGIC_CONTROLS.map((c) => [c.name, c.name === 'Enforce Cloud MFA']))
    );
    const [optimizerPicks, setOptimizerPicks] = useState<string[] | null>(null);
    const [acceptingRiskFor, setAcceptingRiskFor] = useState<string | null>(null);
    const [isApproving, setIsApproving] = useState(false);
    const simRequestIdRef = useRef(0);
    // [Deploy-level polish] Same pattern as the demo Overview dashboard -
    // bumped on every simulation that returns new results and used as the
    // RiskSandbox `key` so its result panels replay their entrance
    // animation on every run, not just the first time data appears.
    const [resultVersion, setResultVersion] = useState(0);
    // Smooth-scrolled into view after a manual "Run Simulation" click.
    const resultsRef = useRef<HTMLDivElement>(null);

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBudget(Number(e.target.value));
    };

    const toggleControl = (name: string) => {
        setControls((prev) => ({ ...prev, [name]: !prev[name] }));
    };

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

    const runSimulation = useCallback(async (opts?: { silent?: boolean }) => {
        const requestId = ++simRequestIdRef.current;
        // [Deploy-level polish] Minimum perceived-work floor for manual
        // runs only - see the elapsed-time check in `finally` below.
        const startedAt = Date.now();
        setIsSimulating(true);
        try {
            const budgetValue = (budget / 100) * 10000000;
            // [Cross-user data leakage fix] POST /api/simulate-risk with
            // data_source: 'own' now requires a logged-in caller (see
            // backend/main.py) so a run is attributable to, and later only
            // readable by, the real account - previously this call had no
            // auth at all and every "own" run landed in one shared global
            // bucket every account could read back.
            const res = await fetchWithRetry(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ budget: budgetValue, active_controls: controls, data_source: 'own' }),
            });
            const data = await res.json();
            if (requestId !== simRequestIdRef.current) return;
            if (!res.ok) {
                if (!opts?.silent) showToast(`Simulation failed: ${data.detail || res.status}`, 'error');
                setLastRunFailed(true);
                return;
            }
            setSimResults(data);
            setLastRunFailed(false);
            const picks: string[] = data.optimization.selected_patches || [];
            setOptimizerPicks(picks);
            persistIngestionState({ budget, controls, simResults: data, optimizerPicks: picks });
            // [Deploy-level polish] Force a clean remount so results
            // fade/slide in fresh on every run, and - manual runs only -
            // smooth-scroll the regenerated sandbox into view.
            setResultVersion((v) => v + 1);
            if (!opts?.silent) {
                requestAnimationFrame(() => {
                    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
            if (opts?.silent) {
                showToast('Risk recalculated from your ingested data.', 'info');
            } else {
                showToast(`Simulation complete - ${picks.length} of ${STRATEGIC_CONTROLS.length} controls recommended within this budget.`, 'success');
            }
        } catch (e) {
            if (requestId !== simRequestIdRef.current) return;
            console.error(e);
            if (!opts?.silent) showToast('Error running simulation. Ensure FastAPI is running on port 8000.', 'error', { dataSaved: 'no', retrySafe: true });
            setLastRunFailed(true);
        } finally {
            if (requestId === simRequestIdRef.current) {
                // Same 0.5s perceived-work floor as the demo dashboard,
                // skipped for silent auto-recalculation runs.
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
    }, [budget, controls, showToast, persistIngestionState, token]);

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
                    data_source: 'own',
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not log audit: ${data.detail || res.status}`, 'error', { dataSaved: 'no', retrySafe: true });
                return;
            }
            showToast(`Risk accepted and logged to the audit trail.\nDecision #${data.decision_id} - Decided by: ${data.decided_by}`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
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
                    data_source: 'own',
                    // [Approve & Log always 400ing - fix] backend/main.py's
                    // POST /api/audit requires residual_ale/p95/
                    // accepted_scenario/evidence_hash whenever
                    // board_approved is true - evidence_hash is computed
                    // server-side FROM active_controls, so omitting all of
                    // these (as this call used to) meant every click here
                    // failed with a 400 "missing evidence" error,
                    // unconditionally. Mirrors overview/page.tsx's
                    // already-correct approveOptimizer.
                    residual_ale: simResults?.monte_carlo?.mean_expected_loss ?? null,
                    p95: simResults?.monte_carlo?.var_95 ?? null,
                    accepted_scenario: simResults?.scenario_breakdown?.scenarios?.[0]?.scenario ?? null,
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
            showToast(`Optimization plan approved and logged. Decision #${data.decision_id}.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
        } finally {
            setIsApproving(false);
        }
    };

    const fetchTrainedCount = useCallback(async () => {
        // [Cross-user data leakage fix] GET /api/ingest/mappings now
        // requires a valid bearer token and is scoped to this account's
        // own confirmed mappings (it used to have no auth at all and
        // returned every account's mappings together). Skip the call
        // rather than firing an unauthenticated request that would 401 -
        // the counter just stays blank until token is available.
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE}/api/ingest/mappings`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) return;
            const data = await res.json();
            setTrainedCount(typeof data.count === 'number' ? data.count : null);
        } catch {
            // Non-critical - the counter just stays blank if this fails.
        }
    }, [token]);

    useEffect(() => {
        fetchTrainedCount();
    }, [fetchTrainedCount]);

    // [Report saved each time] Restore the last saved upload + review +
    // sandbox run for this account instead of starting blank every time
    // this page is revisited.
    useEffect(() => {
        if (!username) return;
        let cached: any = null;
        try {
            const raw = localStorage.getItem(`crq_sim_state:${username}:own`);
            if (raw) cached = JSON.parse(raw);
        } catch (e) {}
        if (!cached) return;
        if (typeof cached.fileName === 'string') setFileName(cached.fileName);
        if (typeof cached.rawContent === 'string') setRawContent(cached.rawContent);
        if (Array.isArray(cached.items)) setItems(cached.items);
        if (typeof cached.budget === 'number') setBudget(cached.budget);
        if (cached.controls) setControls(cached.controls);
        if (cached.simResults) setSimResults(cached.simResults);
        if (cached.optimizerPicks) setOptimizerPicks(cached.optimizerPicks);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [username]);

    const activeIndex = items.findIndex((it) => it.status === 'pending');
    const active = activeIndex >= 0 ? items[activeIndex] : null;
    const reviewedCount = items.filter((it) => it.status !== 'pending').length;
    // [Step by step] The sandbox (Monte Carlo graph, ALE/VaR, Accept Risk)
    // only appears once every detected finding has been confirmed or
    // ignored - or immediately if the parser found nothing to review, so
    // an empty file doesn't get stuck. Reviewing first, results second,
    // instead of showing a half-calibrated sandbox before you've told it
    // what's actually true about your environment.
    const reviewComplete = items.length === 0 || active === null;

    // [Step by step] Fires once, right when the last pending finding gets
    // confirmed/ignored and the sandbox first appears - scrolls it into
    // view so finishing the review visibly "generates" the Monte Carlo
    // graph instead of leaving it to appear silently further down the page.
    const wasReviewCompleteRef = useRef(false);
    useEffect(() => {
        if (reviewComplete && items.length > 0 && !wasReviewCompleteRef.current) {
            requestAnimationFrame(() => {
                resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
        wasReviewCompleteRef.current = reviewComplete;
    }, [reviewComplete, items.length]);

    const parseText = useCallback(async (name: string, content: string) => {
        setIsParsing(true);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/ingest/parse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: name, content }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not parse file: ${data.detail || res.status}`, 'error', { dataSaved: 'no', retrySafe: true });
                return;
            }
            setFileName(name);
            setRawContent(data.raw_content);
            const findings: Finding[] = data.findings || [];
            const newItems: ReviewItem[] = findings.map((f) => ({ ...f, status: 'pending' as const }));
            setItems(newItems);
            // Baseline reading for the sandbox below - taken right away
            // so it has something to show (and something to diff against)
            // before the first mapping is even confirmed.
            setSimResults(null);
            setOptimizerPicks(null);
            persistIngestionState({ fileName: name, rawContent: data.raw_content, items: newItems, simResults: null, optimizerPicks: null });
            runSimulation({ silent: true });
            if (findings.length === 0) {
                showToast('Parsed the file, but found no recognized security-relevant directives in it.', 'info');
            } else {
                showToast(`Found ${findings.length} candidate mapping${findings.length === 1 ? '' : 's'} to review.`, 'success');
            }
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
        } finally {
            setIsParsing(false);
        }
    }, [showToast, runSimulation, persistIngestionState]);

    const handleFile = useCallback((file: File) => {
        const lowerName = file.name.toLowerCase();
        const hasAcceptedExtension = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
        if (!hasAcceptedExtension) {
            showToast(`"${file.name}" isn't a recognized config type. Upload one of: ${ACCEPTED_EXTENSIONS.join(', ')}.`, 'error');
            return;
        }
        if (file.size === 0) {
            showToast(`"${file.name}" is empty - nothing to parse.`, 'error');
            return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
            showToast(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB, over the ${MAX_FILE_SIZE_LABEL} limit. Upload a smaller config excerpt.`, 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            // readAsText silently replaces undecodable bytes with U+FFFD, so a
            // high replacement-char ratio (or an embedded NUL byte) means this
            // almost certainly isn't plain-text/UTF-8 - catch it here instead of
            // letting the parser churn through visual noise with no real findings.
            const replacementCount = (text.match(/\uFFFD/g) || []).length;
            const looksBinary = text.includes('\u0000') || (text.length > 0 && replacementCount / text.length > 0.01);
            if (looksBinary) {
                showToast(`"${file.name}" doesn't look like a plain-text config (binary or non-UTF-8 content detected). Export it as plain text/UTF-8 and try again.`, 'error');
                return;
            }
            parseText(file.name, text);
        };
        reader.onerror = () => showToast(`Could not read "${file.name}" from disk.`, 'error');
        reader.readAsText(file);
    }, [parseText, showToast]);

    const loadSample = useCallback(async (sample: { href: string; filename: string }) => {
        try {
            const res = await fetch(sample.href);
            if (!res.ok) throw new Error(String(res.status));
            const text = await res.text();
            parseText(sample.filename, text);
        } catch (e) {
            showToast('Could not load the sample config.', 'error');
        }
    }, [parseText, showToast]);

    const onBrowseClick = () => fileInputRef.current?.click();

    const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = ''; // allow re-selecting the same file later
    };

    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    };

    const confirmActive = async () => {
        if (!active) return;
        if (!token) {
            showToast('Please log in first (top-right corner) before confirming a mapping.', 'error');
            return;
        }
        setIsConfirming(true);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/ingest/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    filename: fileName,
                    line_number: active.line_number,
                    snippet: active.snippet,
                    parameter: active.parameter,
                    risk_tag: active.risk_tag,
                    confidence: active.confidence,
                    kind: active.kind,
                    severity: active.severity,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(`Could not confirm mapping: ${data.detail || res.status}`, 'error', { dataSaved: 'unknown', retrySafe: false });
                return;
            }
            const updatedItems = items.map((it, i) => (i === activeIndex ? { ...it, status: 'confirmed' as const } : it));
            setItems(updatedItems);
            persistIngestionState({ items: updatedItems });
            // Confirmed control_gap findings feed directly into the FAIR risk
            // calc as an always-on Control Strength deduction (see
            // backend/risk_engine.py::derive_fair_inputs) - the toast makes
            // that visible instead of implying this is just a label saved
            // for later training, and the sandbox below shows the actual
            // number moving, not just a claim that it did.
            showToast(
                active.kind === 'control_gap'
                    ? `Gap confirmed: ${active.parameter} - risk updated below.`
                    : `Mapping trained: ${active.parameter}`,
                'success'
            );
            fetchTrainedCount();
            runSimulation({ silent: true });
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error', { dataSaved: 'unknown', retrySafe: false });
        } finally {
            setIsConfirming(false);
        }
    };

    const ignoreActive = () => {
        if (!active) return;
        const updatedItems = items.map((it, i) => (i === activeIndex ? { ...it, status: 'ignored' as const } : it));
        setItems(updatedItems);
        persistIngestionState({ items: updatedItems });
    };

    const rescan = () => {
        if (fileName && rawContent) parseText(fileName, rawContent);
    };

    const lines = rawContent.split('\n');
    const findingByLine = new Map<number, ReviewItem>();
    items.forEach((it) => findingByLine.set(it.line_number, it));

    return (
        <>
            <div className="max-w-[1440px] mx-auto px-container-padding py-stack-lg flex flex-col gap-stack-lg">
                {/* Page Header */}
                <div className="flex justify-between items-end flex-wrap gap-stack-sm">
                    <div>
                        <h1 className="font-headline-md text-headline-md landing-font landing-heading-gradient">Ingestion Engine</h1>
                        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                            Upload a raw device config; a rule-based parser finds the security-relevant lines and proposes standard compliance mappings for you to confirm.
                        </p>
                    </div>
                    {trainedCount !== null && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
                            <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-primary">model_training</span>
                            {trainedCount} Trained Parameter{trainedCount === 1 ? '' : 's'}
                        </span>
                    )}
                </div>

                {/* Ingestion Drop Zone */}
                <section
                    className={`bg-surface-container-lowest border rounded p-stack-lg text-center border-dashed relative overflow-hidden transition-colors ${isDragOver ? 'border-primary bg-primary-container/10' : 'border-outline-variant'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={onDrop}
                    tabIndex={0}
                    role="button"
                    aria-label="Upload a configuration file. Accepted types: .txt, .cfg, .conf, .json, .log. Max size 2 MB, plain text/UTF-8 encoding."
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onBrowseClick();
                        }
                    }}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.cfg,.conf,.json,.log"
                        className="hidden"
                        onChange={onFileInputChange}
                    />
                    <div className="max-w-md mx-auto">
                        <span aria-hidden="true" className="material-symbols-outlined text-[48px] text-outline mb-stack-md" style={{ fontVariationSettings: "'wght' 200" }}>cloud_upload</span>
                        <h2 className="font-title-lg text-title-lg text-primary mb-2">Upload Configuration Files</h2>
                        <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Drag and drop a raw text config file - Cisco IOS or SONiC-style device configs both parse correctly.</p>
                        <div className="flex items-center justify-center gap-stack-md">
                            <button onClick={onBrowseClick} className="border border-outline-variant text-primary font-body-sm text-body-sm px-4 py-2 rounded hover:border-primary transition-colors bg-surface-container-lowest">
                                Browse Files
                            </button>
                            <span className="font-body-sm text-body-sm text-on-surface-variant">or drag a file here</span>
                        </div>
                        <p className="font-body-sm text-[12px] text-on-surface-variant mt-stack-md">
                            Accepted types: <span className="font-data-mono text-data-mono">.txt .cfg .conf .json .log</span> &middot; up to {MAX_FILE_SIZE_LABEL} &middot; plain text/UTF-8 encoding only.
                        </p>
                        <p className="font-body-sm text-[12px] text-on-surface-variant mt-2">
                            No config on hand? Try a sample:{' '}
                            {SAMPLE_CONFIGS.map((sample, i) => (
                                <span key={sample.href}>
                                    {i > 0 && ' · '}
                                    <button
                                        type="button"
                                        onClick={() => loadSample(sample)}
                                        className="text-primary underline hover:opacity-70 transition-opacity"
                                    >
                                        {sample.label}
                                    </button>{' '}
                                    (<a href={sample.href} download className="text-primary underline hover:opacity-70 transition-opacity">download</a>)
                                </span>
                            ))}
                        </p>
                    </div>
                    {isParsing && (
                        <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-container-high overflow-hidden">
                            <div className="h-full bg-primary w-1/3 animate-pulse"></div>
                        </div>
                    )}
                </section>

                {/* Interactive Training Loop Split Screen */}
                {fileName ? (
                    <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter h-[600px]">
                        {/* Left: Raw Input */}
                        <div className="flex flex-col border border-outline-variant rounded bg-surface-container-lowest overflow-hidden">
                            <div className="bg-surface-container px-4 py-2 border-b border-outline-variant flex justify-between items-center">
                                <span className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2">
                                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">terminal</span>
                                    Raw Input Stream
                                </span>
                                <span className="font-data-mono text-data-mono text-[11px] text-on-surface-variant">{fileName}</span>
                            </div>
                            <div className="flex-1 bg-[#1e293b] p-4 overflow-y-auto font-data-mono text-data-mono text-[13px] text-slate-300 leading-relaxed selection:bg-slate-700">
                                <pre><code>
                                    {lines.map((line, idx) => {
                                        const ln = idx + 1;
                                        const finding = findingByLine.get(ln);
                                        const isActiveLine = active?.line_number === ln;
                                        let cls = '';
                                        if (isActiveLine) cls = 'bg-yellow-500/20 text-yellow-300 px-1 rounded';
                                        else if (finding?.status === 'confirmed') cls = 'bg-[#15803d]/15 text-[#86efac] px-1 rounded';
                                        else if (finding?.status === 'ignored') cls = 'text-slate-500 line-through decoration-slate-600 px-1';
                                        else if (finding) cls = 'bg-slate-500/10 px-1 rounded';
                                        return (
                                            <span key={ln} className={cls}>
                                                {line}
                                                {'\n'}
                                            </span>
                                        );
                                    })}
                                </code></pre>
                            </div>
                        </div>

                        {/* Right: Mapping Canvas */}
                        <div className="flex flex-col border border-outline-variant rounded bg-surface-container-lowest overflow-hidden">
                            <div className="bg-surface-container px-4 py-2 border-b border-outline-variant flex justify-between items-center">
                                <span className="font-label-caps text-label-caps text-on-surface-variant flex items-center gap-2">
                                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">schema</span>
                                    Semantic Mapping
                                    {items.length > 0 && (
                                        <span className="text-on-surface-variant">({reviewedCount}/{items.length} reviewed)</span>
                                    )}
                                </span>
                                <button aria-label="Re-scan file" onClick={rescan} disabled={isParsing} className="text-primary hover:opacity-70 transition-opacity disabled:opacity-40">
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                </button>
                            </div>
                            <div className="flex-1 p-stack-md overflow-y-auto bg-surface-bright flex flex-col gap-stack-md">
                                <div className="font-body-sm text-body-sm text-on-surface-variant mb-2">
                                    {items.length === 0
                                        ? 'No recognized security-relevant directives were found in this file.'
                                        : 'Each match below was found by a rule-based scan of the raw config - review and confirm or ignore each one.'}
                                </div>

                                {active ? (
                                    <div className="border border-outline-variant rounded p-4 bg-surface-container-lowest shadow-sm transition-all">
                                        <div className="font-data-mono text-data-mono text-primary bg-surface-container px-2 py-1 rounded inline-block mb-3 border border-outline-variant">
                                            {active.snippet}
                                        </div>
                                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center">
                                            <label className="font-label-caps text-label-caps text-on-surface-variant text-right">Parameter</label>
                                            <div className="font-body-sm text-body-sm text-on-surface font-medium">{active.parameter}</div>

                                            <label className="font-label-caps text-label-caps text-on-surface-variant text-right">Risk Tag</label>
                                            <div className="flex gap-2 flex-wrap items-center">
                                                <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-label-caps bg-secondary-container text-on-secondary-container">{active.risk_tag}</span>
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-label-caps ${SEVERITY_STYLES[active.severity].badge}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_STYLES[active.severity].dot}`}></span>
                                                    {SEVERITY_STYLES[active.severity].label}
                                                </span>
                                            </div>

                                            <label className="font-label-caps text-label-caps text-on-surface-variant text-right">Confidence</label>
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 h-1 bg-surface-variant rounded-full overflow-hidden">
                                                    <div className="h-full bg-primary" style={{ width: `${Math.round(active.confidence * 100)}%` }}></div>
                                                </div>
                                                <span className="font-data-mono text-data-mono text-on-surface-variant">{Math.round(active.confidence * 100)}%</span>
                                            </div>

                                            <label className="font-label-caps text-label-caps text-on-surface-variant text-right">Line</label>
                                            <div className="font-data-mono text-data-mono text-on-surface-variant text-[12px]">#{active.line_number}</div>
                                        </div>
                                        <p className="font-body-sm text-[12px] text-on-surface-variant mt-3 pt-3 border-t border-outline-variant italic">{active.rationale}</p>
                                        <div className="mt-4 flex justify-end gap-2">
                                            <button onClick={ignoreActive} className="font-body-sm text-body-sm px-3 py-1.5 text-on-surface-variant hover:text-primary transition-colors">Ignore</button>
                                            <button onClick={confirmActive} disabled={isConfirming} className="font-body-sm text-body-sm font-bold px-4 py-1.5 landing-cta-gradient rounded hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
                                                {isConfirming ? 'Confirming...' : 'Confirm Mapping'}
                                            </button>
                                        </div>
                                    </div>
                                ) : items.length > 0 ? (
                                    <div className="border border-dashed border-outline-variant rounded p-stack-lg flex flex-col items-center justify-center text-center bg-surface-container-lowest/50">
                                        <span aria-hidden="true" className="material-symbols-outlined text-[24px] text-[#15803d] mb-2">task_alt</span>
                                        <span className="font-body-sm text-body-sm text-on-surface-variant">
                                            All {items.length} finding{items.length === 1 ? '' : 's'} reviewed - {items.filter((i) => i.status === 'confirmed').length} confirmed, {items.filter((i) => i.status === 'ignored').length} ignored.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="border border-dashed border-outline-variant rounded p-stack-lg flex flex-col items-center justify-center text-center bg-surface-container-lowest/50 opacity-60">
                                        <span aria-hidden="true" className="material-symbols-outlined text-[24px] text-outline mb-2">search_off</span>
                                        <span className="font-body-sm text-body-sm text-on-surface-variant">Try a config with recognizable directives (uRPF, SNMP, port-security, BGP neighbors...).</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className="border border-dashed border-outline-variant rounded p-stack-lg text-center text-on-surface-variant font-body-sm text-body-sm opacity-70">
                        Upload a config file above to see raw input and proposed mappings here.
                    </div>
                )}
                {fileName && !reviewComplete && (
                    <div className="border border-dashed border-outline-variant rounded-xl p-stack-lg text-center bg-surface-container-lowest/50 flex flex-col items-center gap-2">
                        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-primary animate-pulse">schema</span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
                            Confirm or ignore each finding on the right first - your risk sandbox and Monte Carlo simulation will appear here once all {items.length} are reviewed ({reviewedCount}/{items.length} so far).
                        </p>
                    </div>
                )}

                {/* Full Simulation Sandbox - the exact same working
                    dashboard the demo Overview page runs (budget slider,
                    Strategic Controls, ALE/VaR/Loss Distribution,
                    Explainable Risk Attribution, Business Unit breakdown),
                    just calibrated on what's actually been ingested and
                    confirmed here instead of demo telemetry. Appears once
                    a file is uploaded and recalculates every time a
                    mapping is confirmed or a control is toggled. */}
                {fileName && reviewComplete && (
                    <section className="animate-fade-scale-in">
                        <div className="mb-stack-md">
                            <h2 className="font-headline-sm text-headline-sm landing-font landing-heading-gradient">Your Risk Sandbox</h2>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">Same FAIR engine as the demo dashboard - calibrated only on the data you ingest and confirm here.</p>
                        </div>
                        <div ref={resultsRef}>
                        <RiskSandbox
                            runVersion={resultVersion}
                            sandboxMode="whatIf"
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
                    </section>
                )}
            </div>
        </>
    );
}

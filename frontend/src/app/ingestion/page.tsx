"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { API_BASE, fetchWithRetry } from '@/lib/api';

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

export default function IngestionPage() {
    const { token } = useAuth();
    const { showToast } = useToast();

    const [fileName, setFileName] = useState<string | null>(null);
    const [rawContent, setRawContent] = useState<string>('');
    const [items, setItems] = useState<ReviewItem[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [trainedCount, setTrainedCount] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchTrainedCount = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/ingest/mappings`);
            if (!res.ok) return;
            const data = await res.json();
            setTrainedCount(typeof data.count === 'number' ? data.count : null);
        } catch {
            // Non-critical - the counter just stays blank if this fails.
        }
    }, []);

    useEffect(() => {
        fetchTrainedCount();
    }, [fetchTrainedCount]);

    const activeIndex = items.findIndex((it) => it.status === 'pending');
    const active = activeIndex >= 0 ? items[activeIndex] : null;
    const reviewedCount = items.filter((it) => it.status !== 'pending').length;

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
                showToast(`Could not parse file: ${data.detail || res.status}`, 'error');
                return;
            }
            setFileName(name);
            setRawContent(data.raw_content);
            const findings: Finding[] = data.findings || [];
            setItems(findings.map((f) => ({ ...f, status: 'pending' as const })));
            if (findings.length === 0) {
                showToast('Parsed the file, but found no recognized security-relevant directives in it.', 'info');
            } else {
                showToast(`Found ${findings.length} candidate mapping${findings.length === 1 ? '' : 's'} to review.`, 'success');
            }
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error');
        } finally {
            setIsParsing(false);
        }
    }, [showToast]);

    const handleFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            parseText(file.name, text);
        };
        reader.onerror = () => showToast('Could not read that file.', 'error');
        reader.readAsText(file);
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
                showToast(`Could not confirm mapping: ${data.detail || res.status}`, 'error');
                return;
            }
            setItems((prev) => prev.map((it, i) => (i === activeIndex ? { ...it, status: 'confirmed' } : it)));
            // Confirmed control_gap findings feed directly into the FAIR risk
            // calc as an always-on Control Strength deduction (see
            // backend/risk_engine.py::derive_fair_inputs) - the toast makes
            // that visible instead of implying this is just a label saved
            // for later training.
            showToast(
                active.kind === 'control_gap'
                    ? `Gap confirmed: ${active.parameter} - this will raise simulated risk on the Overview dashboard.`
                    : `Mapping trained: ${active.parameter}`,
                'success'
            );
            fetchTrainedCount();
        } catch (e) {
            console.error(e);
            showToast('Error contacting backend. Is it running on port 8000?', 'error');
        } finally {
            setIsConfirming(false);
        }
    };

    const ignoreActive = () => {
        if (!active) return;
        setItems((prev) => prev.map((it, i) => (i === activeIndex ? { ...it, status: 'ignored' } : it)));
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
                        <h1 className="font-headline-md text-headline-md text-primary">Ingestion Engine</h1>
                        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                            Upload a raw device config; a rule-based parser finds the security-relevant lines and proposes standard compliance mappings for you to confirm.
                        </p>
                    </div>
                    {trainedCount !== null && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-primary">model_training</span>
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
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.cfg,.conf,.json,.log"
                        className="hidden"
                        onChange={onFileInputChange}
                    />
                    <div className="max-w-md mx-auto">
                        <span className="material-symbols-outlined text-[48px] text-outline mb-stack-md" style={{ fontVariationSettings: "'wght' 200" }}>cloud_upload</span>
                        <h2 className="font-title-lg text-title-lg text-primary mb-2">Upload Configuration Files</h2>
                        <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Drag and drop a raw text config file - Cisco IOS or SONiC-style device configs both parse correctly.</p>
                        <div className="flex items-center justify-center gap-stack-md">
                            <button onClick={onBrowseClick} className="border border-outline-variant text-primary font-body-sm text-body-sm px-4 py-2 rounded hover:border-primary transition-colors bg-surface-container-lowest">
                                Browse Files
                            </button>
                            <span className="font-body-sm text-body-sm text-on-surface-variant">or drag a file here</span>
                        </div>
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
                                    <span className="material-symbols-outlined text-[16px]">terminal</span>
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
                                    <span className="material-symbols-outlined text-[16px]">schema</span>
                                    Semantic Mapping
                                    {items.length > 0 && (
                                        <span className="text-on-surface-variant">({reviewedCount}/{items.length} reviewed)</span>
                                    )}
                                </span>
                                <button aria-label="Re-scan file" onClick={rescan} disabled={isParsing} className="text-primary hover:opacity-70 transition-opacity disabled:opacity-40">
                                    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
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
                                            <button onClick={confirmActive} disabled={isConfirming} className="font-body-sm text-body-sm px-4 py-1.5 bg-primary text-on-primary rounded hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
                                                {isConfirming ? 'Confirming...' : 'Confirm Mapping'}
                                            </button>
                                        </div>
                                    </div>
                                ) : items.length > 0 ? (
                                    <div className="border border-dashed border-outline-variant rounded p-stack-lg flex flex-col items-center justify-center text-center bg-surface-container-lowest/50">
                                        <span className="material-symbols-outlined text-[24px] text-[#15803d] mb-2">task_alt</span>
                                        <span className="font-body-sm text-body-sm text-on-surface-variant">
                                            All {items.length} finding{items.length === 1 ? '' : 's'} reviewed - {items.filter((i) => i.status === 'confirmed').length} confirmed, {items.filter((i) => i.status === 'ignored').length} ignored.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="border border-dashed border-outline-variant rounded p-stack-lg flex flex-col items-center justify-center text-center bg-surface-container-lowest/50 opacity-60">
                                        <span className="material-symbols-outlined text-[24px] text-outline mb-2">search_off</span>
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
            </div>
        </>
    );
}

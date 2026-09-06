"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

interface Decision {
    id: number;
    action: string;
    risk_accepted: number;
    decided_by: string;
    created_at: string;
    tx_hash: string | null;
    on_chain: boolean;
    data_source?: string | null;
}

function truncateHash(hash: string) {
    if (hash.length <= 14) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export default function LedgerPage() {
    const { token, username } = useAuth();
    const { showToast } = useToast();
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [clearError, setClearError] = useState<string | null>(null);

    // Judge-day "reset everything" - see backend/main.py::reset_demo. Kept
    // separate from isClearModalOpen/isClearing above since this is a much
    // bigger blast radius (every dashboard's ledger, calibration/training
    // history, and ingestion mappings, not just this one ledger) and needs
    // its own confirm copy so nobody mistakes it for "Clear Ledger".
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const [committingId, setCommittingId] = useState<number | null>(null);

    // [Separate ledgers per dashboard] Demo (Overview) and Own Data
    // (Ingestion Engine) each get their own ledger now instead of one
    // undifferentiated table - which one this account is currently on
    // decides which ledger loads here, read the same hydration-safe way
    // SharedLayout does (crq_data_source:<username>) so this never
    // flashes the wrong dashboard's decisions before settling.
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
            // localStorage unavailable - fall back to the demo ledger.
        }
        setDataSourceHydrated(true);
    }, [username]);

    const fetchLedger = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log?data_source=${dataSource}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions(data.data || []);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not load the audit ledger. Is the backend running on port 8000?');
        } finally {
            setIsLoading(false);
        }
    }, [dataSource]);

    useEffect(() => {
        if (!dataSourceHydrated) return;
        fetchLedger();

        // Defense in depth against the Next.js Router Cache serving a
        // stale snapshot of this page after navigating away and back (e.g.
        // right after logging a decision from Overview) - also covers
        // switching back to this tab from another one.
        const onFocus = () => fetchLedger();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') fetchLedger();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [dataSourceHydrated, fetchLedger]);

    const clearLedger = async () => {
        setClearError(null);
        if (!token) {
            const message = 'You need to be logged in as CISO or CFO (top-right corner) to clear the ledger.';
            setClearError(message);
            showToast(message, 'error');
            return;
        }
        setIsClearing(true);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log?data_source=${dataSource}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions([]);
            setIsClearModalOpen(false);
            showToast(`Cleared ${data.deleted} decision${data.deleted === 1 ? '' : 's'} from the ${dataSource === 'own' ? 'Own Data' : 'Demo'} ledger - back to 0.`, 'success');
        } catch (e: any) {
            console.error(e);
            const message = e.message || 'Could not clear the ledger. Is the backend running on port 8000?';
            setClearError(message);
            showToast(message, 'error');
        } finally {
            setIsClearing(false);
        }
    };

    const resetDemo = async () => {
        setResetError(null);
        if (!token) {
            const message = 'You need to be logged in as CISO or CFO (top-right corner) to reset the demo.';
            setResetError(message);
            showToast(message, 'error');
            return;
        }
        setIsResetting(true);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/reset-demo`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions([]);
            setIsResetModalOpen(false);
            showToast('Demo reset to pristine state - fresh demo and own-data fleets regenerated.', 'success');
            fetchLedger();
        } catch (e: any) {
            console.error(e);
            const message = e.message || 'Could not reset the demo. Is the backend running on port 8000?';
            setResetError(message);
            showToast(message, 'error');
        } finally {
            setIsResetting(false);
        }
    };

    const copyHash = (id: number, hash: string) => {
        navigator.clipboard?.writeText(hash).catch(() => {});
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    // [Opt-in blockchain commit] Accepting a risk on Overview only ever
    // writes the decision off-chain now - this is the explicit choice the
    // user makes here, per decision, once they've reviewed it in the
    // ledger: commit it to the AuditLedger smart contract, or leave it
    // off-chain. Mirrors backend/main.py's POST
    // /api/audit-log/{id}/commit-chain, which no longer fires
    // automatically in the background on every acceptance.
    const connectToBlockchain = async (id: number) => {
        if (!token) {
            showToast('You need to be logged in as CISO or CFO (top-right corner) to commit a decision on-chain.', 'error');
            return;
        }
        setCommittingId(id);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log/${id}/commit-chain`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions((prev) => prev.map((d) => (d.id === id ? { ...d, tx_hash: data.tx_hash, on_chain: true } : d)));
            showToast(`Decision #${id} committed on-chain.`, 'success');
        } catch (e: any) {
            console.error(e);
            showToast(e.message || `Could not reach the blockchain. The decision stays logged off-chain - try again shortly.`, 'error');
        } finally {
            setCommittingId(null);
        }
    };

    const totalRisk = decisions.reduce((sum, d) => sum + (d.risk_accepted || 0), 0);
    const onChainCount = decisions.filter((d) => d.on_chain).length;

    return (
        <div className="max-w-[1100px] mx-auto flex flex-col gap-stack-lg">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
                <div>
                    <h1 className="font-headline-md text-headline-md landing-font landing-heading-gradient mb-1">
                        {dataSource === 'own' ? 'Own Data Ledger' : 'Demo Ledger'}
                    </h1>
                    <p className="font-body-md text-body-md text-on-surface-variant">
                        {dataSource === 'own'
                            ? "Every risk-acceptance decision logged from your ingested data, persisted to the database and kept separate from the demo dashboard's ledger below."
                            : 'Every risk-acceptance decision logged from the demo dashboard, persisted to the database and kept separate from the Own Data ledger.'}
                        {' '}Review one and choose whether to commit it to the on-chain audit trail.
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={fetchLedger}
                            disabled={isLoading}
                            className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${isLoading ? 'animate-spin' : ''}`}>refresh</span>
                            Refresh
                        </button>
                        <button
                            onClick={() => { setClearError(null); setIsClearModalOpen(true); }}
                            disabled={isLoading || decisions.length === 0 || !token}
                            title={!token ? 'Log in first (top-right corner) to clear the ledger' : 'Delete every logged decision and reset to 0'}
                            className="border border-outline-variant text-error bg-surface hover:bg-error/10 hover:border-error px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-40 disabled:hover:bg-surface disabled:hover:border-outline-variant whitespace-nowrap"
                        >
                            <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                            Clear Ledger
                        </button>
                        <button
                            onClick={() => { setResetError(null); setIsResetModalOpen(true); }}
                            disabled={isLoading || !token}
                            title={!token ? 'Log in first (top-right corner) to reset the demo' : 'Reset every dashboard back to a pristine, freshly-seeded state'}
                            className="border border-outline-variant text-error bg-surface hover:bg-error/10 hover:border-error px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-40 disabled:hover:bg-surface disabled:hover:border-outline-variant whitespace-nowrap"
                        >
                            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                            Reset Full Demo
                        </button>
                    </div>
                    {!token && decisions.length > 0 && (
                        <span className="font-label-caps text-label-caps text-on-surface-variant">Log in (top-right) to enable Clear Ledger</span>
                    )}
                </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                    <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Total Decisions</div>
                    <div className="font-headline-md text-headline-md text-primary font-data-mono">{decisions.length}</div>
                </div>
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                    <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Total Risk Accepted</div>
                    <div className="font-headline-md text-headline-md text-primary font-data-mono">₹{(totalRisk / 10000000).toFixed(2)} Cr</div>
                </div>
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                    <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Committed On-Chain</div>
                    <div className="font-headline-md text-headline-md text-[#15803d] font-data-mono">{onChainCount} / {decisions.length}</div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
                {isLoading ? (
                    <div className="p-gutter flex flex-col gap-stack-sm">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="h-10 bg-surface-container-low rounded animate-pulse" />
                        ))}
                    </div>
                ) : error ? (
                    <div className="p-gutter text-center">
                        <p className="font-body-sm text-body-sm text-error">{error}</p>
                    </div>
                ) : decisions.length === 0 ? (
                    <div className="p-gutter text-center">
                        <span className="material-symbols-outlined text-[40px] text-outline mb-2">receipt_long</span>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                            No {dataSource === 'own' ? 'own-data' : 'demo'} risk decisions logged yet - click &quot;Accept Risk&quot; on the {dataSource === 'own' ? 'Ingestion Engine' : 'Overview'} page to create one.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface-container-low border-b border-outline-variant">
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">#</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Action</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Risk Accepted</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Decided By</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Date</th>
                                    <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant">Chain Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {decisions.map((d) => (
                                    <tr key={d.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low transition-colors animate-fade-scale-in">
                                        <td className="py-3 px-4 font-data-mono text-data-mono text-on-surface-variant">#{d.id}</td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm">{d.action}</td>
                                        <td className="py-3 px-4 font-data-mono text-data-mono font-bold">₹{(d.risk_accepted / 10000000).toFixed(2)} Cr</td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm">
                                            <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded font-label-caps text-label-caps">{d.decided_by}</span>
                                        </td>
                                        <td className="py-3 px-4 font-body-sm text-body-sm text-on-surface-variant">
                                            {new Date(d.created_at).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4">
                                            {d.on_chain && d.tx_hash ? (
                                                <button
                                                    onClick={() => copyHash(d.id, d.tx_hash!)}
                                                    title="Click to copy full transaction hash"
                                                    className="flex items-center gap-1 px-2 py-1 bg-[#15803d]/10 text-[#15803d] rounded font-data-mono text-data-mono hover:bg-[#15803d]/20 transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">link</span>
                                                    {copiedId === d.id ? 'Copied!' : truncateHash(d.tx_hash)}
                                                </button>
                                            ) : (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="flex items-center gap-1 px-2 py-1 bg-surface-container text-on-surface-variant rounded font-label-caps text-label-caps">
                                                        <span className="material-symbols-outlined text-[14px]">database</span>
                                                        Off-chain
                                                    </span>
                                                    <button
                                                        onClick={() => connectToBlockchain(d.id)}
                                                        disabled={committingId === d.id}
                                                        title={!token ? 'Log in (top-right) to commit this decision on-chain' : 'Commit this decision to the AuditLedger smart contract'}
                                                        className="flex items-center gap-1 px-2 py-1 landing-cta-gradient rounded font-label-caps text-label-caps font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap"
                                                    >
                                                        {committingId === d.id ? (
                                                            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                                        ) : (
                                                            <span className="material-symbols-outlined text-[14px]">link</span>
                                                        )}
                                                        {committingId === d.id ? 'Connecting...' : 'Connect to Blockchain'}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <a href={dataSource === 'own' ? '/ingestion' : '/overview'} className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>

            {isClearModalOpen && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => !isClearing && setIsClearModalOpen(false)}>
                    <div
                        className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter w-full max-w-md shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-stack-sm mb-stack-md">
                            <span className="material-symbols-outlined text-error text-[28px]">warning</span>
                            <div>
                                <h3 className="font-title-lg text-title-lg text-primary">Clear the entire ledger?</h3>
                                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                                    This permanently deletes all {decisions.length} logged decision{decisions.length === 1 ? '' : 's'} (database and on-chain status alike) and resets Total Decisions and Committed On-Chain back to 0. This cannot be undone.
                                </p>
                                {clearError && (
                                    <p className="font-body-sm text-body-sm text-error mt-stack-sm flex items-start gap-1">
                                        <span className="material-symbols-outlined text-[16px] mt-0.5">error</span>
                                        {clearError}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-stack-sm">
                            <button
                                onClick={() => { setIsClearModalOpen(false); setClearError(null); }}
                                disabled={isClearing}
                                className="px-4 py-2 border border-outline-variant text-on-surface rounded font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={clearLedger}
                                disabled={isClearing}
                                className="px-4 py-2 bg-error text-on-error rounded font-body-sm text-body-sm font-semibold hover:bg-opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
                            >
                                {isClearing && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                                {isClearing ? 'Clearing...' : 'Clear Ledger'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isResetModalOpen && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => !isResetting && setIsResetModalOpen(false)}>
                    <div
                        className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter w-full max-w-md shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-stack-sm mb-stack-md">
                            <span className="material-symbols-outlined text-error text-[28px]">warning</span>
                            <div>
                                <h3 className="font-title-lg text-title-lg text-primary">Reset the entire demo?</h3>
                                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                                    This permanently clears BOTH dashboards' audit ledgers and run history, every logged
                                    incident and calibration trend, all training completions, and every confirmed
                                    Ingestion Engine mapping - then regenerates a fresh demo fleet and a fresh own-data
                                    starter fleet. Use this between separate demo sessions so the next one starts from
                                    a clean slate. This cannot be undone.
                                </p>
                                {resetError && (
                                    <p className="font-body-sm text-body-sm text-error mt-stack-sm flex items-start gap-1">
                                        <span className="material-symbols-outlined text-[16px] mt-0.5">error</span>
                                        {resetError}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-stack-sm">
                            <button
                                onClick={() => { setIsResetModalOpen(false); setResetError(null); }}
                                disabled={isResetting}
                                className="px-4 py-2 border border-outline-variant text-on-surface rounded font-body-sm text-body-sm hover:bg-surface-container-low transition-colors disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={resetDemo}
                                disabled={isResetting}
                                className="px-4 py-2 bg-error text-on-error rounded font-body-sm text-body-sm font-semibold hover:bg-opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
                            >
                                {isResetting && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                                {isResetting ? 'Resetting...' : 'Reset Full Demo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

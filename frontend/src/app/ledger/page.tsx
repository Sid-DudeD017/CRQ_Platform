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
}

function truncateHash(hash: string) {
    if (hash.length <= 14) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export default function LedgerPage() {
    const { token } = useAuth();
    const { showToast } = useToast();
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [clearError, setClearError] = useState<string | null>(null);

    const fetchLedger = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions(data.data || []);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not load the audit ledger. Is the backend running on port 8000?');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
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
    }, [fetchLedger]);

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
            const res = await fetchWithRetry(`${API_BASE}/api/audit-log`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setDecisions([]);
            setIsClearModalOpen(false);
            showToast(`Cleared ${data.deleted} decision${data.deleted === 1 ? '' : 's'} - the ledger is back to 0.`, 'success');
        } catch (e: any) {
            console.error(e);
            const message = e.message || 'Could not clear the ledger. Is the backend running on port 8000?';
            setClearError(message);
            showToast(message, 'error');
        } finally {
            setIsClearing(false);
        }
    };

    const copyHash = (id: number, hash: string) => {
        navigator.clipboard?.writeText(hash).catch(() => {});
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    const totalRisk = decisions.reduce((sum, d) => sum + (d.risk_accepted || 0), 0);
    const onChainCount = decisions.filter((d) => d.on_chain).length;

    return (
        <div className="max-w-[1100px] mx-auto flex flex-col gap-stack-lg">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-stack-sm">
                <div>
                    <h1 className="font-headline-md text-headline-md text-primary mb-1">Detailed Ledger</h1>
                    <p className="font-body-md text-body-md text-on-surface-variant">
                        Every risk-acceptance decision, persisted to the database and committed to the on-chain audit trail where available.
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
                        <p className="font-body-sm text-body-sm text-on-surface-variant">No risk decisions logged yet - click &quot;Accept Risk&quot; on the Overview page to create one.</p>
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
                                                <span className="flex items-center gap-1 px-2 py-1 bg-surface-container text-on-surface-variant rounded font-label-caps text-label-caps">
                                                    <span className="material-symbols-outlined text-[14px]">database</span>
                                                    Off-chain
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
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
        </div>
    );
}

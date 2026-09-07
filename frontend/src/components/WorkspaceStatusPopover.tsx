"use client";
import React, { useEffect, useRef, useState } from 'react';
import type { ServiceStatus } from '@/lib/useServiceStatus';

/*
  [Product improvement #6 - clear workspace state]
  Previously the only always-visible workspace signal was this same badge
  (workspace name only) plus a red degraded-mode banner that only appears
  when the backend is unreachable or the database errors - AI fallback
  mode and blockchain unavailability were only ever surfaced next to the
  one feature each affects (the chat panel, the Ledger page), never in one
  place. This wraps the existing badge in a small popover that always
  answers, in one click: which workspace, which account, how fresh the
  status reading is, and the health of all three backing services -
  without changing what the collapsed badge looks like on the page.
*/

interface Props {
    workspaceLabel: string;
    workspaceIcon: string;
    workspaceDescription: string;
    account: string;
    serviceStatus: ServiceStatus | null;
    backendUnreachable: boolean;
}

function timeAgo(iso?: string): string {
    if (!iso) return 'unknown';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return 'unknown';
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function WorkspaceStatusPopover({ workspaceLabel, workspaceIcon, workspaceDescription, account, serviceStatus, backendUnreachable }: Props) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const backendOk = !backendUnreachable;
    const dbOk = serviceStatus?.database !== 'error';
    const aiOk = serviceStatus?.ai_agent === 'configured';
    const chainOk = serviceStatus?.blockchain === 'connected';
    const hasReading = !!serviceStatus || backendUnreachable;

    // Overall dot: red mirrors the same two conditions that trigger the
    // app-wide degraded-mode banner (backend unreachable / database
    // error) since those can break reads or writes anywhere; amber for a
    // secondary service running in fallback/unavailable mode; green when
    // everything checks out; gray before the first status reading lands.
    const dotColor = !hasReading
        ? 'bg-outline'
        : !backendOk || !dbOk
        ? 'bg-error'
        : !aiOk || !chainOk
        ? 'bg-[#d97706]'
        : 'bg-[#16a34a]';

    const rows: { label: string; value: string; ok: boolean | null; icon: string }[] = [
        { label: 'Workspace', value: workspaceLabel, ok: null, icon: workspaceIcon },
        { label: 'Account', value: account, ok: null, icon: 'person' },
        {
            label: 'Data freshness',
            value: serviceStatus ? `As of ${timeAgo(serviceStatus.timestamp)}` : (backendUnreachable ? 'Unknown - backend unreachable' : 'Checking...'),
            ok: null,
            icon: 'update',
        },
        { label: 'Backend', value: backendOk ? 'Online' : 'Unreachable', ok: hasReading ? backendOk : null, icon: 'dns' },
        { label: 'Database', value: dbOk ? 'Healthy' : 'Unavailable', ok: hasReading ? dbOk : null, icon: 'storage' },
        { label: 'AI (Virtual CISO)', value: aiOk ? 'Configured' : 'Fallback mode (no live model)', ok: hasReading ? aiOk : null, icon: 'smart_toy' },
        { label: 'Blockchain ledger', value: chainOk ? 'Connected' : 'Unavailable - decisions still logged off-chain', ok: hasReading ? chainOk : null, icon: 'link' },
    ];

    return (
        <div className="relative hidden sm:block" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="dialog"
                title="Workspace and system status"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-label-caps text-label-caps whitespace-nowrap transition-colors hover:border-primary ${
                    workspaceLabel === 'Own Data Workspace'
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-outline-variant bg-surface-container-low text-on-surface-variant'
                }`}
            >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{workspaceIcon}</span>
                {workspaceLabel}
                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                <span className="sr-only">
                    - {backendOk ? 'backend online' : 'backend unreachable'}{!dbOk ? ', database unavailable' : ''}{!aiOk ? ', AI in fallback mode' : ''}{!chainOk ? ', blockchain unavailable' : ''}. Activate for full workspace and system status.
                </span>
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label="Workspace and system status"
                    className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-surface border border-outline-variant rounded-lg shadow-2xl z-[60] p-3 animate-fade-scale-in"
                >
                    <p className="font-label-caps text-label-caps text-on-surface-variant mb-2 px-1">Workspace &amp; system status</p>
                    <dl className="flex flex-col gap-1.5">
                        {rows.map((r) => (
                            <div key={r.label} className="flex items-start justify-between gap-3 px-1 py-1 rounded hover:bg-surface-container-low">
                                <dt className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant shrink-0">
                                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{r.icon}</span>
                                    {r.label}
                                </dt>
                                <dd className={`font-body-sm text-body-sm text-right ${r.ok === false ? 'text-error font-semibold' : 'text-on-surface'}`}>
                                    {r.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="mt-2 pt-2 border-t border-outline-variant px-1 font-body-sm text-body-sm text-on-surface-variant">
                        {workspaceDescription}
                    </p>
                </div>
            )}
        </div>
    );
}

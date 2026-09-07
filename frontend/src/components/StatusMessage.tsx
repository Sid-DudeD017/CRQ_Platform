"use client";
import React from 'react';

/*
  [Product improvement #7 - failure and empty states]
  Every failure in this app previously surfaced as a single-line toast
  (see ToastContext) - fine for quick confirmations, but a toast
  disappears after 4.5s and only ever has room for "what went wrong", not
  "why", "what to do next", or the two questions that matter most after
  something fails: was my data saved, and is it safe to just try again.
  These two components are the persistent, in-page answer to all five for
  the failure states that matter most (a whole page/panel couldn't load
  its data, or a submission failed) - toasts stay in place for smaller,
  transient confirmations elsewhere.
*/

interface ErrorStateProps {
    title: string;
    whatHappened: string;
    whyItHappened?: string;
    nextStep: string;
    dataSaved?: 'yes' | 'no' | 'unknown';
    retrySafe?: boolean;
    onRetry?: () => void;
    retryLabel?: string;
}

export function ErrorState({ title, whatHappened, whyItHappened, nextStep, dataSaved, retrySafe, onRetry, retryLabel = 'Retry' }: ErrorStateProps) {
    return (
        <div role="alert" className="rounded-lg border border-error/40 bg-error-container text-on-error-container p-4 sm:p-5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px] mt-0.5 shrink-0">error</span>
                <div>
                    <p className="font-body-md text-body-md font-bold">{title}</p>
                    <p className="font-body-sm text-body-sm mt-1">{whatHappened}</p>
                    {whyItHappened && <p className="font-body-sm text-body-sm mt-1 opacity-90">{whyItHappened}</p>}
                    <p className="font-body-sm text-body-sm mt-1 font-semibold">{nextStep}</p>
                    {(dataSaved || retrySafe !== undefined) && (
                        <p className="font-body-sm text-body-sm mt-1 opacity-90">
                            {dataSaved === 'yes' && 'Your data up to this point was saved. '}
                            {dataSaved === 'no' && 'Nothing was saved - you\'ll need to re-enter it. '}
                            {dataSaved === 'unknown' && "We couldn't confirm whether this was saved - check before re-submitting. "}
                            {retrySafe === true && 'It is safe to retry.'}
                            {retrySafe === false && 'Avoid retrying until this is resolved, to prevent duplicate entries.'}
                        </p>
                    )}
                </div>
            </div>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="self-start mt-1 px-3 py-1.5 border border-current rounded font-label-caps text-label-caps hover:opacity-80 transition-opacity"
                >
                    {retryLabel}
                </button>
            )}
        </div>
    );
}

interface EmptyStateProps {
    icon?: string;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    actionHref?: string;
}

export function EmptyState({ icon = 'inbox', title, description, actionLabel, onAction, actionHref }: EmptyStateProps) {
    return (
        <div className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-8 flex flex-col items-center text-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[32px] text-on-surface-variant">{icon}</span>
            <p className="font-body-md text-body-md font-bold text-on-surface">{title}</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">{description}</p>
            {actionLabel && actionHref && (
                <a href={actionHref} className="mt-2 px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors">
                    {actionLabel}
                </a>
            )}
            {actionLabel && onAction && !actionHref && (
                <button onClick={onAction} className="mt-2 px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors">
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

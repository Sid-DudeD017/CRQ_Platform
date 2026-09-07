"use client";
import { useEffect } from 'react';
import { API_BASE } from './api';

/*
  [Observability fix - frontend error tracking]
  No third-party APM key (Sentry, etc.) is wired into this deployment, so
  without this, a client-side crash - a bad render, an unhandled promise
  rejection, a bug that only shows up in a real browser - was invisible to
  anyone but the one person watching their own browser console at the
  time. This registers global window.onerror/unhandledrejection handlers
  once, at the root layout, and reports each one to the backend's
  POST /api/client-error (see backend/main.py), which logs it
  structurally and counts it in GET /api/metrics. It is intentionally the
  simplest thing that actually gets a signal off the user's machine - not
  a replacement for a real APM if/when this deployment adds one.

  Best-effort only: the report itself is fire-and-forget (never blocks or
  re-throws), deduplicated per exact message+url so one crash looping in
  a render cycle can't spam the backend, and capped at a small number of
  reports per page load for the same reason.
*/

const MAX_REPORTS_PER_LOAD = 20;

export function ErrorTrackerInit() {
    useEffect(() => {
        let reportCount = 0;
        const seen = new Set<string>();

        const report = (message: string, stack?: string) => {
            if (reportCount >= MAX_REPORTS_PER_LOAD) return;
            const dedupeKey = `${message}::${window.location.pathname}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            reportCount += 1;
            try {
                const token = (() => {
                    try {
                        return localStorage.getItem('crq_token');
                    } catch {
                        return null;
                    }
                })();
                fetch(`${API_BASE}/api/client-error`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        message: message.slice(0, 2000),
                        stack: (stack || '').slice(0, 4000),
                        url: window.location.href,
                        user_agent: navigator.userAgent,
                    }),
                    // Never let a failing error-reporter itself throw or hang
                    // the page - this is best-effort telemetry, not a feature.
                    keepalive: true,
                }).catch(() => {});
            } catch {
                // Reporting must never itself throw.
            }
        };

        const onError = (event: ErrorEvent) => {
            report(event.message || 'Unknown window error', event.error?.stack);
        };
        const onRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = reason instanceof Error ? reason.message : String(reason);
            const stack = reason instanceof Error ? reason.stack : undefined;
            report(`Unhandled promise rejection: ${message}`, stack);
        };

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, []);

    return null;
}

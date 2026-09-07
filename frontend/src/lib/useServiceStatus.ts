"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from './api';

/*
  [No degraded-mode / service-health feedback - fix]
  Polls GET /api/status (see backend/main.py::get_status) so the app can
  tell the difference between "everything's fine", "the backend answered
  but something behind it is degraded" (database error, no LLM key,
  blockchain node unreachable), and "the backend itself can't be reached
  at all" - previously all three looked identical to a visitor: a generic
  toast on whatever action they happened to try next, or (for the AI
  agent) no signal at all.

  unreachable=true means the fetch itself failed (network error, backend
  not running) - the most common real "degraded mode" for this app (nobody
  started uvicorn). data=null while unreachable; once a request succeeds,
  data holds the last-known status so a transient blip doesn't erase it.
*/

export interface ServiceStatus {
    status: 'ok' | 'degraded';
    database: 'ok' | 'error';
    ai_agent: 'configured' | 'fallback';
    blockchain: 'connected' | 'unavailable';
    timestamp: string;
}

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 6_000;

export function useServiceStatus() {
    const [data, setData] = useState<ServiceStatus | null>(null);
    const [unreachable, setUnreachable] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const mountedRef = useRef(true);

    const checkNow = useCallback(async () => {
        setIsChecking(true);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(`${API_BASE}/api/status`, { signal: controller.signal });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const json = await res.json();
            if (!mountedRef.current) return;
            setData(json);
            setUnreachable(false);
        } catch (e) {
            if (!mountedRef.current) return;
            // Network error, timeout, or non-2xx - the backend can't be
            // reached at all right now (most commonly: it just isn't
            // running). Keep the last-known `data` around rather than
            // clearing it, so a brief blip doesn't flash the whole banner
            // between "everything's fine" and "unknown".
            setUnreachable(true);
        } finally {
            clearTimeout(timeout);
            if (mountedRef.current) setIsChecking(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        checkNow();
        const interval = setInterval(checkNow, POLL_INTERVAL_MS);
        const onFocus = () => checkNow();
        window.addEventListener('focus', onFocus);
        return () => {
            mountedRef.current = false;
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
        };
    }, [checkNow]);

    return { data, unreachable, isChecking, refresh: checkNow };
}

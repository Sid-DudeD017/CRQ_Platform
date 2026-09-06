// Single place the frontend gets the backend's base URL from. Defaults to
// localhost for local dev; set NEXT_PUBLIC_API_URL (e.g. in Vercel's
// project settings) to point a deployed frontend at a deployed backend.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// fetch() with one automatic retry on failure. Added after a live Neon
// Postgres cold-start (its free-tier compute suspends after a few minutes
// idle) caused a genuine 500 on the very first request after opening the
// app, which then succeeded immediately on retry - not a code bug, just a
// transient wake-up delay, but it looked exactly like a broken feature.
// Retries once, after a short delay, only on a network error or a 5xx
// server response - a 4xx (bad request, unauthorized, not found, etc.) is
// NOT retried, so it is returned immediately. On a 401 (invalid/expired
// token) it also dispatches a 'crq:session-expired' window event so
// AuthContext can force a clean logout instead of the app silently
// failing every subsequent request; the final attempt's Response/error is
// returned/thrown as-is so callers keep their existing res.ok / try-catch
// handling unchanged.
export async function fetchWithRetry(
    input: string,
    init?: RequestInit,
    retries = 1,
    delayMs = 1200
): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await fetch(input, init);
            if (res.status === 401 && typeof window !== 'undefined') {
                window.dispatchEvent(new Event('crq:session-expired'));
            }
            const isServerError = res.status >= 500;
            if (res.ok || !isServerError || attempt === retries) return res;
        } catch (e) {
            if (attempt === retries) throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
}

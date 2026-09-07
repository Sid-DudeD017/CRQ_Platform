"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { useToast } from './ToastContext';

function setSessionCookie(active: boolean) {
    if (typeof document === 'undefined') return;
    if (active) {
        const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `crq_session=1; path=/; max-age=${60 * 60 * 24}; SameSite=Lax${secure}`;
    } else {
        document.cookie = 'crq_session=; path=/; max-age=0; SameSite=Lax';
    }
}

// Minimal auth context so any page/component (e.g. the Accept Risk button)
// can grab a bearer token to call protected backend endpoints like
// /api/audit. Backed by two hardcoded demo exec accounts from
// backend/security.py - this is a hackathon demo, not a real login system.
// Token is kept in localStorage so it survives a page refresh.

type DemoRole = 'ciso' | 'cfo';

// [Public demo credentials exposed - fix] This used to hold the two demo
// accounts' real passwords in plaintext, which meant they were sitting in
// the shipped JS bundle for anyone to read (view-source, devtools, or the
// Support page which printed them directly) regardless of how well the
// passwords were guarded server-side. loginAs below now calls
// POST /api/auth/demo-login with just a role name - no password crosses
// the wire or lives in this file at all.

interface AuthContextValue {
    token: string | null;
    // False only for the brief instant before the localStorage-restore
    // effect below has run (or SSR, where localStorage doesn't exist at
    // all). Consumers MUST wait for this to be true before deciding
    // "there's no token, show the logged-out screen" - without it, a hard
    // refresh of a deep link (e.g. /optimize) briefly (or, on a slow
    // connection, not-so-briefly) rendered the public landing page even
    // though a valid session was sitting right there in localStorage,
    // because `token` starts as null on every fresh page load and the
    // effect that restores it hasn't run its first pass yet.
    isAuthReady: boolean;
    username: string | null;
    // Display name from the backend's User.name (signup's optional "Name"
    // field) - null for the two demo accounts and for anyone who signed up
    // without one. `username` is the login identifier (email, or "ciso"/
    // "cfo" for the demo accounts) and is NOT a display name - it was being
    // shown directly in "Welcome back, {username}" which meant a long email
    // address instead of an actual name.
    name: string | null;
    loginAs: (role: DemoRole) => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name?: string) => Promise<void>;
    logout: () => void;
    loginError: string | null;
    loggingInRole: DemoRole | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [name, setName] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [loggingInRole, setLoggingInRole] = useState<DemoRole | null>(null);
    const { showToast } = useToast();

    useEffect(() => {
        try {
            const savedToken = localStorage.getItem('crq_token');
            const savedUser = localStorage.getItem('crq_user');
            const savedName = localStorage.getItem('crq_name');
            if (savedToken && savedUser) {
                setToken(savedToken);
                setUsername(savedUser);
                setName(savedName || null);
                setSessionCookie(true);
            }
        } finally {
            setIsAuthReady(true);
        }
    }, []);

    // Guards against showing the "session expired" toast more than once
    // for a single expiry (fetchWithRetry dispatches the event on every
    // 401 it sees, and several requests can 401 around the same time).
    // Reset to false whenever a fresh login/signup succeeds below.
    const sessionExpiredRef = useRef(false);

    // fetchWithRetry (lib/api.ts) dispatches this on any 401 response,
    // which means the backend rejected the stored token as invalid or
    // expired. Force a clean logout instead of leaving the app in a state
    // where every subsequent request silently fails with 401.
    useEffect(() => {
        const handleSessionExpired = () => {
            if (sessionExpiredRef.current) return;
            sessionExpiredRef.current = true;
            setToken(null);
            setUsername(null);
            setName(null);
            setLoginError(null);
            localStorage.removeItem('crq_token');
            localStorage.removeItem('crq_user');
            localStorage.removeItem('crq_name');
            setSessionCookie(false);
            showToast('Your session expired - please log in again.', 'error');
        };
        window.addEventListener('crq:session-expired', handleSessionExpired);
        return () => window.removeEventListener('crq:session-expired', handleSessionExpired);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loginAs = async (role: DemoRole) => {
        setLoginError(null);
        setLoggingInRole(role);
        try {
            // [Public demo credentials exposed - fix] No password sent or
            // stored here at all - see backend/main.py::demo_login. If
            // DEMO_ACCOUNTS_ENABLED=false on the backend, this now fails
            // with a clear 403 instead of a generic login error.
            const res = await fetch(`${API_BASE}/api/auth/demo-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || `Login failed (${res.status})`);
            }

            const data = await res.json();
            setToken(data.access_token);
            setUsername(role);
            setName(null);
            localStorage.setItem('crq_token', data.access_token);
            localStorage.setItem('crq_user', role);
            localStorage.removeItem('crq_name');
            setSessionCookie(true);
            sessionExpiredRef.current = false;
            showToast(`Logged in as ${role.toUpperCase()}.`, 'success');
        } catch (e: any) {
            console.error('Login error:', e);
            const message = e?.message && e.message !== 'Login failed (undefined)'
                ? e.message
                : 'Could not log in. Is the backend running on port 8000?';
            setLoginError(message);
            showToast(message, 'error');
        } finally {
            setLoggingInRole(null);
        }
    };

    // Real, persisted-account login - checks backend/main.py's
    // /api/auth/login, which now falls back to the User table (created via
    // signup() below) when the credentials aren't one of the two demo
    // accounts. Throws on failure so the caller (AuthScreen) can show the
    // real error message inline instead of this context guessing a UI.
    const login = async (email: string, password: string) => {
        const body = new URLSearchParams();
        body.append('username', email.trim());
        body.append('password', password);
        body.append('grant_type', 'password');

        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || `Login failed (${res.status})`);
        }
        const resolvedUser = data.email || email.trim();
        setToken(data.access_token);
        setUsername(resolvedUser);
        setName(data.name || null);
        localStorage.setItem('crq_token', data.access_token);
        localStorage.setItem('crq_user', resolvedUser);
        if (data.name) localStorage.setItem('crq_name', data.name);
        else localStorage.removeItem('crq_name');
        setSessionCookie(true);
        sessionExpiredRef.current = false;
        showToast(`Welcome back${data.name ? ', ' + data.name : ''}.`, 'success');
    };

    // Creates a real account via POST /api/auth/signup (persisted in the
    // backend's User table - see backend/models.py) and logs it straight
    // in, since the backend returns an access token on successful signup.
    const signup = async (email: string, password: string, name?: string) => {
        const res = await fetch(`${API_BASE}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password, name: name || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || `Sign up failed (${res.status})`);
        }
        const resolvedUser = data.email || email.trim();
        setToken(data.access_token);
        setUsername(resolvedUser);
        setName(data.name || null);
        localStorage.setItem('crq_token', data.access_token);
        localStorage.setItem('crq_user', resolvedUser);
        if (data.name) localStorage.setItem('crq_name', data.name);
        else localStorage.removeItem('crq_name');
        setSessionCookie(true);
        sessionExpiredRef.current = false;
        showToast(`Account created${data.name ? ', welcome ' + data.name : ''}.`, 'success');
    };

    const logout = () => {
        setToken(null);
        setUsername(null);
        setName(null);
        setLoginError(null);
        localStorage.removeItem('crq_token');
        localStorage.removeItem('crq_user');
        localStorage.removeItem('crq_name');
        setSessionCookie(false);
        showToast('Logged out.', 'info');
    };

    return (
        <AuthContext.Provider value={{ token, isAuthReady, username, name, loginAs, login, signup, logout, loginError, loggingInRole }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
}

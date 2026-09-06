"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { useToast } from './ToastContext';

// Minimal auth context so any page/component (e.g. the Accept Risk button)
// can grab a bearer token to call protected backend endpoints like
// /api/audit. Backed by two hardcoded demo exec accounts from
// backend/security.py - this is a hackathon demo, not a real login system.
// Token is kept in localStorage so it survives a page refresh.

type DemoRole = 'ciso' | 'cfo';

const DEMO_CREDENTIALS: Record<DemoRole, { username: string; password: string }> = {
    ciso: { username: 'ciso', password: 'demo-ciso-pass' },
    cfo: { username: 'cfo', password: 'demo-cfo-pass' },
};

interface AuthContextValue {
    token: string | null;
    username: string | null;
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
    const [username, setUsername] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [loggingInRole, setLoggingInRole] = useState<DemoRole | null>(null);
    const { showToast } = useToast();

    useEffect(() => {
        const savedToken = localStorage.getItem('crq_token');
        const savedUser = localStorage.getItem('crq_user');
        if (savedToken && savedUser) {
            setToken(savedToken);
            setUsername(savedUser);
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
            setLoginError(null);
            localStorage.removeItem('crq_token');
            localStorage.removeItem('crq_user');
            showToast('Your session expired - please log in again.', 'error');
        };
        window.addEventListener('crq:session-expired', handleSessionExpired);
        return () => window.removeEventListener('crq:session-expired', handleSessionExpired);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loginAs = async (role: DemoRole) => {
        setLoginError(null);
        setLoggingInRole(role);
        const creds = DEMO_CREDENTIALS[role];
        try {
            const body = new URLSearchParams();
            body.append('username', creds.username);
            body.append('password', creds.password);
            body.append('grant_type', 'password');

            const res = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!res.ok) {
                throw new Error(`Login failed (${res.status})`);
            }

            const data = await res.json();
            setToken(data.access_token);
            setUsername(creds.username);
            localStorage.setItem('crq_token', data.access_token);
            localStorage.setItem('crq_user', creds.username);
            sessionExpiredRef.current = false;
            showToast(`Logged in as ${creds.username.toUpperCase()}.`, 'success');
        } catch (e: any) {
            console.error('Login error:', e);
            const message = 'Could not log in. Is the backend running on port 8000?';
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
        localStorage.setItem('crq_token', data.access_token);
        localStorage.setItem('crq_user', resolvedUser);
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
        localStorage.setItem('crq_token', data.access_token);
        localStorage.setItem('crq_user', resolvedUser);
        sessionExpiredRef.current = false;
        showToast(`Account created${data.name ? ', welcome ' + data.name : ''}.`, 'success');
    };

    const logout = () => {
        setToken(null);
        setUsername(null);
        setLoginError(null);
        localStorage.removeItem('crq_token');
        localStorage.removeItem('crq_user');
        showToast('Logged out.', 'info');
    };

    return (
        <AuthContext.Provider value={{ token, username, loginAs, login, signup, logout, loginError, loggingInRole }}>
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

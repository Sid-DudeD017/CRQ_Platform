"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

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
    logout: () => void;
    loginError: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(null);
    const [username, setUsername] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);

    useEffect(() => {
        const savedToken = localStorage.getItem('crq_token');
        const savedUser = localStorage.getItem('crq_user');
        if (savedToken && savedUser) {
            setToken(savedToken);
            setUsername(savedUser);
        }
    }, []);

    const loginAs = async (role: DemoRole) => {
        setLoginError(null);
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
        } catch (e: any) {
            console.error('Login error:', e);
            setLoginError('Could not log in. Is the backend running on port 8000?');
        }
    };

    const logout = () => {
        setToken(null);
        setUsername(null);
        localStorage.removeItem('crq_token');
        localStorage.removeItem('crq_user');
    };

    return (
        <AuthContext.Provider value={{ token, username, loginAs, logout, loginError }}>
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

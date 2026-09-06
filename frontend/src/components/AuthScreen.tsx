"use client";
import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';

// The gate SharedLayout renders instead of the whole app when there's no
// token yet - see the `if (!token) return <AuthScreen />;` in
// SharedLayout.tsx. Toggles between a real login form and a real signup
// form, both backed by backend/main.py's /api/auth/login and
// /api/auth/signup (persisted in the User table - backend/models.py), plus
// the pre-existing two-demo-account quick login kept underneath for judges
// who don't want to register an account first.
export default function AuthScreen({
    initialMode = 'login',
    onBack,
}: {
    initialMode?: 'login' | 'signup';
    onBack?: () => void;
}) {
    const { login, signup, loginAs, loggingInRole } = useAuth();
    const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const switchMode = (next: 'login' | 'signup') => {
        setMode(next);
        setError(null);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (mode === 'signup') {
                await signup(email, password, name.trim() || undefined);
            } else {
                await login(email, password);
            }
        } catch (err: any) {
            setError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen bg-background text-on-background flex items-center justify-center p-4 overflow-hidden">
            <div className="ambient-glow" aria-hidden="true" />
            <div className="relative z-10 w-full max-w-md">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="mb-stack-sm flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors font-body-sm text-body-sm"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span> Back to home
                    </button>
                )}
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl p-gutter animate-fade-scale-in">
                <div className="flex items-center gap-3 mb-stack-lg">
                    <div className="w-11 h-11 rounded-full brand-gradient text-white flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined">{mode === 'signup' ? 'person_add' : 'shield_person'}</span>
                    </div>
                    <div>
                        <h1 className="font-title-lg text-title-lg font-bold text-primary">
                            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
                        </h1>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                            {mode === 'signup' ? 'Set up access to the CRQ Platform.' : 'Log in to continue to your dashboard.'}
                        </p>
                    </div>
                </div>

                <form onSubmit={submit} className="flex flex-col gap-stack-md">
                    {mode === 'signup' && (
                        <div>
                            <label className="font-body-sm text-body-sm font-medium block mb-1">Name (optional)</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Jane Doe"
                                className="w-full bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
                            />
                        </div>
                    )}
                    <div>
                        <label className="font-body-sm text-body-sm font-medium block mb-1">Email</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@company.com"
                            className="w-full bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
                        />
                    </div>
                    <div>
                        <label className="font-body-sm text-body-sm font-medium block mb-1">Password</label>
                        <input
                            type="password"
                            required
                            minLength={mode === 'signup' ? 6 : undefined}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                            className="w-full bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
                        />
                    </div>

                    {error && <p className="text-error font-body-sm text-body-sm">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full brand-gradient text-white font-body-sm text-body-sm py-3 rounded font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {loading && <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
                        {loading ? (mode === 'signup' ? 'Creating account...' : 'Logging in...') : (mode === 'signup' ? 'Create account' : 'Log in')}
                    </button>
                </form>

                <p className="text-center font-body-sm text-body-sm text-on-surface-variant mt-stack-md">
                    {mode === 'signup' ? (
                        <>
                            Already have an account?{' '}
                            <button type="button" onClick={() => switchMode('login')} className="text-primary font-semibold hover:underline">Log in</button>
                        </>
                    ) : (
                        <>
                            Don&apos;t have an account?{' '}
                            <button type="button" onClick={() => switchMode('signup')} className="text-primary font-semibold hover:underline">Register</button>
                        </>
                    )}
                </p>

                <div className="mt-stack-lg pt-stack-md border-t border-outline-variant">
                    <p className="text-center font-label-caps text-label-caps text-on-surface-variant mb-2">Or try a demo account</p>
                    <div className="flex items-center justify-center gap-2">
                        <button
                            onClick={() => loginAs('ciso')}
                            disabled={loggingInRole !== null}
                            className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors disabled:opacity-60 flex items-center gap-1"
                        >
                            {loggingInRole === 'ciso' && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                            Demo CISO
                        </button>
                        <button
                            onClick={() => loginAs('cfo')}
                            disabled={loggingInRole !== null}
                            className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors disabled:opacity-60 flex items-center gap-1"
                        >
                            {loggingInRole === 'cfo' && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                            Demo CFO
                        </button>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
}

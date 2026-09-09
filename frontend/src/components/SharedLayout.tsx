"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { API_BASE } from '@/lib/api';
import { formatRupeesCr, formatRupeesExact } from '@/lib/format';
import { useServiceStatus } from '@/lib/useServiceStatus';
import VirtualCisoChat from './VirtualCisoChat';
import WorkspaceStatusPopover from './WorkspaceStatusPopover';
import CommandPalette from './CommandPalette';
import AuthScreen from './AuthScreen';
import LandingPage from './LandingPage';

export default function SharedLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { token, isAuthReady, username, name, loginAs, logout, loginError, loggingInRole } = useAuth();
    // [No degraded-mode / service-health feedback - fix] Polled once here,
    // in the root layout every protected page shares, so a backend/
    // database/blockchain problem is visible everywhere instead of only
    // surfacing as a one-off toast on whatever action a visitor happens
    // to try next.
    const { data: serviceStatus, unreachable: backendUnreachable, refresh: refreshServiceStatus } = useServiceStatus();
    const { theme, toggleTheme } = useTheme();
    // Prefer a real display name; demo accounts (ciso/cfo) and anyone who
    // signed up without a name have none, so fall back to the email's
    // local-part rather than the whole address - showing the full email in
    // "Welcome back, ..." was overflowing/getting clipped on the Home tab.
    const displayName = name || (username && username.includes('@') ? username.split('@')[0] : username);

    // Scroll-to-top: shown once the page is scrolled down a bit, on every
    // dashboard page (this component wraps all of them via {children}
    // below), so there's always a quick way back up no matter how far the
    // user has scrolled.
    const [showScrollTop, setShowScrollTop] = useState(false);
    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const [authView, setAuthView] = useState<'landing' | 'login' | 'signup'>('landing');
    // [Clear flow of work] Right after login, before any dashboard route
    // ever renders, everyone picks demo data or their own data exactly
    // once - as a real page, not a popup over a half-loaded dashboard.
    // dataSourceHydrated is false only for the brief instant before the
    // effect below has read localStorage (avoids an SSR/client hydration
    // mismatch, same pattern AuthContext uses for token/username);
    // dataSource is null once hydrated if no choice has been made yet,
    // otherwise 'predefined' or 'own' - which also decides which nav the
    // full dashboard shows (Overview for demo, Ingestion for own data).
    const [dataSourceHydrated, setDataSourceHydrated] = useState(false);
    const [dataSource, setDataSource] = useState<'predefined' | 'own' | null>(null);
    // The choice is per-ACCOUNT, not per-browser - localStorage is shared
    // across every login in the same browser, so a bare 'crq_data_source'
    // key meant a brand-new signup silently inherited whatever the
    // previous account on this machine had picked (a real bug someone hit
    // testing with a fresh account right after a demo-data run). Namespace
    // the key by username so each account gets asked once, independently.
    const dataSourceKey = username ? `crq_data_source:${username}` : null;
    useEffect(() => {
        if (!token || !dataSourceKey) return;
        try {
            const stored = localStorage.getItem(dataSourceKey);
            setDataSource(stored === 'own' ? 'own' : stored === 'predefined' ? 'predefined' : null);
        } catch (e) {
            // localStorage unavailable - fail open (demo nav) rather than
            // trap everyone on the choice screen forever.
            setDataSource('predefined');
        }
        setDataSourceHydrated(true);
    }, [token, dataSourceKey]);

    useEffect(() => {
        if (!token || dataSource === null) return;
        try {
            const params = new URLSearchParams(window.location.search);
            const next = params.get('next');
            // Only ever an internal, same-origin path (middleware.ts is the
            // only thing that ever sets it) - the leading-slash/no-//
            // check is still enforced here as defense in depth against an
            // open redirect if that ever changes.
            if (next && next.startsWith('/') && !next.startsWith('//')) {
                router.replace(next);
            }
        } catch (e) {
            // ignore - worst case the visitor stays on the start screen
            // and picks a dashboard tab manually.
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, dataSource]);

    // Which tab of the start screen is showing - "Home" is a personalized
    // recreation of the pre-login LandingPage (same hero/stats/about
    // language, just pointed at the dashboard instead of a signup form);
    // "Dashboard" is the actual three-option chooser. First-time visitors
    // (dataSource === null) land on Home, matching the public site; a
    // deliberate "Switch Dashboard" click (see returnToStart below) jumps
    // straight to Dashboard since that's the whole point of clicking it.
    const [startTab, setStartTab] = useState<'home' | 'dashboard'>('home');

    const chooseDemoData = () => {
        try { if (dataSourceKey) localStorage.setItem(dataSourceKey, 'predefined'); } catch (e) {}
        setDataSource('predefined');
        router.push('/overview');
    };

    const chooseOwnData = () => {
        try { if (dataSourceKey) localStorage.setItem(dataSourceKey, 'own'); } catch (e) {}
        setDataSource('own');
        router.push('/ingestion');
    };

    // Third starting option: model training & calibration is its own
    // standalone tool, not part of either the demo or own-data dashboard -
    // so it doesn't set dataSource at all, and the gate below (see
    // dataSourceHydrated/dataSource) lets /training through even before a
    // demo-vs-own choice has been made.
    const chooseTraining = () => {
        router.push('/training');
    };

    // The "Switch Dashboard" nav button - jumps back to the start screen
    // from anywhere in the app without logging out. Doesn't clear
    // dataSource or any saved simulation state, so Overview/Ingestion
    // still show whatever was last run there if the same option is picked
    // again. '/' is unconditionally the start screen (see the render gate
    // below), so no separate "show start screen" flag is needed anymore.
    const returnToStart = () => {
        setStartTab('dashboard');
        router.push('/');
    };

    // Clicking the CRQ Platform logo should always land on the real Home
    // tab - not whichever start-screen tab (Home/Dashboard) was showing
    // last time "Switch Dashboard" was used.
    const goHome = () => {
        setStartTab('home');
        router.push('/');
    };
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const [isNewAnalysisOpen, setIsNewAnalysisOpen] = useState(false);
    const [analysisLabel, setAnalysisLabel] = useState('');
    const [analysisBudgetCr, setAnalysisBudgetCr] = useState(10);
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    // [Clear flow of work] Running a second analysis in the same modal
    // used to silently overwrite whatever results were already showing -
    // easy to lose track of. Now starting a fresh one asks first.
    const [pendingNewSimulationConfirm, setPendingNewSimulationConfirm] = useState(false);

    const runNewAnalysis = async () => {
        setAnalysisLoading(true);
        setAnalysisError(null);
        setAnalysisResult(null);
        try {
            const res = await fetch(`${API_BASE}/api/simulate-risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: analysisBudgetCr * 10000000, constraints: {} }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || `Request failed (${res.status})`);
            }
            setAnalysisResult(data);
        } catch (e: any) {
            console.error(e);
            setAnalysisError(e.message || 'Could not run analysis. Is the backend running on port 8000?');
        } finally {
            setAnalysisLoading(false);
        }
    };

    const closeNewAnalysis = () => {
        setIsNewAnalysisOpen(false);
        setAnalysisResult(null);
        setAnalysisError(null);
        setAnalysisLabel('');
        setPendingNewSimulationConfirm(false);
    };

    // Clicking "Run New Simulation" while a result is already showing asks
    // first instead of silently wiping it - confirmNewSimulation actually
    // resets the form back to a clean slate once the user says yes.
    const requestNewSimulation = () => {
        if (analysisResult) {
            setPendingNewSimulationConfirm(true);
        } else {
            setAnalysisLabel('');
            setAnalysisBudgetCr(10);
            setAnalysisError(null);
        }
    };

    const confirmNewSimulation = () => {
        setAnalysisResult(null);
        setAnalysisError(null);
        setAnalysisLabel('');
        setAnalysisBudgetCr(10);
        setPendingNewSimulationConfirm(false);
    };

    // Two distinct dashboards, two distinct navs - Training moved out to
    // the starting page (see chooseTraining above) so neither one links to
    // it anymore, and Ingestion is no longer a separate tab: for an
    // own-data account it - the merged data-entry + sandbox dashboard - IS
    // "Overview". dataSource === null (still hydrating, or somehow on a
    // dashboard route before choosing) falls back to the demo nav.
    const navItems = dataSource === 'own'
        ? [
            { path: '/ingestion', icon: 'dashboard', label: 'Overview' },
            { path: '/optimize', icon: 'trending_up', label: 'Investment' },
            { path: '/ledger', icon: 'receipt_long', label: 'Ledger' },
            { path: '/calibration', icon: 'target', label: 'Calibration' },
            { path: '/reports', icon: 'assessment', label: 'Reports' },
        ]
        : [
            { path: '/overview', icon: 'dashboard', label: 'Overview' },
            { path: '/optimize', icon: 'trending_up', label: 'Investment' },
            { path: '/ledger', icon: 'receipt_long', label: 'Ledger' },
            { path: '/calibration', icon: 'target', label: 'Calibration' },
            { path: '/reports', icon: 'assessment', label: 'Reports' },
        ];
    // [Training is standalone] /training is reachable before a demo/own-data
    // choice is even made (see the gate below), so it falls through to this
    // same dashboard shell - but it must never show Overview/Investment/
    // Ledger/Calibration/Reports as if it were a tab of either dashboard,
    // or a "+ New Analysis" button that opens the demo simulate-risk modal.
    // Both would misrepresent Training as part of a dashboard it isn't.
    const isTrainingRoute = pathname === '/training';

    // [Weak mode identity - fix] Previously the only visible signal for
    // "which dataset am I actually looking at" was a two-letter avatar
    // initial ("CI" for the ciso account) - nothing told a visitor whether
    // Overview/Ledger/Reports/etc were showing the shared demo fleet,
    // their own ingested data, or (on /training) no live risk data at
    // all. This computes one persistent label from state this component
    // already tracks (dataSource, isTrainingRoute) and renders it in the
    // nav bar below on every protected page, so the active workspace is
    // never ambiguous on a risk-bearing screen.
    const workspaceLabel = isTrainingRoute
        ? 'Training Workspace'
        : dataSource === 'own'
        ? 'Own Data Workspace'
        : dataSource === 'predefined'
        ? 'Demo Workspace'
        : null; // null on the "how do you want to start" chooser - no workspace chosen yet
    const workspaceIcon = isTrainingRoute ? 'school' : dataSource === 'own' ? 'dns' : 'science';
    const workspaceDescription = isTrainingRoute
        ? 'Training modules - no live risk data or simulations here.'
        : dataSource === 'own'
        ? 'Showing YOUR own ingested assets, telemetry, and decisions - never another account\'s.'
        : 'Showing the shared demo fleet - synthetic data, not a real production environment.';

    useEffect(() => {
        setIsMobileNavOpen(false);
    }, [pathname]);

    // Hard gate: nothing else in the app - nav, sidebar, any page - renders
    // until there's a token. A public marketing splash (LandingPage) is the
    // very first thing a visitor sees on every route; only its Login/Sign Up
    // buttons switch to the real auth form (AuthScreen), which can hand
    // control back with onBack.
    if (!isAuthReady) {
        return null;
    }
    if (!token) {
        if (authView === 'landing') {
            return <LandingPage onLogin={() => setAuthView('login')} onSignup={() => setAuthView('signup')} />;
        }
        return <AuthScreen initialMode={authView} onBack={() => setAuthView('landing')} />;
    }

    // Second gate: logged in, but hasn't picked demo data or their own
    // data yet (dataSource === null) - or is sitting at '/', which is now
    // unconditionally the Home/start screen (so the CRQ Platform logo,
    // which just links to '/', always lands here instead of on whatever
    // dashboard used to live at this URL). A dedicated full page (not a
    // modal floating over a half-rendered dashboard) with a plain toolbar
    // - brand + Logged in/Logout only, no nav links, no search bar, no New
    // Analysis button - so the choice reads as a real step, not an
    // interruption. /training is exempt - it's the third starting option,
    // a standalone tool that doesn't require picking demo vs. own data
    // first, so it must stay reachable even before that choice is made.
    // !dataSourceHydrated is the brief instant before the effect above has
    // read localStorage; render nothing rather than flash the wrong
    // screen.
    if (!dataSourceHydrated) {
        return null;
    }

    // Intelligence is its own standalone section - like Home/Dashboard/
    // Training, not a tab bolted onto whichever workspace (demo/own data)
    // happens to be active. It gets a minimal header of its own (logo +
    // Home/Dashboard/Intelligence pills, matching the picker screen) rather
    // than the full station-tabs dashboard chrome below, and it is exempt
    // from the picker gate so it's reachable however dataSource is set.
    if (pathname === '/intelligence') {
        return (
            <div className="relative min-h-screen bg-background text-on-background overflow-x-hidden">
                <div className="ambient-glow" aria-hidden="true" />
                <nav className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-outline-variant/60 flex items-center justify-between flex-wrap gap-3 px-6 sm:px-10 py-5 max-w-[1400px] mx-auto">
                    <Link href="/" onClick={goHome} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity" title="Go to the home page">
                        <img src="/suraksha-logo.png" alt="CRQ Platform" className="h-10 w-auto shrink-0" />
                    </Link>
                    <div className="flex items-center gap-1 bg-surface-container-low border border-outline-variant rounded-full p-1">
                        <button
                            onClick={goHome}
                            className="px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all text-on-surface-variant hover:text-primary"
                        >
                            Home
                        </button>
                        <button
                            onClick={returnToStart}
                            className="px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all text-on-surface-variant hover:text-primary"
                        >
                            Dashboard
                        </button>
                        <button
                            className="px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all landing-cta-gradient shadow-md"
                        >
                            Intelligence
                        </button>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low border border-outline-variant rounded font-label-caps text-label-caps">
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[#15803d]">verified_user</span>
                        <span className="text-on-surface whitespace-nowrap">Logged in</span>
                        <button onClick={logout} className="text-on-surface-variant hover:text-error underline ml-1">Logout</button>
                    </div>
                </nav>
                <main className="relative z-10 px-6 sm:px-10 py-12 sm:py-16 max-w-[1400px] mx-auto animate-fade-scale-in">
                    {children}
                </main>
            </div>
        );
    }

    if ((dataSource === null || pathname === '/') && pathname !== '/training') {
        // Same copy as the public LandingPage, reused here so "Home" reads
        // as a continuation of the marketing site instead of a different
        // product - only the CTA differs (Go to Dashboard vs. Sign Up).
        const capabilities = [
            { icon: 'monitoring', title: 'FAIR Monte Carlo Engine', desc: '10,000-iteration simulation turns exposure into ₹ ALE and VaR.' },
            { icon: 'auto_awesome', title: 'Virtual CISO, on call', desc: 'LangGraph AI agent answers security & compliance questions instantly.' },
            { icon: 'link', title: 'Blockchain Audit Trail', desc: 'Every risk decision is hashed and committed on-chain - tamper-evident.' },
            { icon: 'tune', title: 'Budget Optimizer', desc: '0/1 knapsack picks the exact controls that cut the most risk per rupee.' },
        ];
        const stats = [
            { value: '10K+', label: 'Simulated years per run' },
            { value: '99.9%', label: 'Audit trail integrity' },
            { value: '24/7', label: 'AI compliance assistant' },
        ];
        const about = [
            { icon: 'lock', title: 'Blockchain Security', desc: 'Immutable records on Fabric-like ledgers guarantee transparency and tamper resistance.' },
            { icon: 'link', title: 'Tamper-Evident Ledger', desc: 'Accepted risk decisions are committed to a blockchain audit trail that cannot be quietly edited later.' },
            { icon: 'model_training', title: 'Closed-Loop Calibration', desc: 'Real incident outcomes feed back into the model, sharpening every future prediction.' },
            { icon: 'policy', title: 'Compliance, Mapped Automatically', desc: 'Every control is cross-walked to SEBI CSCRF, DPDP Act 2023, and NIST & ISO 27001 in real time.' },
        ];

        return (
            <div className="relative min-h-screen bg-background text-on-background overflow-x-hidden">
                <div className="ambient-glow" aria-hidden="true" />

                {/* Nav - brand mark identical to the public landing page;
                    Login/Sign Up are replaced with Home/Dashboard tabs since
                    this visitor is already authenticated. */}
                <nav className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-outline-variant/60 flex items-center justify-between flex-wrap gap-3 px-6 sm:px-10 py-5 max-w-[1200px] mx-auto">
                    <Link href="/" onClick={goHome} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity" title="Go to the home page">
                        <img src="/suraksha-logo.png" alt="CRQ Platform" className="h-10 w-auto shrink-0" />
                    </Link>
                    <div className="flex items-center gap-1 bg-surface-container-low border border-outline-variant rounded-full p-1">
                        <button
                            onClick={() => setStartTab('home')}
                            className={`px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all ${startTab === 'home' ? 'landing-cta-gradient shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
                        >
                            Home
                        </button>
                        <button
                            onClick={() => setStartTab('dashboard')}
                            className={`px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all ${startTab === 'dashboard' ? 'landing-cta-gradient shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
                        >
                            Dashboard
                        </button>
                        <button
                            onClick={() => router.push('/intelligence')}
                            className="px-5 py-2 rounded-full font-body-sm text-body-sm font-semibold transition-all text-on-surface-variant hover:text-primary"
                        >
                            Intelligence
                        </button>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low border border-outline-variant rounded font-label-caps text-label-caps">
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[#15803d]">verified_user</span>
                        <span className="text-on-surface whitespace-nowrap">Logged in</span>
                        <button onClick={logout} className="text-on-surface-variant hover:text-error underline ml-1">Logout</button>
                    </div>
                </nav>

                {startTab === 'home' ? (
                    <div className="animate-fade-scale-in landing-warm-page">
                        {/* Hero */}
                        <section className="relative z-10 max-w-[1200px] mx-auto px-6 sm:px-10 pt-10 sm:pt-16 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                            <div>
                                <h1 className="text-[58px] font-bold leading-[1.05] landing-font landing-heading-gradient tracking-tight mb-stack-md">
                                    Welcome back{displayName ? <>, <span className="capitalize">{displayName}</span></> : ''}
                                </h1>
                                <p className="font-body-md text-body-md text-on-surface-variant mb-stack-lg max-w-md">
                                    An AI-powered platform that turns telemetry into Annualized Loss Expectancy, optimizes your security budget, and anchors every decision to a blockchain audit trail.
                                </p>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        onClick={() => setStartTab('dashboard')}
                                        className="px-6 py-3 rounded-full landing-cta-gradient font-body-sm text-body-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center gap-2"
                                    >
                                        Go to Dashboard
                                        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                    </button>
                                </div>
                            </div>

                            <div className="landing-warm-card border border-outline-variant rounded-xl shadow-2xl p-gutter elevate">
                                <div className="flex flex-col gap-stack-md">
                                    {capabilities.map((c) => (
                                        <div key={c.title} className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-lg landing-icon-badge flex items-center justify-center shrink-0">
                                                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{c.icon}</span>
                                            </div>
                                            <div>
                                                <h3 className="font-body-sm text-body-sm font-bold text-on-surface">{c.title}</h3>
                                                <p className="font-body-sm text-body-sm text-on-surface-variant">{c.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* Stats */}
                        <section className="relative z-10 border-y border-outline-variant landing-warm-band">
                            <div className="max-w-[1200px] mx-auto px-6 sm:px-10 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
                                {stats.map((s) => (
                                    <div key={s.label}>
                                        <div className="text-headline-md landing-font landing-stat-color font-extrabold">{s.value}</div>
                                        <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* About */}
                        <section className="relative z-10 max-w-[1200px] mx-auto px-6 sm:px-10 py-16">
                            <div className="text-center max-w-2xl mx-auto mb-stack-lg">
                                <h2 className="text-headline-md landing-font landing-heading-gradient mb-stack-sm">About the Platform</h2>
                                <p className="font-body-md text-body-md text-on-surface-variant">
                                    CRQ Platform bridges enterprise telemetry, FAIR risk math, and generative AI so security spend is decided
                                    by evidence, not gut feel - and every decision leaves a trail nobody can quietly edit.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-stack-md">
                                {about.map((a) => (
                                    <div key={a.title} className="border border-outline-variant rounded-xl p-stack-md elevate bg-surface-container-lowest">
                                        <div className="w-10 h-10 rounded-full landing-icon-badge flex items-center justify-center mb-stack-sm">
                                            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{a.icon}</span>
                                        </div>
                                        <h3 className="font-body-sm text-body-sm font-bold text-on-surface mb-1">{a.title}</h3>
                                        <p className="font-body-sm text-body-sm text-on-surface-variant">{a.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <footer className="relative z-10 text-center py-8 font-label-caps text-label-caps text-on-surface-variant">
                            &copy; {new Date().getFullYear()} CRQ Platform. Built for Smart India Hackathon.
                        </footer>
                    </div>
                ) : (
                    <main className="flex-1 px-6 sm:px-10 py-12 sm:py-16 relative animate-fade-scale-in">
                        <div className="relative z-10 w-full max-w-5xl mx-auto">
                            {dataSource !== null && (
                                <button
                                    onClick={() => router.push(dataSource === 'own' ? '/ingestion' : '/overview')}
                                    className="mb-stack-lg text-primary font-label-caps text-label-caps hover:underline flex items-center gap-1"
                                >
                                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_back</span>
                                    Back to dashboard
                                </button>
                            )}
                            <div className="text-center mb-stack-lg">
                                <h1 className="font-headline-md text-headline-md landing-font landing-heading-gradient mb-1">How do you want to start?</h1>
                                <p className="font-body-md text-body-md text-on-surface-variant max-w-xl mx-auto">Pick one - you can switch anytime from &quot;Switch Dashboard&quot; in the top bar, and nothing you&apos;ve already run gets lost.</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-stack-lg">
                                <button
                                    onClick={chooseDemoData}
                                    className="group relative text-left border border-outline-variant rounded-xl p-gutter bg-surface-container-lowest hover:border-primary hover:-translate-y-1 transition-all flex flex-col gap-2 shadow-2xl"
                                >
                                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant font-label-caps text-label-caps text-on-surface-variant">Fastest</span>
                                    <span className="w-10 h-10 rounded landing-cta-gradient flex items-center justify-center">
                                        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">bolt</span>
                                    </span>
                                    <span className="font-body-md text-body-md font-semibold text-on-surface">Run a demo analysis</span>
                                    <span className="font-body-sm text-body-sm text-on-surface-variant flex-1">Jump straight in with realistic demo telemetry and a live simulation, ready in seconds.</span>
                                    <span className="font-label-caps text-label-caps text-primary flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100">
                                        Get started
                                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                                    </span>
                                </button>
                                <button
                                    onClick={chooseOwnData}
                                    className="group relative text-left border border-outline-variant rounded-xl p-gutter bg-surface-container-lowest hover:border-primary hover:-translate-y-1 transition-all flex flex-col gap-2 shadow-2xl"
                                >
                                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant font-label-caps text-label-caps text-on-surface-variant">Real Data</span>
                                    <span className="w-10 h-10 rounded bg-secondary-container text-on-secondary-container flex items-center justify-center">
                                        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">cloud_upload</span>
                                    </span>
                                    <span className="font-body-md text-body-md font-semibold text-on-surface">Enter your own data</span>
                                    <span className="font-body-sm text-body-sm text-on-surface-variant flex-1">Upload your own device configs and simulate risk from your real environment - no demo numbers, ever.</span>
                                    <span className="font-label-caps text-label-caps text-primary flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100">
                                        Get started
                                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                                    </span>
                                </button>
                                <button
                                    onClick={chooseTraining}
                                    className="group relative text-left border border-outline-variant rounded-xl p-gutter bg-surface-container-lowest hover:border-primary hover:-translate-y-1 transition-all flex flex-col gap-2 shadow-2xl"
                                >
                                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-surface-container-low border border-outline-variant font-label-caps text-label-caps text-on-surface-variant">Compliance</span>
                                    <span className="w-10 h-10 rounded bg-secondary-container text-on-secondary-container flex items-center justify-center">
                                        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">model_training</span>
                                    </span>
                                    <span className="font-body-md text-body-md font-semibold text-on-surface">Train &amp; calibrate the model</span>
                                    <span className="font-body-sm text-body-sm text-on-surface-variant flex-1">Work through the security-awareness modules that feed the model&apos;s Control Strength score - separate from picking demo or your own data.</span>
                                    <span className="font-label-caps text-label-caps text-primary flex items-center gap-1 mt-1 opacity-80 group-hover:opacity-100">
                                        Get started
                                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                                    </span>
                                </button>
                            </div>

                            {/* Reassurance strip - the same "why is this safe
                                to click" facts a first-time visitor actually
                                wants answered, filling what used to be bare
                                white space below the three cards. */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-stack-md mt-16 pt-10 border-t border-outline-variant">
                                {[
                                    { icon: 'swap_horiz', title: 'Switch anytime', desc: 'Jump between Demo, Own Data, and Training from "Switch Dashboard" in the top bar - no logout required.' },
                                    { icon: 'save', title: 'Nothing gets lost', desc: "Whatever you've already run stays exactly where you left it, even after switching away and back." },
                                    { icon: 'call_split', title: 'Kept separate', desc: 'Demo and Own Data keep their own ledgers, blockchain commits, and simulation history - never mixed together.' },
                                ].map((f) => (
                                    <div key={f.title} className="flex items-start gap-3">
                                        <span className="w-9 h-9 rounded-full landing-icon-badge flex items-center justify-center shrink-0">
                                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{f.icon}</span>
                                        </span>
                                        <div>
                                            <h3 className="font-body-sm text-body-sm font-bold text-on-surface">{f.title}</h3>
                                            <p className="font-body-sm text-body-sm text-on-surface-variant">{f.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </main>
                )}
            </div>
        );
    }

    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col">
            <CommandPalette />
            {/* [No degraded-mode / service-health feedback - fix] Shown on
                every protected page (this layout wraps all of them) whenever
                the backend can't be reached at all, or answered but reported
                its own database as unavailable - the two cases where reads/
                writes across the whole app are actually likely to fail, not
                just one feature. AI-fallback and blockchain-unavailable are
                surfaced closer to where they actually matter (the chat panel,
                the Ledger page) rather than here, since the app still works
                fine without either. */}
            <div className="sticky top-0 z-50">
            {(backendUnreachable || serviceStatus?.database === 'error') && (
                <div className="bg-error text-white px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-body-sm text-body-sm text-center">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">cloud_off</span>
                    <span>
                        {backendUnreachable
                            ? "Can't reach the backend right now - is it running on port 8000?"
                            : 'The backend database is unavailable right now - actions that read or write data may fail.'}
                    </span>
                    <button
                        onClick={() => refreshServiceStatus()}
                        className="underline font-semibold hover:opacity-80 transition-opacity"
                    >
                        Retry
                    </button>
                </div>
            )}
            {/* TopNavBar */}
            <nav className="bg-surface border-b border-outline-variant w-full shadow-[0_2px_12px_-6px_rgba(0,0,0,0.12)]">
                <div className="flex flex-wrap justify-between items-center gap-y-2 w-full px-4 sm:px-container-padding max-w-[1440px] mx-auto min-h-16 py-2">
                    <div className="flex items-center gap-stack-sm sm:gap-gutter">
                        <button
                            onClick={() => setIsMobileNavOpen((v) => !v)}
                            className="md:hidden -m-2 p-2 text-on-surface-variant hover:text-primary transition-colors"
                            aria-label={isMobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
                            aria-expanded={isMobileNavOpen}
                        >
                            <span aria-hidden="true" className="material-symbols-outlined">{isMobileNavOpen ? 'close' : 'menu'}</span>
                        </button>
                        <Link href="/" onClick={goHome} className="flex items-center gap-2 hover:opacity-80 transition-opacity" title="Go to the home page">
                            <img src="/suraksha-logo.png" alt="Suraksha" className="h-9 w-auto shrink-0" />
                        </Link>
                        {workspaceLabel && (
                            <WorkspaceStatusPopover
                                workspaceLabel={workspaceLabel}
                                workspaceIcon={workspaceIcon}
                                workspaceDescription={workspaceDescription}
                                account={displayName || 'Guest'}
                                serviceStatus={serviceStatus}
                                backendUnreachable={backendUnreachable}
                            />
                        )}
                    </div>
                    <button
                        onClick={() => window.dispatchEvent(new Event('crq:open-command-palette'))}
                        className="hidden md:flex flex-1 max-w-xl items-center justify-between gap-2 mx-gutter text-on-surface-variant hover:border-primary transition-colors border border-outline-variant rounded-full px-4 py-2 bg-surface-container-low"
                        aria-label="Search"
                    >
                        <span className="font-body-sm text-body-sm">Search</span>
                        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">search</span>
                    </button>
                    <div className="flex items-center flex-wrap justify-end gap-2 sm:gap-stack-md">
                        <button
                            onClick={returnToStart}
                            title="Go back to the demo / own data / training start screen"
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary rounded font-label-caps text-label-caps transition-colors whitespace-nowrap"
                        >
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">swap_horiz</span>
                            Switch Dashboard
                        </button>
                        <Link href="/support" className="text-on-surface-variant hover:text-primary transition-colors" aria-label="Help">
                            <span aria-hidden="true" className="material-symbols-outlined">help</span>
                        </Link>
                        <div className="relative">
                            <button
                                onClick={() => setIsSettingsOpen((v) => !v)}
                                className="text-on-surface-variant hover:text-primary transition-colors"
                                aria-label="Settings"
                            >
                                <span aria-hidden="true" className="material-symbols-outlined">settings</span>
                            </button>
                            {isSettingsOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsSettingsOpen(false)} />
                                    <div className="absolute right-0 top-10 w-56 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-2xl z-50 p-3 animate-fade-scale-in">
                                        <div className="flex items-center justify-between px-1 py-1.5">
                                            <span className="font-body-sm text-body-sm">Dark Mode</span>
                                            <button
                                                onClick={toggleTheme}
                                                role="switch"
                                                aria-checked={theme === 'dark'}
                                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${theme === 'dark' ? 'bg-primary' : 'bg-surface-variant'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        {username ? (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low border border-outline-variant rounded font-label-caps text-label-caps">
                                <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[#15803d]">verified_user</span>
                                <span className="text-on-surface whitespace-nowrap">Logged in</span>
                                <button onClick={logout} className="text-on-surface-variant hover:text-error underline ml-1">Logout</button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => loginAs('ciso')}
                                    disabled={loggingInRole !== null}
                                    className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors disabled:opacity-60 flex items-center gap-1 whitespace-nowrap"
                                >
                                    {loggingInRole === 'ciso' && <span aria-hidden="true" className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                                    <span className="hidden sm:inline">Login as </span>CISO
                                </button>
                                <button
                                    onClick={() => loginAs('cfo')}
                                    disabled={loggingInRole !== null}
                                    className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors disabled:opacity-60 flex items-center gap-1 whitespace-nowrap"
                                >
                                    {loggingInRole === 'cfo' && <span aria-hidden="true" className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                                    <span className="hidden sm:inline">Login as </span>CFO
                                </button>
                                {loginError && <span className="text-error text-label-caps max-w-[160px] sm:max-w-none">{loginError}</span>}
                            </div>
                        )}
                        <div className="w-8 h-8 rounded-full landing-icon-badge border border-outline-variant ml-2 flex items-center justify-center font-label-caps text-label-caps font-bold">
                            {(username || 'Guest').slice(0, 2).toUpperCase()}
                        </div>
                    </div>
                </div>
            </nav>

            {/* Mobile nav drawer - same destinations as the desktop sidebar,
                since that sidebar is hidden below md and would otherwise
                leave mobile visitors with no way to reach Investment,
                Ledger, Ingestion, Training or Reports. */}
            {isMobileNavOpen && (
                <div className="md:hidden bg-surface-container-low border-b border-outline-variant w-full shadow-lg animate-fade-scale-in max-h-[calc(100vh-4rem)] overflow-y-auto">
                    <div className="p-gutter flex flex-col gap-unit max-w-[1440px] mx-auto w-full">
                        {/* [Weak mode identity - fix] The desktop badge above is
                            `hidden sm:inline-flex` - this is the mobile
                            equivalent, shown at the top of the drawer instead of
                            squeezed into the already-tight mobile top bar. */}
                        {workspaceLabel && (
                            <div className="mb-stack-sm flex flex-col gap-1 px-2.5 py-1.5 rounded border border-outline-variant bg-surface-container-lowest font-label-caps text-label-caps text-on-surface-variant">
                                <div className="flex items-center gap-1.5">
                                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{workspaceIcon}</span>
                                    {workspaceLabel}
                                    <span className="ml-auto font-body-sm text-body-sm normal-case opacity-80">{displayName || 'Guest'}</span>
                                </div>
                                {/* [Product improvement #6] Same backend/AI/blockchain/data-freshness
                                    signals as the desktop popover, laid out flat here since the
                                    mobile drawer has no room for a nested popover. */}
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 normal-case font-body-sm text-body-sm opacity-80">
                                    <span>Backend: {backendUnreachable ? 'Unreachable' : 'Online'}</span>
                                    <span>AI: {serviceStatus?.ai_agent === 'configured' ? 'Configured' : 'Fallback'}</span>
                                    <span>Chain: {serviceStatus?.blockchain === 'connected' ? 'Connected' : 'Unavailable'}</span>
                                </div>
                            </div>
                        )}
                        {!isTrainingRoute && (
                            <button
                                onClick={() => { setIsNewAnalysisOpen(true); setIsMobileNavOpen(false); }}
                                className="w-full landing-cta-gradient font-body-sm text-body-sm py-2 px-4 rounded font-semibold mb-stack-sm hover:opacity-90 transition-opacity"
                            >
                                + New Analysis
                            </button>
                        )}
                        <button
                            onClick={() => { returnToStart(); setIsMobileNavOpen(false); }}
                            className="w-full border border-outline-variant text-on-surface font-body-sm text-body-sm py-2 px-4 rounded font-semibold mb-stack-sm hover:border-primary transition-colors flex items-center justify-center gap-1.5"
                        >
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">swap_horiz</span>
                            Switch Dashboard
                        </button>
                        {!isTrainingRoute && navItems.map((item) => {
                            const isActive = pathname === item.path;
                            return (
                                <Link key={item.path} href={item.path} className={`relative flex items-center gap-stack-sm px-3 py-2 rounded-lg font-label-caps text-label-caps transition-all duration-150 active:scale-95 ${isActive ? 'landing-nav-active font-semibold' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
                                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full landing-nav-active-bar" />}
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{item.icon}</span> {item.label}
                                </Link>
                            );
                        })}
                        <div className="flex flex-col gap-unit pt-stack-sm mt-stack-sm border-t border-outline-variant">
                            <Link href="/support" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">help_outline</span> Support
                            </Link>
                            <Link href="/docs" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">description</span> Documentation
                            </Link>
                        </div>
                    </div>
                </div>
            )}

            {/* SecondaryNavBar - the former left sidebar, now a horizontal strip
                so the shell reads like a top-nav app instead of a console. Styled
                with the same warm amber accent as the landing page's CTA. */}
            <nav className="hidden md:flex bg-surface-container-low border-b border-outline-variant w-full">
                <div className="flex items-center justify-between w-full px-container-padding max-w-[1440px] mx-auto py-2 gap-gutter">
                    <div className="flex items-center gap-unit overflow-x-auto">
                        {isTrainingRoute ? (
                            <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-label-caps text-label-caps landing-nav-active font-semibold whitespace-nowrap">
                                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">model_training</span> Training
                            </span>
                        ) : navItems.map((item) => {
                            const isActive = pathname === item.path;
                            return (
                                <Link key={item.path} href={item.path} className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg font-label-caps text-label-caps whitespace-nowrap transition-all duration-150 active:scale-95 ${isActive ? 'landing-nav-active font-semibold' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
                                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{item.icon}</span> {item.label}
                                    {isActive && <span className="absolute left-2 right-2 -bottom-px h-[3px] rounded-full landing-nav-active-bar" />}
                                </Link>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-stack-md flex-shrink-0">
                        <Link href="/support" className="flex items-center gap-1.5 px-2 py-2 text-on-surface-variant hover:text-primary font-label-caps text-label-caps whitespace-nowrap">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">help_outline</span> Support
                        </Link>
                        <Link href="/docs" className="flex items-center gap-1.5 px-2 py-2 text-on-surface-variant hover:text-primary font-label-caps text-label-caps whitespace-nowrap">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">description</span> Docs
                        </Link>
                        {!isTrainingRoute && (
                            <button onClick={() => setIsNewAnalysisOpen(true)} className="landing-cta-gradient font-body-sm text-body-sm py-2 px-4 rounded font-semibold hover:opacity-90 transition-opacity whitespace-nowrap">
                                + New Analysis
                            </button>
                        )}
                    </div>
                </div>
            </nav>
            </div>

            {/* Main Content Wrapper */}
            <main className="flex-1 max-w-[1440px] mx-auto w-full p-container-padding bg-background relative">
                {children}
                <VirtualCisoChat />
                {showScrollTop && (
                    <button
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        aria-label="Scroll to top"
                        title="Scroll to top"
                        className="fixed bottom-6 left-6 w-12 h-12 rounded-full bg-surface-container-lowest border border-outline-variant shadow-xl flex items-center justify-center z-50 hover:border-primary hover:text-primary transition-all active:scale-95"
                    >
                        <span aria-hidden="true" className="material-symbols-outlined text-[22px]">arrow_upward</span>
                    </button>
                )}
            </main>
            
            {isNewAnalysisOpen && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={closeNewAnalysis}>
                    <div
                        className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter w-full max-w-md shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-stack-md">
                            <h3 className="font-title-lg text-title-lg text-primary">New Analysis</h3>
                            <button onClick={closeNewAnalysis} aria-label="Close" className="text-on-surface-variant hover:text-primary">
                                <span aria-hidden="true" className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex flex-col gap-stack-md">
                            <div>
                                <label className="font-body-sm text-body-sm font-medium block mb-1">Analysis name (optional)</label>
                                <input
                                    type="text"
                                    value={analysisLabel}
                                    onChange={(e) => setAnalysisLabel(e.target.value)}
                                    placeholder="e.g. Q1 Payment Processing Review"
                                    className="w-full bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between mb-2">
                                    <label htmlFor="new-analysis-budget" className="font-body-sm text-body-sm font-medium">Security Budget</label>
                                    <span className="font-data-mono text-data-mono font-bold" aria-hidden="true">₹{analysisBudgetCr} Cr</span>
                                </div>
                                <input
                                    id="new-analysis-budget"
                                    type="range"
                                    min="0"
                                    max="15"
                                    step="0.5"
                                    value={analysisBudgetCr}
                                    onChange={(e) => setAnalysisBudgetCr(Number(e.target.value))}
                                    className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary"
                                    aria-label="Security budget in crores of rupees"
                                    aria-valuetext={`₹${analysisBudgetCr} crore`}
                                />
                            </div>

                            <button
                                onClick={runNewAnalysis}
                                disabled={analysisLoading}
                                className="w-full bg-primary text-on-primary font-body-sm text-body-sm py-3 rounded font-semibold hover:bg-opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {analysisLoading ? 'Running simulation...' : 'Run Analysis'}
                            </button>

                            {analysisError && (
                                <p className="text-error font-body-sm text-body-sm">{analysisError}</p>
                            )}

                            {analysisResult && (
                                <div className="border-t border-outline-variant pt-stack-md mt-stack-sm">
                                    <div className="flex justify-between items-center mb-2 gap-stack-sm">
                                        <h4 className="font-body-sm text-body-sm font-semibold">
                                            {analysisLabel || 'Untitled Analysis'} - Results
                                        </h4>
                                        <button
                                            onClick={requestNewSimulation}
                                            className="font-label-caps text-label-caps text-primary hover:underline whitespace-nowrap flex items-center gap-1"
                                        >
                                            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">refresh</span>
                                            Run New Simulation
                                        </button>
                                    </div>
                                    {pendingNewSimulationConfirm && (
                                        <div className="mb-stack-sm bg-surface-container-low border border-outline-variant rounded p-3 flex flex-col gap-2 animate-fade-scale-in">
                                            <p className="font-body-sm text-body-sm">Start a new simulation? This clears the results above.</p>
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => setPendingNewSimulationConfirm(false)}
                                                    className="px-3 py-1 border border-outline-variant text-on-surface rounded font-label-caps text-label-caps hover:bg-surface-container transition-colors"
                                                >
                                                    Keep these results
                                                </button>
                                                <button
                                                    onClick={confirmNewSimulation}
                                                    className="px-3 py-1 landing-cta-gradient rounded font-label-caps text-label-caps font-semibold hover:opacity-90 transition-opacity"
                                                >
                                                    Yes, start new
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-stack-sm">
                                        <div className="bg-surface-container-low border border-outline-variant rounded p-3">
                                            <div className="font-label-caps text-label-caps text-on-surface-variant">Expected Annual Loss</div>
                                            <div className="font-data-mono text-data-mono font-bold text-primary">
                                                {formatRupeesCr(analysisResult.monte_carlo.mean_expected_loss)}
                                            </div>
                                        </div>
                                        <div className="bg-surface-container-low border border-outline-variant rounded p-3">
                                            <div className="font-label-caps text-label-caps text-on-surface-variant">95% VaR</div>
                                            <div className="font-data-mono text-data-mono font-bold text-primary">
                                                {formatRupeesCr(analysisResult.monte_carlo.var_95)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-stack-sm bg-surface-container-low border border-outline-variant rounded p-3">
                                        <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Optimized Patch Selection</div>
                                        <div className="font-body-sm text-body-sm">
                                            {analysisResult.optimization.selected_patches.join(', ') || 'None within budget'}
                                        </div>
                                        <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                                            Total cost: {formatRupeesExact(Number(analysisResult.optimization.total_cost))} · Risk reduced: {formatRupeesExact(Number(analysisResult.optimization.total_risk_reduced))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Footer */}
            <footer className="bg-surface border-t border-outline-variant docked full-width bottom-0 z-40">
                <div className="flex flex-col md:flex-row justify-between items-center w-full px-container-padding py-stack-md max-w-[1440px] mx-auto gap-stack-sm">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">© {new Date().getFullYear()} CRQ Platform. All rights reserved.</span>
                    <div className="flex gap-gutter font-body-sm text-body-sm text-on-surface-variant">
                        <span className="cursor-pointer hover:text-primary transition-colors">Contextual Help</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">Privacy Policy</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">Security Standards</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">API Documentation</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { API_BASE } from '@/lib/api';

export default function SharedLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { token, username, loginAs, logout, loginError } = useAuth();
    const { theme, toggleTheme } = useTheme();

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isNewAnalysisOpen, setIsNewAnalysisOpen] = useState(false);
    const [analysisLabel, setAnalysisLabel] = useState('');
    const [analysisBudgetCr, setAnalysisBudgetCr] = useState(10);
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

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
    };

    const navItems = [
        { path: '/', icon: 'dashboard', label: 'Overview' },
        { path: '/optimize', icon: 'trending_up', label: 'Investment' },
        { path: '/ledger', icon: 'receipt_long', label: 'Ledger' },
        { path: '/ingestion', icon: 'input', label: 'Ingestion' },
        { path: '/training', icon: 'model_training', label: 'Training' },
        { path: '/reports', icon: 'assessment', label: 'Reports' },
    ];

    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col">
            {/* TopNavBar */}
            <nav className="bg-surface border-b border-outline-variant docked full-width top-0 z-50 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.12)]">
                <div className="flex justify-between items-center w-full px-container-padding max-w-[1440px] mx-auto h-16">
                    <div className="flex items-center gap-gutter">
                        <span className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight">CRQ Platform</span>
                    </div>
                    <div className="flex items-center gap-stack-md">
                        <Link href="/support" className="text-on-surface-variant hover:text-primary transition-colors" aria-label="Help">
                            <span className="material-symbols-outlined">help</span>
                        </Link>
                        <div className="relative">
                            <button
                                onClick={() => setIsSettingsOpen((v) => !v)}
                                className="text-on-surface-variant hover:text-primary transition-colors"
                                aria-label="Settings"
                            >
                                <span className="material-symbols-outlined">settings</span>
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
                                <span className="material-symbols-outlined text-[16px] text-[#15803d]">verified_user</span>
                                <span className="text-on-surface">Logged in: {username}</span>
                                <button onClick={logout} className="text-on-surface-variant hover:text-error underline ml-1">Logout</button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button onClick={() => loginAs('ciso')} className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors">Login as CISO</button>
                                <button onClick={() => loginAs('cfo')} className="px-3 py-1.5 border border-outline-variant rounded font-label-caps text-label-caps hover:border-primary transition-colors">Login as CFO</button>
                                {loginError && <span className="text-error text-label-caps">{loginError}</span>}
                            </div>
                        )}
                        <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container border border-outline-variant ml-2 flex items-center justify-center font-label-caps text-label-caps font-bold">
                            {(username || 'Guest').slice(0, 2).toUpperCase()}
                        </div>
                    </div>
                </div>
            </nav>

            <div className="flex flex-1 max-w-[1440px] mx-auto w-full">
                {/* SideNavBar */}
                <aside className="hidden md:flex flex-col bg-surface-container-low border-r border-outline-variant docked full-height left-0 w-64 flex-shrink-0">
                    <div className="py-stack-lg px-gutter h-full flex flex-col">
                        <div className="mb-stack-lg flex items-center gap-stack-sm">
                            <div className="w-10 h-10 rounded bg-primary-container text-on-primary-container flex items-center justify-center font-headline-sm">EP</div>
                            <div>
                                <h2 className="font-title-lg text-title-lg leading-tight">Executive Portal</h2>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">Risk Management</p>
                            </div>
                        </div>
                        <button onClick={() => setIsNewAnalysisOpen(true)} className="w-full bg-primary text-on-primary font-body-sm text-body-sm py-2 px-4 rounded font-semibold mb-stack-lg hover:bg-opacity-90 transition-opacity">
                            + New Analysis
                        </button>
                        <nav className="flex flex-col gap-unit flex-1">
                            {navItems.map((item) => {
                                const isActive = pathname === item.path;
                                return (
                                    <Link key={item.path} href={item.path} className={`relative flex items-center gap-stack-sm px-3 py-2 rounded-lg font-label-caps text-label-caps transition-all duration-150 active:scale-95 ${isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
                                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />}
                                        <span className="material-symbols-outlined text-[18px]">{item.icon}</span> {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="mt-auto flex flex-col gap-unit pt-stack-md border-t border-outline-variant">
                            <Link href="/support" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span className="material-symbols-outlined text-[18px]">help_outline</span> Support
                            </Link>
                            <Link href="/docs" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span className="material-symbols-outlined text-[18px]">description</span> Documentation
                            </Link>
                        </div>
                    </div>
                </aside>

                {/* Main Content Wrapper */}
                <main className="flex-1 p-container-padding bg-background overflow-y-auto w-full relative">
                    {children}
                    {/* Note: the floating "AI Assistant" chat button lives inside
                        page.tsx (the home dashboard), wired to a real chat panel
                        and the backend. A second, non-functional decorative copy
                        used to sit here too, stacked exactly on top of it, which
                        is why clicking the button appeared to do nothing - you
                        were always clicking this dead one instead of the real
                        one underneath. Removed rather than duplicated. */}
                </main>
            </div>
            
            {isNewAnalysisOpen && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={closeNewAnalysis}>
                    <div
                        className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter w-full max-w-md shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-stack-md">
                            <h3 className="font-title-lg text-title-lg text-primary">New Analysis</h3>
                            <button onClick={closeNewAnalysis} className="text-on-surface-variant hover:text-primary">
                                <span className="material-symbols-outlined">close</span>
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
                                    <label className="font-body-sm text-body-sm font-medium">Security Budget</label>
                                    <span className="font-data-mono text-data-mono font-bold">₹{analysisBudgetCr} Cr</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="15"
                                    step="0.5"
                                    value={analysisBudgetCr}
                                    onChange={(e) => setAnalysisBudgetCr(Number(e.target.value))}
                                    className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary"
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
                                    <h4 className="font-body-sm text-body-sm font-semibold mb-2">
                                        {analysisLabel || 'Untitled Analysis'} - Results
                                    </h4>
                                    <div className="grid grid-cols-2 gap-stack-sm">
                                        <div className="bg-surface-container-low border border-outline-variant rounded p-3">
                                            <div className="font-label-caps text-label-caps text-on-surface-variant">Expected Annual Loss</div>
                                            <div className="font-data-mono text-data-mono font-bold text-primary">
                                                ₹{(analysisResult.monte_carlo.mean_expected_loss / 10000000).toFixed(2)} Cr
                                            </div>
                                        </div>
                                        <div className="bg-surface-container-low border border-outline-variant rounded p-3">
                                            <div className="font-label-caps text-label-caps text-on-surface-variant">95% VaR</div>
                                            <div className="font-data-mono text-data-mono font-bold text-primary">
                                                ₹{(analysisResult.monte_carlo.var_95 / 10000000).toFixed(2)} Cr
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-stack-sm bg-surface-container-low border border-outline-variant rounded p-3">
                                        <div className="font-label-caps text-label-caps text-on-surface-variant mb-1">Optimized Patch Selection</div>
                                        <div className="font-body-sm text-body-sm">
                                            {analysisResult.optimization.selected_patches.join(', ') || 'None within budget'}
                                        </div>
                                        <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                                            Total cost: ₹{Number(analysisResult.optimization.total_cost).toLocaleString()} · Risk reduced: ₹{Number(analysisResult.optimization.total_risk_reduced).toLocaleString()}
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

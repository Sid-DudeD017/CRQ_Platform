"use client";
import React from 'react';

// The public marketing splash shown before anyone logs in - the "opening
// page" the login/signup form (AuthScreen) now sits behind, instead of
// being the very first thing a visitor sees. Purely presentational: every
// button here just tells SharedLayout which AuthScreen mode to switch to.
export default function LandingPage({
    onLogin,
    onSignup,
}: {
    onLogin: () => void;
    onSignup: () => void;
}) {
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
        <div className="relative min-h-screen landing-warm-page text-on-background overflow-x-hidden">
            <div className="ambient-glow" aria-hidden="true" />

            {/* Nav */}
            <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5 max-w-[1200px] mx-auto">
                <div className="flex items-center gap-2.5">
                    <img src="/suraksha-logo.png" alt="CRQ Platform" className="h-10 w-auto shrink-0" />
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={onLogin}
                        className="px-5 py-2 rounded-full border border-outline-variant font-body-sm text-body-sm font-semibold hover:bg-surface-container-low transition-colors"
                    >
                        Login
                    </button>
                    <button
                        onClick={onSignup}
                        className="px-5 py-2 rounded-full landing-cta-gradient font-body-sm text-body-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md"
                    >
                        Sign Up
                    </button>
                </div>
            </nav>

            {/* Hero */}
            <section className="relative z-10 max-w-[1200px] mx-auto px-6 sm:px-10 pt-10 sm:pt-16 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                <div>
                    <h1 className="text-display-lg landing-font landing-heading-gradient tracking-tight mb-stack-md">
                        Quantify Cyber Risk in Rupees, Not Colors
                    </h1>
                    <p className="font-body-md text-body-md text-on-surface-variant mb-stack-lg max-w-md">
                        An AI-powered platform that turns telemetry into Annualized Loss Expectancy, optimizes your security budget, and anchors every decision to a blockchain audit trail.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={onSignup}
                            className="px-6 py-3 rounded-full landing-cta-gradient font-body-sm text-body-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-md"
                        >
                            Get Started
                        </button>
                        <button
                            onClick={onLogin}
                            className="px-6 py-3 rounded-full border border-outline-variant font-body-sm text-body-sm font-semibold hover:bg-surface-container-low transition-colors"
                        >
                            Sign In
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
    );
}

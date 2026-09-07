"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { API_BASE, fetchWithRetry } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

interface QuizQuestion {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
}

interface TrainingModule {
    id: string; // must match backend risk_engine.TRAINING_MODULE_IDS exactly
    icon: string;
    title: string;
    framework: string;
    frequency: string;
    detail: string;
    guidelineUrl: string;
    guidelineLabel: string;
    quiz: QuizQuestion;
}

// Ids must stay in sync with backend/risk_engine.py's TRAINING_MODULE_IDS -
// that's the list derive_fair_inputs() checks completions against when it
// computes the org-wide Control Strength training boost.
const TRAINING_MODULES: TrainingModule[] = [
    {
        id: 'baseline-awareness',
        icon: 'security',
        title: 'Cyber Security Awareness (Baseline)',
        framework: 'RBI',
        frequency: 'Annual, all staff',
        detail: "RBI's Cyber Security Framework requires banks and regulated entities to run periodic awareness training covering phishing, social engineering, and incident reporting for every employee, not just IT staff.",
        guidelineUrl: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=10435&Mode=0',
        guidelineLabel: 'Read RBI: Cyber Security Framework in Banks',
        quiz: {
            question: "A colleague forwards an email urgently asking you to click a link to “verify your payroll account” before end of day. What's the right first move?",
            options: [
                'Click the link right away since payroll is time-sensitive',
                "Report it through the official phishing-report channel and don't click anything",
                'Reply to the sender asking them to confirm it is real',
            ],
            correctIndex: 1,
            explanation: "RBI's framework expects every employee, not just IT staff, to know the incident-reporting path. Reporting a suspicious email - even one that turns out to be legitimate - is always the safer default.",
        },
    },
    {
        id: 'phishing-simulation',
        icon: 'phishing',
        title: 'Phishing Simulation & Response Drill',
        framework: 'SEBI CSCRF',
        frequency: 'Quarterly, all staff',
        detail: 'SEBI CSCRF (Aug 2024) expects brokers and market infrastructure institutions to run simulated phishing campaigns and track click-through / report rates as a resilience metric feeding the Anticipate pillar.',
        guidelineUrl: 'https://www.sebi.gov.in/legal/circulars/aug-2024/cybersecurity-and-cyber-resilience-framework-cscrf-for-sebi-regulated-entities-res-_85964.html',
        guidelineLabel: 'Read SEBI: Cybersecurity and Cyber Resilience Framework (CSCRF)',
        quiz: {
            question: 'Your organization runs a simulated phishing drill and you click the link by mistake. What should happen next?',
            options: [
                "Nothing - simulations don't count for anything",
                "It's logged as a training signal so future awareness content can target your team",
                'You are immediately penalized on your performance review',
            ],
            correctIndex: 1,
            explanation: "SEBI CSCRF treats click-through and report rates as resilience metrics feeding the Anticipate pillar - the goal is measuring and improving organizational readiness, not punishing individuals.",
        },
    },
    {
        id: 'dpdp-data-handling',
        icon: 'privacy_tip',
        title: 'Data Handling & Consent (DPDP)',
        framework: 'DPDP Act',
        frequency: 'Annual, staff handling PII',
        detail: "Anyone with access to PII-classified assets (see Asset.data_classification in the data model) needs training on lawful processing, consent capture, and breach-notification obligations under India's DPDP Act 2023.",
        guidelineUrl: 'https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf',
        guidelineLabel: 'Read the Digital Personal Data Protection Act, 2023 (MeitY PDF)',
        quiz: {
            question: "You're handling a spreadsheet of customer PAN numbers and phone numbers (PII) collected for KYC. Your team wants to reuse it for a marketing campaign. What does the DPDP Act require first?",
            options: [
                "Nothing - it's already been collected once",
                'Fresh, specific consent (or another valid legal ground) for that new purpose',
                'Just remove the column headers before reusing it',
            ],
            correctIndex: 1,
            explanation: "The DPDP Act 2023 is built around purpose limitation - processing PII for a new purpose needs its own lawful basis. You can't quietly repurpose data collected for one reason to serve another.",
        },
    },
    {
        id: 'board-briefing',
        icon: 'gavel',
        title: 'Board & Executive Risk Briefing',
        framework: 'RBI',
        frequency: 'Semi-annual, CISO/CFO/Board',
        detail: "Ties directly into this platform's board_approved flag - execs signing off on accepted risk need periodic briefing on how FAIR/Monte Carlo loss estimates and the SEBI Cyber Capability Index are computed, so approvals are informed rather than rubber-stamped.",
        guidelineUrl: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=10435&Mode=0',
        guidelineLabel: 'Read RBI: Cyber Security Framework (board oversight requirements)',
        quiz: {
            question: 'A CISO is about to accept a HIGH-severity residual risk on the Ledger page. What should that decision be backed by?',
            options: [
                "A gut feeling that it's probably fine",
                'A FAIR/Monte Carlo loss estimate the board has been briefed on and can interpret',
                'The fact that nothing bad has happened yet',
            ],
            correctIndex: 1,
            explanation: 'The board_approved flag exists because RBI expects risk acceptance to be an informed executive decision - this module is what makes the FAIR/Monte Carlo numbers behind that button legible to non-technical board members.',
        },
    },
    {
        id: 'secure-sdlc',
        icon: 'account_tree',
        title: 'Secure SDLC for Engineering',
        framework: 'NIST CSF',
        frequency: 'Annual, engineering staff',
        detail: 'Covers secure coding, dependency hygiene, and incident response playbooks - maps to the Protect and Respond functions in the NIST CSF alignment described on the Docs page.',
        guidelineUrl: 'https://www.nist.gov/cyberframework',
        guidelineLabel: 'Read the NIST Cybersecurity Framework (CSF) 2.0',
        quiz: {
            question: "You're about to pull in a new open-source dependency for a feature. What's the secure-SDLC move?",
            options: [
                "Add it and move on - it's open source, so it's safe",
                'Check it for known vulnerabilities and maintenance status first, like any other supply-chain risk',
                'Only worry about it if the security team asks later',
            ],
            correctIndex: 1,
            explanation: "Secure SDLC maps to NIST CSF's Protect function - dependency hygiene (checking for known CVEs, abandoned packages) is one of the highest-leverage habits an engineer can build.",
        },
    },
];

interface ModuleSummary {
    module: string;
    completed_by: string[];
    completed_count: number;
}

interface ProgressData {
    summary: ModuleSummary[];
    coverage_pct: number;
}

// Demo scope: only two accounts exist (see backend/security.py's
// DEMO_CREDENTIALS - CISO and CFO), so "2" is the real denominator for
// "how many people could have completed this module", not a placeholder.
const DEMO_ACCOUNT_COUNT = 2;

// [Platform Navigation Guide] Every one of these describes something real
// and already built elsewhere in the app - not aspirational copy. Kept
// here (rather than scattered as tooltips) so a brand-new user has one
// place that explains what each part of the platform is for and how to
// get there, without it being confused with the compliance modules above
// (those move the FAIR model's Control Strength; this tab is pure
// reference and touches nothing).
interface NavGuideStep {
    icon: string;
    title: string;
    where: string;
    detail: string;
    // Real screenshot of this exact spot in the live app (public/nav-guide/*.png) -
    // not a mockup. The final "About this page" step is self-referential and has none.
    screenshot?: string;
    // Some screenshots (e.g. the chat widget) are naturally narrow/tall rather
    // than wide dashboard captures - stretching those to the full card width
    // looks distorted, so cap and center them instead of going edge-to-edge.
    screenshotNarrow?: boolean;
}

const NAV_GUIDE_STEPS: NavGuideStep[] = [
    {
        icon: 'fork_right',
        title: '1. Pick Demo or Your Own Data',
        where: 'Right after logging in, or anytime via "Switch Dashboard" in the top bar',
        detail: '"Run a demo analysis" drops you straight into a live simulation over realistic pre-loaded telemetry. "Enter your own data" takes you to the Ingestion Engine to upload a real device config instead. You can switch back and forth at any time - nothing you\'ve already run is lost either way.',
        screenshot: '/nav-guide/step-01-pick-data.png',
    },
    {
        icon: 'dashboard',
        title: '2. Overview (Demo) / Ingestion Engine (Own Data)',
        where: 'The first tab in either dashboard',
        detail: 'Demo\'s Overview shows a simulation immediately. Own Data\'s Ingestion Engine has you upload a config file, then walks you through every finding it detected one at a time - confirm the ones that are real, ignore the ones that aren\'t. The Simulation Sandbox only appears once you\'ve worked through every finding.',
        screenshot: '/nav-guide/step-02-overview.png',
    },
    {
        icon: 'monitoring',
        title: '3. The Simulation Sandbox',
        where: 'Bottom of Overview / Ingestion, once findings are reviewed',
        detail: 'Set a remediation budget and toggle the Strategic Controls (MFA, Zero Trust, 24/7 SOC Monitoring, and more), then click "Run Simulation" for a fresh 10,000-iteration Monte Carlo run - Expected Annual Loss, Value at Risk, and a loss-distribution chart, all recomputed live.',
        screenshot: '/nav-guide/step-03-sandbox.png',
    },
    {
        icon: 'gavel',
        title: '4. Accept Risk or Approve a Plan',
        where: 'Directly under a simulation\'s results',
        detail: 'Once you have a result you\'re comfortable with, either accept the residual risk as-is or approve the optimizer\'s recommended patch plan. Both are logged as an auditable decision - see Ledger below.',
        screenshot: '/nav-guide/step-04-accept-risk.png',
    },
    {
        icon: 'trending_up',
        title: '5. Investment',
        where: 'Top nav',
        detail: 'A step-by-step guide to where your remediation budget should actually go. Demo mode pre-selects the optimizer\'s picks for you; Own Data mode lets you choose controls yourself, budget-aware, with a button to see what the optimizer would have picked instead.',
        screenshot: '/nav-guide/step-05-investment.png',
    },
    {
        icon: 'receipt_long',
        title: '6. Ledger',
        where: 'Top nav',
        detail: 'Every risk you\'ve accepted or plan you\'ve approved, with the option to commit any decision to a local blockchain for a tamper-evident audit trail. Demo and Own Data keep completely separate ledgers, with separate on-chain commits.',
        screenshot: '/nav-guide/step-06-ledger.png',
    },
    {
        icon: 'target',
        title: '7. Calibration',
        where: 'Top nav',
        detail: 'Log what actually happened after a real (or near-miss) incident. The model compares that outcome to what it had predicted and recalibrates control-effectiveness and confidence bands for every simulation you run afterward - this is what makes the model get sharper over time instead of repeating the same static assumptions.',
        screenshot: '/nav-guide/step-07-calibration.png',
    },
    {
        icon: 'assessment',
        title: '8. Reports',
        where: 'Top nav',
        detail: 'A board-ready snapshot: total risk accepted, audit-trail integrity, a run-over-run simulation history chart, and the Framework Coverage Matrix crosswalking your active controls to NIST CSF, ISO/IEC 27001, and CIS Controls v8. Downloadable as a self-contained report.',
        screenshot: '/nav-guide/step-08-reports.png',
    },
    {
        icon: 'auto_awesome',
        title: '9. Virtual CISO Chat',
        where: 'Chat icon, bottom-right corner, on every dashboard page',
        detail: 'An AI assistant that can answer security and compliance questions using this session\'s actual live risk data - not a generic chatbot reciting boilerplate.',
        screenshot: '/nav-guide/step-09-chat.png',
        screenshotNarrow: true,
    },
    {
        icon: 'search',
        title: '10. Command Palette',
        where: 'The search bar in the top nav',
        detail: 'Jump to any page instantly instead of hunting through the nav bar - useful once you\'re moving between Overview/Ingestion, Investment, Ledger, Calibration, and Reports regularly.',
        screenshot: '/nav-guide/step-10-command-palette.png',
    },
    {
        icon: 'model_training',
        title: 'About this Training page',
        where: 'You\'re on it - reachable anytime via "Switch Dashboard"',
        detail: 'The "Security & Compliance Training" tab is the only part of this page that feeds the model - completing those modules raises the Control Strength boost used in every simulation. This "Platform Navigation Guide" tab is pure reference: reading it doesn\'t change any number anywhere.',
    },
];

function QuickCheck({ quiz }: { quiz: QuizQuestion }) {
    const [selected, setSelected] = useState<number | null>(null);
    const isCorrect = selected !== null && selected === quiz.correctIndex;

    return (
        <div className="bg-surface-container-low border border-outline-variant rounded-lg p-stack-md">
            <p className="font-label-caps text-label-caps text-primary mb-stack-sm flex items-center gap-1.5">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">quiz</span>
                Quick check
            </p>
            <p className="font-body-sm text-body-sm mb-stack-sm">{quiz.question}</p>
            <div className="flex flex-col gap-2">
                {quiz.options.map((opt, i) => {
                    const isSelected = selected === i;
                    const isRight = i === quiz.correctIndex;
                    let style = 'border-outline-variant hover:border-primary';
                    if (selected !== null) {
                        if (isRight) style = 'border-[#15803d] bg-[#15803d]/10';
                        else if (isSelected) style = 'border-error bg-error/10';
                        else style = 'border-outline-variant opacity-50';
                    }
                    return (
                        <button
                            key={i}
                            type="button"
                            onClick={() => setSelected(i)}
                            // [Retry on a wrong answer - fix] Previously every
                            // option locked forever after the first pick, right
                            // or wrong, so a wrong guess had no way to try
                            // again. Only the correct pick now ends the
                            // question - a wrong one stays clickable so the
                            // learner can keep trying.
                            disabled={isCorrect}
                            aria-pressed={isSelected}
                            className={`text-left font-body-sm text-body-sm px-3 py-2 rounded border transition-colors disabled:cursor-default ${style}`}
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
            {selected !== null && (
                <p className={`font-body-sm text-body-sm mt-stack-sm flex gap-1.5 items-start ${isCorrect ? 'text-[#15803d]' : 'text-error'}`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px] mt-0.5">{isCorrect ? 'check_circle' : 'info'}</span>
                    <span>{quiz.explanation}</span>
                </p>
            )}
        </div>
    );
}

function ModuleCard({
    module: m,
    summary,
    isLoggedIn,
    isCompletedByMe,
    isToggling,
    onToggle,
}: {
    module: TrainingModule;
    summary: ModuleSummary | undefined;
    isLoggedIn: boolean;
    isCompletedByMe: boolean;
    isToggling: boolean;
    onToggle: () => void;
}) {
    const completedCount = summary?.completed_count ?? 0;

    return (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col gap-stack-sm">
            <div className="flex gap-stack-md items-start">
                <span aria-hidden="true" className="material-symbols-outlined text-[24px] text-primary mt-0.5">{m.icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-body-sm text-body-sm font-semibold">{m.title}</span>
                        <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded">{m.framework}</span>
                        {isCompletedByMe && (
                            <span className="font-label-caps text-label-caps px-2 py-0.5 bg-[#15803d]/15 text-[#15803d] rounded flex items-center gap-1">
                                <span aria-hidden="true" className="material-symbols-outlined text-[12px]">check_circle</span>
                                Completed by you
                            </span>
                        )}
                    </div>
                    <p className="font-data-mono text-data-mono text-on-surface-variant mt-1">{m.frequency}</p>
                </div>
            </div>

            <p className="font-body-sm text-body-sm text-on-surface-variant sm:pl-[36px]">{m.detail}</p>

            <div className="sm:pl-[36px]">
                <QuickCheck quiz={m.quiz} />
            </div>

            <div className="sm:pl-[36px] flex flex-wrap items-center gap-x-stack-sm gap-y-2 mt-1">
                <a
                    href={m.guidelineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label-caps text-label-caps text-primary hover:underline flex items-center gap-1"
                >
                    {m.guidelineLabel}
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span>
                </a>
                <span
                    className="font-data-mono text-data-mono text-on-surface-variant cursor-help"
                    title={`This demo environment has exactly ${DEMO_ACCOUNT_COUNT} named accounts (CISO and CFO). ${completedCount} of those ${DEMO_ACCOUNT_COUNT} have completed this module - it is not a percentage of your organization's real headcount.`}
                >
                    {completedCount} / {DEMO_ACCOUNT_COUNT} accounts completed
                </span>
                <button
                    type="button"
                    onClick={onToggle}
                    disabled={isToggling || !isLoggedIn}
                    title={!isLoggedIn ? 'Log in (top-right) to track completion' : undefined}
                    className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded font-body-sm text-body-sm transition-colors active:scale-95 disabled:opacity-50 whitespace-nowrap ${
                        isCompletedByMe
                            ? 'border border-outline-variant text-on-surface-variant hover:border-error hover:text-error'
                            : 'bg-primary text-on-primary hover:opacity-90'
                    }`}
                >
                    {isToggling ? (
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    ) : (
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{isCompletedByMe ? 'undo' : 'check'}</span>
                    )}
                    {isCompletedByMe ? 'Mark incomplete' : 'Mark complete'}
                </button>
            </div>
            {!isLoggedIn && (
                <p className="sm:pl-[36px] font-label-caps text-label-caps text-on-surface-variant">Log in (top-right) to track completion</p>
            )}
        </div>
    );
}

// [Platform Navigation Guide carousel] Replaced the old static 2-column grid
// of NavGuideCard - one step visible at a time, with Prev/Next arrows and a
// dot/step-counter indicator, each step backed by a real screenshot of that
// exact spot in the live app (public/nav-guide/*.png), not a mockup.
function NavGuideCarousel({ steps }: { steps: NavGuideStep[] }) {
    const [index, setIndex] = useState(0);
    const step = steps[index];
    const isFirst = index === 0;
    const isLast = index === steps.length - 1;

    const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
    const goNext = useCallback(() => setIndex((i) => Math.min(steps.length - 1, i + 1)), [steps.length]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [goPrev, goNext]);

    return (
        <div className="flex flex-col gap-stack-md">
            <div className="flex items-center justify-center gap-stack-md">
                <button
                    type="button"
                    onClick={goPrev}
                    disabled={isFirst}
                    aria-label="Previous step"
                    className="w-9 h-9 rounded-full border border-outline-variant flex items-center justify-center hover:border-primary hover:text-primary disabled:opacity-30 disabled:hover:border-outline-variant disabled:hover:text-current transition-colors shrink-0"
                >
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>

                <div className="flex flex-col items-center gap-1.5">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">
                        Step {index + 1} of {steps.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                        {steps.map((s, i) => (
                            <button
                                key={s.title}
                                type="button"
                                onClick={() => setIndex(i)}
                                aria-label={`Go to step ${i + 1}: ${s.title}`}
                                aria-current={i === index}
                                className={`rounded-full transition-all ${
                                    i === index ? 'w-5 h-2 bg-primary' : 'w-2 h-2 bg-outline-variant hover:bg-primary/50'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={goNext}
                    disabled={isLast}
                    aria-label="Next step"
                    className="w-9 h-9 rounded-full border border-outline-variant flex items-center justify-center hover:border-primary hover:text-primary disabled:opacity-30 disabled:hover:border-outline-variant disabled:hover:text-current transition-colors shrink-0"
                >
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter w-full">
                {/* Text first, screenshot below at full card width - the earlier
                    side-by-side layout fought the browser over the screenshot's
                    large intrinsic pixel width (flex items don't shrink below
                    their content's natural size unless told to) and produced a
                    lopsided, mostly-blank row. A plain full-width stack with an
                    explicit gap can't have that problem: the image always fills
                    the card, with real breathing room above it. */}
                <div className="flex flex-col gap-stack-md">
                    {step.screenshot && (
                        <div
                            className={`min-w-0 border-2 border-outline-variant rounded-lg overflow-hidden bg-surface-container ${
                                step.screenshotNarrow ? 'w-full max-w-[360px] mx-auto' : 'w-full'
                            }`}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={step.screenshot} alt={`Screenshot: ${step.title}`} className="w-full h-auto block" />
                        </div>
                    )}
                    <div className="flex gap-stack-md items-start">
                        <span className="w-9 h-9 rounded-full landing-icon-badge flex items-center justify-center shrink-0">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{step.icon}</span>
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="font-title-lg text-title-lg">{step.title}</p>
                            <p className="font-data-mono text-data-mono text-on-surface-variant mt-0.5">{step.where}</p>
                        </div>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant sm:pl-[48px]">{step.detail}</p>
                </div>
            </div>
        </div>
    );
}

export default function TrainingPage() {
    const { token, username } = useAuth();
    const { showToast } = useToast();
    const [progress, setProgress] = useState<ProgressData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingModule, setTogglingModule] = useState<string | null>(null);
    // [Platform Navigation Guide] This page covers two genuinely different
    // things - the compliance quiz modules that actually feed the FAIR
    // model's Control Strength boost, and a pure-reference walkthrough of
    // how to use/navigate the rest of the platform. Keeping them as tabs
    // on one page (rather than the guide living somewhere else) is what
    // makes this page unambiguously "Training", not a stray dashboard tab.
    const [activeTab, setActiveTab] = useState<'compliance' | 'navigation'>('compliance');

    const fetchProgress = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/training/progress`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            setProgress({ summary: data.summary || [], coverage_pct: data.coverage_pct ?? 0 });
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Could not load training progress. Is the backend running on port 8000?');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProgress();
        // Same Router-Cache defense-in-depth as the Ledger page: re-check
        // progress on tab focus / visibility so a completion logged from
        // another tab (or by the other demo account) shows up here.
        const onFocus = () => fetchProgress();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') fetchProgress();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchProgress]);

    const toggleComplete = async (moduleId: string) => {
        if (!token) {
            showToast('Log in as CISO or CFO (top-right corner) to track training completion.', 'error');
            return;
        }
        setTogglingModule(moduleId);
        try {
            const res = await fetchWithRetry(`${API_BASE}/api/training/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ module: moduleId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
            const moduleTitle = TRAINING_MODULES.find((m) => m.id === moduleId)?.title || moduleId;
            showToast(
                data.completed
                    ? `Marked "${moduleTitle}" complete - Control Strength boost updates on Overview.`
                    : `Unmarked "${moduleTitle}".`,
                'success'
            );
            await fetchProgress();
        } catch (e: any) {
            console.error(e);
            showToast(e.message || 'Could not update training completion. Is the backend running on port 8000?', 'error');
        } finally {
            setTogglingModule(null);
        }
    };

    const summaryByModule = new Map((progress?.summary || []).map((s) => [s.module, s]));
    const coveragePct = progress?.coverage_pct ?? 0;
    const boostPts = (coveragePct / 100) * 10;
    const modulesCovered = (progress?.summary || []).filter((s) => s.completed_count > 0).length;

    return (
        <div className="max-w-[1000px] mx-auto flex flex-col gap-stack-lg">
            <div>
                <h1 className="font-headline-md text-headline-md text-primary mb-1 landing-font landing-heading-gradient">Training</h1>
                <p className="font-body-md text-body-md text-on-surface-variant">
                    Everything about learning this platform lives here - the compliance modules your risk model assumes are in place, and a plain-language guide to what every other page does and how to get to it.
                </p>
            </div>

            {/* Tab switcher - deliberately just these two. This page is not
                a dashboard tab: no Overview, Investment, Ledger, Calibration
                or Reports content belongs here. */}
            <div className="flex gap-2 border-b border-outline-variant">
                <button
                    type="button"
                    onClick={() => setActiveTab('compliance')}
                    className={`px-4 py-2.5 font-body-sm text-body-sm font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                        activeTab === 'compliance' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'
                    }`}
                >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">school</span>
                    Security &amp; Compliance Training
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('navigation')}
                    className={`px-4 py-2.5 font-body-sm text-body-sm font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                        activeTab === 'navigation' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'
                    }`}
                >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">map</span>
                    Platform Navigation Guide
                </button>
            </div>

            {activeTab === 'compliance' && (
                <>
                    {/* Coverage hero - real chart, real data, tied explicitly to the FAIR calc */}
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter grid grid-cols-1 md:grid-cols-[160px_1fr] gap-gutter items-center">
                        <div className="relative w-[160px] h-[160px] mx-auto">
                            {isLoading ? (
                                <div className="w-full h-full rounded-full bg-surface-variant/40 animate-pulse" />
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadialBarChart
                                            innerRadius="72%"
                                            outerRadius="100%"
                                            data={[{ value: coveragePct, fill: 'var(--primary)' }]}
                                            startAngle={90}
                                            endAngle={-270}
                                        >
                                            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                                            <RadialBar background dataKey="value" cornerRadius={8} />
                                        </RadialBarChart>
                                    </ResponsiveContainer>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                        <span className="font-headline-md text-headline-md font-data-mono text-primary">{coveragePct.toFixed(0)}%</span>
                                        <span className="font-label-caps text-label-caps text-on-surface-variant">coverage</span>
                                    </div>
                                </>
                            )}
                        </div>
                        <div>
                            <h3 className="font-title-lg text-title-lg text-primary mb-1">Organization-wide training coverage</h3>
                            <p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-sm">
                                {isLoading
                                    ? 'Loading...'
                                    : error
                                        ? error
                                        : `${modulesCovered} of ${TRAINING_MODULES.length} required modules have at least one completion logged (by either demo account - see the per-account counts below for which one).`}
                                {' '}This isn&apos;t just a checklist - <code className="font-data-mono text-data-mono">derive_fair_inputs()</code> on the backend folds this coverage into a real Control Strength boost (up to +10 points at 100% coverage), so completing a module here actually moves the Expected Annual Loss on Overview, not just a badge on this page.
                            </p>
                            <div className="flex items-center gap-2 font-data-mono text-data-mono text-primary">
                                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">bolt</span>
                                +{boostPts.toFixed(1)} pts to Control Strength right now
                            </div>
                        </div>
                    </div>

                    {!token && (
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex gap-stack-sm items-center">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant">lock</span>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">
                                Log in as CISO or CFO (top-right corner) to mark modules complete and count toward the coverage above.
                            </p>
                        </div>
                    )}

                    {/* Coverage by module - compact bar breakdown */}
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                        <h3 className="font-title-lg text-title-lg text-primary mb-1">Coverage by module</h3>
                        <p className="font-body-sm text-[12px] text-on-surface-variant mb-stack-md">
                            Demo scope: exactly {DEMO_ACCOUNT_COUNT} named accounts exist here (CISO and CFO). Each row below counts how many of those {DEMO_ACCOUNT_COUNT} have completed that module - not your organization&apos;s total headcount.
                        </p>
                        <div className="flex flex-col gap-stack-sm">
                            {isLoading ? (
                                [100, 60, 40, 20, 10].map((w, i) => (
                                    <div key={i} className="flex flex-col gap-1">
                                        <div className="h-3 w-40 bg-surface-variant/40 rounded animate-pulse" />
                                        <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                                            <div className="h-2 rounded bg-surface-variant/40 animate-pulse" style={{ width: `${w}%` }} />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                TRAINING_MODULES.map((m) => {
                                    const s = summaryByModule.get(m.id);
                                    const count = s?.completed_count ?? 0;
                                    const pct = (count / DEMO_ACCOUNT_COUNT) * 100;
                                    return (
                                        <div key={m.id}>
                                            <div className="flex justify-between items-end mb-1">
                                                <span className="font-body-sm text-body-sm font-medium">{m.title}</span>
                                                <span className="font-data-mono text-data-mono text-on-surface-variant cursor-help" title={`${count} of the ${DEMO_ACCOUNT_COUNT} demo accounts (CISO, CFO) have completed this module.`}>{count}/{DEMO_ACCOUNT_COUNT}</span>
                                            </div>
                                            <div className="w-full bg-surface-container h-2 rounded overflow-hidden">
                                                <div
                                                    className={`h-2 rounded ${count > 0 ? 'bg-primary' : 'bg-surface-variant/40'}`}
                                                    style={{ width: `${Math.max(count > 0 ? 4 : 0, pct)}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Why this page exists */}
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                        <div className="flex gap-stack-sm items-start">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">info</span>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">
                                The FAIR model&apos;s Control Strength input and the SEBI Cyber Capability Index both assume a trained workforce - untrained staff show up indirectly as weaker control strength and lower Withstand/Anticipate scores on the Reports page. The modules below are what that training program actually needs to cover.
                            </p>
                        </div>
                    </div>

                    {/* Required Modules - interactive learning cards */}
                    <div>
                        <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Required Training Modules</h3>
                        <div className="flex flex-col gap-stack-sm">
                            {TRAINING_MODULES.map((m) => {
                                const summary = summaryByModule.get(m.id);
                                const isCompletedByMe = !!username && !!summary?.completed_by.includes(username);
                                return (
                                    <ModuleCard
                                        key={m.id}
                                        module={m}
                                        summary={summary}
                                        isLoggedIn={!!token}
                                        isCompletedByMe={isCompletedByMe}
                                        isToggling={togglingModule === m.id}
                                        onToggle={() => toggleComplete(m.id)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'navigation' && (
                <div className="flex flex-col gap-stack-md">
                    <NavGuideCarousel steps={NAV_GUIDE_STEPS} />
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                        <div className="flex gap-stack-sm items-start">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">info</span>
                            <p className="font-body-sm text-body-sm text-on-surface-variant">
                                A plain-language map of the platform, in the order you&apos;d actually use it. This tab is reference only - nothing here changes any number, unlike the compliance modules on the other tab.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <a href="/overview" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

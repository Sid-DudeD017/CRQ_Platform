const TRAINING_MODULES = [
    {
        icon: 'security',
        title: 'Cyber Security Awareness (Baseline)',
        framework: 'RBI',
        frequency: 'Annual, all staff',
        detail: "RBI's Cyber Security Framework requires banks and regulated entities to run periodic awareness training covering phishing, social engineering, and incident reporting for every employee, not just IT staff.",
    },
    {
        icon: 'phishing',
        title: 'Phishing Simulation & Response Drill',
        framework: 'SEBI CSCRF',
        frequency: 'Quarterly, all staff',
        detail: 'SEBI CSCRF (Aug 2024) expects brokers and market infrastructure institutions to run simulated phishing campaigns and track click-through / report rates as a resilience metric feeding the Anticipate pillar.',
    },
    {
        icon: 'privacy_tip',
        title: 'Data Handling & Consent (DPDP)',
        framework: 'DPDP Act',
        frequency: 'Annual, staff handling PII',
        detail: "Anyone with access to PII-classified assets (see Asset.data_classification in the data model) needs training on lawful processing, consent capture, and breach-notification obligations under India's DPDP Act 2023.",
    },
    {
        icon: 'gavel',
        title: 'Board & Executive Risk Briefing',
        framework: 'RBI',
        frequency: 'Semi-annual, CISO/CFO/Board',
        detail: "Ties directly into this platform's board_approved flag - execs signing off on accepted risk need periodic briefing on how FAIR/Monte Carlo loss estimates and the SEBI Cyber Capability Index are computed, so approvals are informed rather than rubber-stamped.",
    },
    {
        icon: 'account_tree',
        title: 'Secure SDLC for Engineering',
        framework: 'NIST CSF',
        frequency: 'Annual, engineering staff',
        detail: 'Covers secure coding, dependency hygiene, and incident response playbooks - maps to the Protect and Respond functions in the NIST CSF alignment described on the Docs page.',
    },
];

export default function TrainingPage() {
    return (
        <div className="max-w-[1000px] mx-auto flex flex-col gap-stack-lg">
            <div>
                <h1 className="font-headline-md text-headline-md text-primary mb-1">Training</h1>
                <p className="font-body-md text-body-md text-on-surface-variant">
                    The security-awareness and compliance training this platform's risk model assumes is in place.
                </p>
            </div>

            {/* Why this page exists */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <div className="flex gap-stack-sm items-start">
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-0.5">info</span>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        The FAIR model's Control Strength input and the SEBI Cyber Capability Index both assume a trained workforce - untrained staff show up indirectly as weaker control strength and lower Withstand/Anticipate scores on the Reports page. This page documents what that training program actually needs to cover.
                    </p>
                </div>
            </div>

            {/* Required Modules */}
            <div>
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-md">Required Training Modules</h3>
                <div className="flex flex-col gap-stack-md">
                    {TRAINING_MODULES.map((m, i) => (
                        <div key={i} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex gap-stack-md items-start">
                            <span className="material-symbols-outlined text-[24px] text-primary mt-0.5">{m.icon}</span>
                            <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className="font-body-sm text-body-sm font-semibold">{m.title}</span>
                                    <span className="font-label-caps text-label-caps px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded">{m.framework}</span>
                                </div>
                                <p className="font-body-sm text-body-sm text-on-surface-variant mb-1">{m.detail}</p>
                                <p className="font-data-mono text-data-mono text-on-surface-variant/80">{m.frequency}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Roadmap note - honest about current scope */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter">
                <h3 className="font-title-lg text-title-lg text-primary mb-stack-sm">Completion Tracking - Not Yet Built</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                    There's no TrainingRecord table or API endpoint behind this page yet - the modules above are the real requirement, not live completion data. The natural next step is a per-employee completion record (module, date, score) that feeds back into the FAIR control-strength inputs on Overview, the same way telemetry from EDR/CSPM does today.
                </p>
            </div>

            <a href="/" className="self-start bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity font-body-sm text-body-sm">
                Back to Dashboard
            </a>
        </div>
    );
}

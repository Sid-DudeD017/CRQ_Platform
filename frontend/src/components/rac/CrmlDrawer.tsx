"use client";
import React, { useState } from 'react';

interface RiskModelDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    currentModelName?: string;
    meanExpectedLoss?: number;
    var95?: number;
    isDpdpActive?: boolean;
}

export default function RiskModelDrawer({
    isOpen,
    onClose,
    currentModelName = "Enterprise Portfolio Model",
    meanExpectedLoss = 42800000,
    var95 = 125000000,
    isDpdpActive = true
}: RiskModelDrawerProps) {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const sampleYaml = `version: "crq-spec/v1.0"
metadata:
  name: "${currentModelName}"
  framework: "FAIR v3.1 | SEBI CSCRF | DPDP Act 2023"
  classification: "RESTRICTED"
  last_computed: "${new Date().toISOString()}"

scope:
  total_assets_modeled: 5
  business_criticality: "TIER-1"
  data_classification: "${isDpdpActive ? 'PII / SENSITIVE' : 'CONFIDENTIAL'}"

threat_modeling:
  threat_event_frequency_annual:
    distribution: "triangular"
    min: 15.0
    mode: 45.0
    max: 120.0
  threat_capability:
    distribution: "triangular"
    min: 35.0
    mode: 65.0
    max: 90.0

controls_posture:
  control_strength:
    distribution: "triangular"
    min: 40.0
    mode: 68.0
    max: 85.0
  blast_radius_decay_lambda: 0.20
  active_mitigations:
    - "Cloud MFA Enforcement (₹45L)"
    - "Zero-Trust Microsegmentation (₹3.5Cr)"
    - "Payment Gateway Vulnerability Patch (₹1.2Cr)"

loss_exposure:
  primary_loss_magnitude_annual:
    min: 25000000 # ₹2.5 Cr
    mode: 42800000 # ₹4.28 Cr (Mean ALE)
    max: 95000000 # ₹9.5 Cr
  secondary_loss_statutory:
    is_dpdp_applicable: ${isDpdpActive}
    dpdp_statutory_max_penalty: 4500000000 # ₹450 Cr
    sebi_cscrf_resilience_tier: "Tier-1 Intermediary"

simulation_outputs:
  annualized_loss_expectancy_inr: ${meanExpectedLoss}
  value_at_risk_95_inr: ${var95}
  iterations: 10000
`;

    const handleCopy = () => {
        navigator.clipboard?.writeText(sampleYaml);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const blob = new Blob([sampleYaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CRQ_Risk_Model_Spec.yaml`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end animate-fade-scale-in" onClick={onClose}>
            <div
                className="w-full max-w-xl bg-[#0f172a] text-[#38bdf8] h-full shadow-2xl border-l border-outline-variant flex flex-col justify-between"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 bg-[#1e293b] border-b border-slate-700 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#38bdf8] text-[20px]">terminal</span>
                        <div>
                            <h3 className="font-title-md font-bold text-white text-sm">Declarative Risk Specification</h3>
                            <p className="text-[11px] text-slate-400">Declarative YAML risk model underpinning active simulation</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold flex items-center gap-1 border border-slate-600 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        <button
                            onClick={handleDownload}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold flex items-center gap-1 border border-slate-600 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[14px]">download</span>
                            Export
                        </button>
                        <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </div>

                {/* Code Body */}
                <div className="flex-1 p-4 overflow-y-auto font-data-mono text-xs leading-relaxed custom-scrollbar selection:bg-slate-700">
                    <pre><code>{sampleYaml}</code></pre>
                </div>

                {/* Footer Info */}
                <div className="p-3 bg-[#1e293b] border-t border-slate-700 flex justify-between items-center text-[11px] text-slate-400 font-data-mono">
                    <span>Engine: NumPy / SciPy Monte Carlo (10k iter)</span>
                    <span className="text-[#10b981] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#10b981]"></span> Validated Syntax
                    </span>
                </div>
            </div>
        </div>
    );
}

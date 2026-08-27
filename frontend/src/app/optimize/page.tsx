"use client";
import React from 'react';

export default function OptimizePage() {
    return (
        <>

{/*  Header Section  */}
<div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-stack-lg gap-stack-md">
<div>
<h2 className="font-headline-md text-headline-md text-primary mb-unit">Investment Optimizer</h2>
<p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">Allocate security budget to maximize risk reduction. The model identifies the optimal point of diminishing returns across proposed projects.</p>
</div>
<div className="flex gap-stack-sm">
<button className="bg-surface border border-outline-variant text-on-surface py-2 px-4 rounded-lg font-body-md text-body-md flex items-center gap-2 hover:border-primary transition-colors">
<span className="material-symbols-outlined text-sm">download</span> Export Plan
                    </button>
<button className="bg-primary text-on-primary py-2 px-4 rounded-lg font-body-md text-body-md hover:opacity-90 transition-opacity"><span className="material-symbols-outlined text-sm mr-2">lock</span>Approve &amp; Log to Ledger</button>
</div>
</div>
{/*  Bento Grid Layout  */}
<div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
{/*  Left Column: S-Curve & KPI  */}
<div className="lg:col-span-8 flex flex-col gap-gutter">
{/*  KPI Row  */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
<div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Current Budget</div>
<div className="font-data-mono text-data-mono text-display-lg text-primary">₹1.0<span className="text-headline-sm">Cr</span></div>
<div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">Allocated for FY24</div>
</div>
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
<div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Optimized Risk Reduction</div>
<div className="flex items-end gap-2">
<div className="font-data-mono text-data-mono text-display-lg text-primary">68<span className="text-headline-sm">%</span></div>
<div className="flex items-center text-error bg-error-container px-2 py-1 rounded mb-2">
<span className="material-symbols-outlined text-sm" style={{fontVariationSettings: "'FILL' 1"}}>arrow_downward</span>
</div>
</div>
<div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">Expected decrease in ALE</div>
</div>
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm">
<div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-stack-sm">Residual Exposure</div>
<div className="font-data-mono text-data-mono text-display-lg text-secondary">₹3.2<span className="text-headline-sm">Cr</span></div>
<div className="font-body-sm text-body-sm text-on-surface-variant mt-unit">Post-implementation</div>
</div>
</div>
{/*  S-Curve Chart Card  */}
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter shadow-sm flex-1 min-h-[400px] flex flex-col relative overflow-hidden">
<div className="flex justify-between items-center mb-stack-lg z-10">
<div>
<h3 className="font-title-lg text-title-lg text-primary">Efficiency Frontier (S-Curve)</h3>
<p className="font-body-sm text-body-sm text-on-surface-variant">Investment vs Risk Reduction</p>
</div>
<div className="flex items-center gap-2">
<span className="w-3 h-3 rounded-full bg-primary block"></span>
<span className="font-body-sm text-body-sm text-on-surface-variant">Optimal Point</span>
</div>
</div>
{/*  Chart Area Placeholder (Simulated with structural CSS/SVG logic)  */}
<div className="flex-1 relative w-full h-full min-h-[250px] border-l border-b border-outline-variant mt-4 z-10">
{/*  Y Axis Labels  */}
<div className="absolute -left-8 top-0 bottom-0 flex flex-col justify-between text-right font-data-mono text-data-mono text-xs text-on-surface-variant h-full pb-6">
<span className="">100%</span>
<span className="">75%</span>
<span className="">50%</span>
<span className="">25%</span>
<span className="">0%</span>
</div>
{/*  X Axis Labels  */}
<div className="absolute left-0 right-0 -bottom-6 flex justify-between font-data-mono text-data-mono text-xs text-on-surface-variant w-full pl-2">
<span className="">₹0</span>
<span className="">₹25L</span>
<span className="">₹50L</span>
<span className="">₹75L</span>
<span className="">₹1Cr</span>
<span className="">₹1.5Cr</span>
</div>
{/*  Grid Lines  */}
<div className="absolute inset-0 w-full h-full flex flex-col justify-between pointer-events-none opacity-20">
<div className="w-full border-t border-outline-variant"></div>
<div className="w-full border-t border-outline-variant"></div>
<div className="w-full border-t border-outline-variant"></div>
<div className="w-full border-t border-outline-variant"></div>
<div className="w-full border-t border-outline-variant"></div>
</div>
<div className="absolute inset-0 w-full h-full flex justify-between pointer-events-none opacity-20">
<div className="h-full border-l border-outline-variant"></div>
<div className="h-full border-l border-outline-variant"></div>
<div className="h-full border-l border-outline-variant"></div>
<div className="h-full border-l border-outline-variant"></div>
<div className="h-full border-l border-outline-variant"></div>
<div className="h-full border-l border-outline-variant"></div>
</div>
{/*  The Curve  */}
<svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
<path className="opacity-80" d="M 0 100 C 30 95, 40 40, 60 25 C 80 10, 95 5, 100 0" fill="none" stroke="#000000" stroke-dasharray="4" stroke-width="2"></path>
<path d="M 0 100 C 30 98, 45 35, 75 32" fill="none" stroke="#000000" stroke-width="3"></path>
{/*  Optimal Point Marker  */}
<circle className="shadow-lg" cx="75" cy="32" fill="#000000" r="3"></circle>
{/*  Diminishing Returns Area Highlight  */}
<rect className="opacity-40" fill="#f2f4f6" height="100" width="25" x="75" y="0"></rect>
</svg>
{/*  Tooltip/Marker Annotation  */}
<div className="absolute" style={{left: "75%", top: "32%", transform: "translate(-50%, -120%)"}}>
<div className="bg-primary text-on-primary text-xs py-1 px-2 rounded shadow-md whitespace-nowrap font-data-mono">
                                    Diminishing Returns
                                </div>
<div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-primary mx-auto"></div>
</div>
{/*  Current Budget Line  */}
<div className="absolute top-0 bottom-0 border-r-2 border-error border-dashed pointer-events-none" style={{left: "66.6%"}}>
<div className="absolute top-2 -left-[4.5rem] bg-surface-container text-error text-xs py-1 px-2 rounded font-data-mono border border-error/20 whitespace-nowrap">Current Budget</div>
</div>
</div>
</div>
</div>
{/*  Right Column: Knapsack Optimizer Plan  */}
<div className="lg:col-span-4 flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm h-full max-h-[800px] overflow-hidden">
<div className="p-gutter border-b border-outline-variant bg-surface">
<div className="flex justify-between items-center mb-unit">
<h3 className="font-title-lg text-title-lg text-primary">Optimizer Plan</h3>
<span className="bg-secondary-container text-on-secondary-container text-xs font-bold px-2 py-1 rounded-full">Knapsack Model</span>
</div>
<p className="font-body-sm text-body-sm text-on-surface-variant">Prioritized project list based on highest ROSI within budget constraints.</p>
</div>
{/*  Project List  */}
<div className="flex-1 overflow-y-auto p-gutter flex flex-col gap-stack-md custom-scrollbar">
{/*  Project Item 1 (Included)  */}
<div className="border border-outline-variant rounded-lg p-stack-md bg-surface transition-colors hover:border-primary cursor-pointer relative overflow-hidden group">
<div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
<div className="flex justify-between items-start mb-stack-sm pl-2">
<div>
<h4 className="font-title-lg text-title-lg text-primary text-base">Project A: Enterprise MFA</h4>
<div className="flex gap-2 mt-1">
<span className="bg-surface-container-high text-on-surface-variant text-[10px] uppercase font-bold px-2 py-0.5 rounded">Access</span>
<span className="bg-surface-container-high text-on-surface-variant text-[10px] uppercase font-bold px-2 py-0.5 rounded">High Impact</span>
</div>
</div>
<div className="text-right">
<div className="font-data-mono text-data-mono text-sm font-bold text-primary">₹25 L</div>
<div className="font-body-sm text-body-sm text-on-surface-variant text-xs">Cost</div>
</div>
</div>
<div className="flex justify-between items-center mt-stack-md pt-stack-sm border-t border-outline-variant pl-2">
<div className="flex items-center gap-2">
<span className="material-symbols-outlined text-primary text-sm" style={{fontVariationSettings: "'FILL' 1"}}>check_circle</span>
<span className="font-label-caps text-label-caps text-primary">Included</span>
</div>
<div className="text-right">
<span className="font-data-mono text-data-mono text-sm text-error font-bold">28% ROSI</span>
</div>
</div>
</div>
{/*  Project Item 2 (Included)  */}
<div className="border border-outline-variant rounded-lg p-stack-md bg-surface transition-colors hover:border-primary cursor-pointer relative overflow-hidden group">
<div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
<div className="flex justify-between items-start mb-stack-sm pl-2">
<div>
<h4 className="font-title-lg text-title-lg text-primary text-base">Project B: EDR Deployment</h4>
<div className="flex gap-2 mt-1">
<span className="bg-surface-container-high text-on-surface-variant text-[10px] uppercase font-bold px-2 py-0.5 rounded">Endpoint</span>
</div>
</div>
<div className="text-right">
<div className="font-data-mono text-data-mono text-sm font-bold text-primary">₹40 L</div>
</div>
</div>
<div className="flex justify-between items-center mt-stack-md pt-stack-sm border-t border-outline-variant pl-2">
<div className="flex items-center gap-2">
<span className="material-symbols-outlined text-primary text-sm" style={{fontVariationSettings: "'FILL' 1"}}>check_circle</span>
<span className="font-label-caps text-label-caps text-primary">Included</span>
</div>
<div className="text-right">
<span className="font-data-mono text-data-mono text-sm text-error font-bold">22% ROSI</span>
</div>
</div>
</div>
{/*  Project Item 3 (Included)  */}
<div className="border border-outline-variant rounded-lg p-stack-md bg-surface transition-colors hover:border-primary cursor-pointer relative overflow-hidden group">
<div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
<div className="flex justify-between items-start mb-stack-sm pl-2">
<div>
<h4 className="font-title-lg text-title-lg text-primary text-base">Project C: EAL-3 Certification</h4>
<div className="flex gap-2 mt-1">
<span className="bg-surface-container-high text-on-surface-variant text-[10px] uppercase font-bold px-2 py-0.5 rounded">Compliance</span>
</div>
</div>
<div className="text-right">
<div className="font-data-mono text-data-mono text-sm font-bold text-primary">₹35 L</div>
</div>
</div>
<div className="flex justify-between items-center mt-stack-md pt-stack-sm border-t border-outline-variant pl-2">
<div className="flex items-center gap-2">
<span className="material-symbols-outlined text-primary text-sm" style={{fontVariationSettings: "'FILL' 1"}}>check_circle</span>
<span className="font-label-caps text-label-caps text-primary">Included</span>
</div>
<div className="text-right">
<span className="font-data-mono text-data-mono text-sm text-error font-bold">18% ROSI</span>
</div>
</div>
</div>
{/*  Divider line for budget cutoff  */}
<div className="relative py-2">
<div aria-hidden="true" className="absolute inset-0 flex items-center">
<div className="w-full border-t border-error border-dashed"></div>
</div>
<div className="relative flex justify-center">
<span className="bg-surface-container-lowest px-2 font-label-caps text-label-caps text-error">Budget Limit Exceeded</span>
</div>
</div>
{/*  Project Item 4 (Excluded)  */}
<div className="border border-outline-variant rounded-lg p-stack-md bg-surface-container-low opacity-70 transition-opacity hover:opacity-100 cursor-not-allowed">
<div className="flex justify-between items-start mb-stack-sm">
<div>
<h4 className="font-title-lg text-title-lg text-on-surface-variant text-base line-through decoration-outline-variant">Project D: WAF Upgrade</h4>
</div>
<div className="text-right">
<div className="font-data-mono text-data-mono text-sm text-on-surface-variant">₹20 L</div>
</div>
</div>
<div className="flex justify-between items-center mt-stack-md pt-stack-sm border-t border-outline-variant">
<div className="flex items-center gap-2 text-on-surface-variant">
<span className="material-symbols-outlined text-sm">cancel</span>
<span className="font-label-caps text-label-caps">Excluded</span>
</div>
<div className="text-right">
<span className="font-data-mono text-data-mono text-sm text-on-surface-variant">8% ROSI</span>
</div>
</div>
</div>
</div>
</div>
</div>
{/*  Footer (from JSON)  */}


</>
  );
}

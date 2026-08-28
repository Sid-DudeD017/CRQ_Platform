"use client";

import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ExecutiveDashboard() {
    const [budget, setBudget] = useState(65);
    const [simResults, setSimResults] = useState<any>(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [toastMessage, setToastMessage] = useState('');
    const [txHash, setTxHash] = useState('');
    const [isAccepting, setIsAccepting] = useState(false);

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBudget(Number(e.target.value));
    };

    const runSimulation = async () => {
        try {
            // budget here is 0-100, let's map it to a budget. Max budget could be 15 Cr = 15,000,000
            const budgetValue = (budget / 100) * 15000000; 
            const res = await fetch('http://localhost:8000/api/simulate-risk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budget: budgetValue })
            });
            const data = await res.json();
            
            if (!res.ok) {
                alert(`Simulation failed: ${data.detail || "Unknown error"}`);
                return;
            }
            
            setSimResults(data);
            console.log("Sim Results:", data);
        } catch (e) {
            console.error(e);
            alert("Error running simulation. Ensure FastAPI is running on port 8000.");
        }
    };

    
    const sendMessage = async () => {
        if (!chatInput.trim()) return;
        
        const newMessages = [...chatMessages, { role: 'user', content: chatInput }];
        setChatMessages(newMessages);
        setChatInput('');
        
        try {
            const res = await fetch('http://localhost:8000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: chatInput, context: simResults })
            });
            
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let assistantResponse = '';
            
            // Add a placeholder for assistant response
            setChatMessages([...newMessages, { role: 'assistant', content: '' }]);
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    assistantResponse += decoder.decode(value);
                    setChatMessages([...newMessages, { role: 'assistant', content: assistantResponse }]);
                }
            }
        } catch (e) {
            console.error(e);
            setChatMessages([...newMessages, { role: 'assistant', content: "Error communicating with Virtual CISO." }]);
        }
    };

    const acceptRisk = async (unitName: string, riskAmount: number) => {
        setIsAccepting(true);
        setToastMessage(`Authenticating and hashing risk decision for ${unitName}...`);
        setTxHash('');
        
        try {
            // 1. Authenticate to get Bearer token (as per README TODO)
            const authRes = await fetch('http://localhost:8000/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    username: 'ciso',
                    password: 'demo-ciso-pass'
                })
            });
            
            if (!authRes.ok) {
                setToastMessage("Authentication failed. Cannot accept risk.");
                setIsAccepting(false);
                setTimeout(() => setToastMessage(''), 5000);
                return;
            }
            const authData = await authRes.json();
            const token = authData.access_token;

            // 2. Log the audit with the token
            const res = await fetch('http://localhost:8000/api/audit', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    action: `Accept Risk: ${unitName}`, 
                    risk_accepted: riskAmount, 
                    user_id: "CISO-1234",
                    board_approved: true 
                })
            });
            const data = await res.json();
            
            if (data.tx_hash) {
                setToastMessage("Risk Decision Hashed and Logged to Blockchain.");
                setTxHash(data.tx_hash);
            } else {
                setToastMessage("Warning: Logged locally, but Blockchain transaction failed/mocked.");
                setTxHash(data.tx_hash || "0xmock");
            }
            
            setTimeout(() => {
                setToastMessage('');
                setTxHash('');
            }, 10000); // hide after 10s
        } catch (e) {
            console.error(e);
            setToastMessage("Error communicating with Audit server.");
            setTimeout(() => setToastMessage(''), 5000);
        }
        setIsAccepting(false);
    };

    const approveOptimizer = async () => {
        if (!simResults?.optimization) return;
        setIsAccepting(true);
        setToastMessage("Logging Optimizer Approval to Blockchain...");
        
        try {
            const authRes = await fetch('http://localhost:8000/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ username: 'ciso', password: 'demo-ciso-pass' })
            });
            
            if (!authRes.ok) {
                setToastMessage("Authentication failed. Cannot approve.");
                setIsAccepting(false);
                setTimeout(() => setToastMessage(''), 5000);
                return;
            }
            const authData = await authRes.json();
            const token = authData.access_token;

            const res = await fetch('http://localhost:8000/api/audit', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    action: `Approve AI Optimization Plan`, 
                    risk_accepted: simResults.optimization.total_cost, 
                    user_id: "CISO-1234",
                    board_approved: true 
                })
            });
            const data = await res.json();
            setToastMessage("Optimization Plan Approved & Logged!");
            setTimeout(() => setToastMessage(''), 5000);
        } catch (e) {
            console.error(e);
            setToastMessage("Error communicating with Audit server.");
            setTimeout(() => setToastMessage(''), 5000);
        }
        setIsAccepting(false);
    };

    return (
        <>
            <main className="flex-1 p-container-padding bg-background overflow-y-auto">
<div className="mb-stack-lg flex justify-between items-end">
<div>
<h1 className="font-headline-md text-headline-md text-primary mb-1">Portfolio Risk Overview</h1>
<p className="font-body-md text-body-md text-on-surface-variant">Real-time quantification of cyber exposure vs. security investment.</p>
</div>
<div className="flex items-center gap-stack-sm">
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
  <span className="material-symbols-outlined text-[14px] text-[#15803d]">check_circle</span> SIEM & CSPM Sync
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant flex items-center gap-1">
  <span className="material-symbols-outlined text-[14px] text-primary">policy</span> NIST CSF | RBI | SEBI
</span>
<span className="font-label-caps text-label-caps text-on-surface-variant px-2 py-1 bg-surface-container rounded border border-outline-variant">FY 2024</span>
<button className="border border-outline-variant text-on-surface bg-surface hover:bg-surface-container-low px-4 py-2 rounded font-body-sm text-body-sm flex items-center gap-2 transition-colors">
<span className="material-symbols-outlined text-[18px]">download</span> Export Report
                     </button>
</div>
</div>
{/*  Bento Grid Layout  */}
<div className="grid grid-cols-12 gap-gutter mb-stack-lg">
{/*  Centerpiece: ALE  */}
<div className="col-span-12 lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col justify-between hover:border-primary transition-colors">
<div>
<div className="flex justify-between items-start mb-stack-sm">
<h3 className="font-title-lg text-title-lg text-primary">Annualized Loss Expectancy</h3>
<button className="text-on-surface-variant hover:text-primary"><span className="material-symbols-outlined text-[20px]">info</span></button>
</div>
<p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Projected financial impact based on current control posture.</p>
</div>
<div>
<div className="flex items-baseline gap-2">
<span className="font-display-lg text-display-lg text-primary tracking-tighter">
  ₹{simResults && simResults.monte_carlo ? (simResults.monte_carlo.mean_expected_loss / 10000000).toFixed(2) : "4.28"}
</span>
<span className="font-headline-sm text-headline-sm text-on-surface-variant">Cr</span>
</div>
<div className="flex items-center gap-1 mt-2 text-error">
<span className="material-symbols-outlined text-[16px]">trending_up</span>
<span className="font-data-mono text-data-mono">+4.2% YoY</span>
</div>
</div>
</div>
{/*  Scorecards  */}
<div className="col-span-12 lg:col-span-3 flex flex-col gap-gutter">
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md flex-1 flex flex-col justify-center hover:border-primary transition-colors">
<h4 className="font-label-caps text-label-caps text-on-surface-variant mb-1">95% Value at Risk (VaR)</h4>
<div className="font-headline-md text-headline-md text-primary font-data-mono">
  ₹{simResults && simResults.monte_carlo ? (simResults.monte_carlo.var_95 / 10000000).toFixed(2) : "12.5"} Cr
</div>
<div className="text-on-surface-variant font-body-sm text-body-sm mt-1">Tail risk exposure</div>
</div>
<div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-stack-md flex-1 flex flex-col justify-center hover:border-primary transition-colors">
<h4 className="font-label-caps text-label-caps text-on-surface-variant mb-1">Overall ROI of Spend</h4>
<div className="font-headline-md text-headline-md text-[#15803d] font-data-mono flex items-center"><span className="material-symbols-outlined mr-1">arrow_upward</span>18%</div>
<div className="text-on-surface-variant font-body-sm text-body-sm mt-1">Security efficiency</div>
</div>
</div>
{/*  Loss Distribution Chart  */}
<div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter flex flex-col hover:border-primary transition-colors">
<h3 className="font-title-lg text-title-lg text-primary mb-1">Loss Distribution</h3>
<p className="font-body-sm text-body-sm text-on-surface-variant mb-stack-md">Monte Carlo simulation (10,000 iterations)</p>
<div className="flex-1 w-full bg-surface-container-low rounded relative border border-outline-variant border-dashed overflow-hidden flex items-end justify-center pb-4">
{simResults && simResults.monte_carlo && simResults.monte_carlo.distribution_curve ? (
    <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={simResults.monte_carlo.distribution_curve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
                <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#82ca9d" stopOpacity={0}/>
                </linearGradient>
            </defs>
            <XAxis dataKey="loss" hide={true} />
            <YAxis hide={true} />
            <Tooltip 
                formatter={(value: any, name: any, props: any) => [`${(props.payload.loss / 10000000).toFixed(2)} Cr`, 'Loss']}
                labelFormatter={() => ''}
            />
            <Area type="monotone" dataKey="probability" stroke="#82ca9d" fillOpacity={1} fill="url(#colorLoss)" />
        </AreaChart>
    </ResponsiveContainer>
) : (
    <div className="w-full h-32 flex items-center justify-center text-on-surface-variant font-body-sm">
        Run simulation to view loss distribution
    </div>
)}
</div>
</div>
</div>
{/*  Bottom Row: Sandbox & Breakdown  */}
<div className="grid grid-cols-12 gap-gutter">
{/*  What-If Sandbox  */}
<div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter hover:border-primary transition-colors">
<div className="flex justify-between items-center mb-stack-lg">
<h3 className="font-title-lg text-title-lg text-primary">Simulation Sandbox</h3>
<span className="bg-secondary-container text-on-secondary-container px-2 py-1 rounded font-label-caps text-label-caps">Draft Mode</span>
</div>
<div className="space-y-stack-lg">
{/*  Budget Slider  */}
<div>
<div className="flex justify-between mb-2">
<label className="font-body-sm text-body-sm font-semibold">Security Budget Allocation</label>
<span className="font-data-mono text-data-mono font-bold">₹{((budget/100)*15).toFixed(1)} Cr</span>
</div>
<input className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-primary" max="100" min="0" type="range"  value={budget} onChange={handleBudgetChange} />
<div className="flex justify-between mt-1 text-on-surface-variant font-label-caps text-label-caps">
<span className="">₹0</span>
<span className="">₹15 Cr+</span>
</div>
</div>
<hr className="border-outline-variant border-dashed" />
{/*  Strategic Controls  */}
<div>
<div className="flex justify-between items-center mb-stack-md">
  <h4 className="font-body-sm text-body-sm font-semibold">Recommended Controls</h4>
  {simResults?.optimization?.total_cost && (
    <div className="flex items-center gap-2">
      <span className="font-label-caps text-label-caps text-on-surface-variant">
        Optimized Cost: ₹{simResults.optimization.total_cost.toLocaleString()}
      </span>
      <button 
        onClick={approveOptimizer}
        disabled={isAccepting}
        className="px-3 py-1 bg-[#15803d] text-white rounded font-label-caps text-label-caps font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors"
      >
        {isAccepting ? "Logging..." : "Approve & Log"}
      </button>
    </div>
  )}
</div>
<div className="grid grid-cols-1 md:grid-cols-2 gap-stack-md">
  {simResults && simResults.optimization && simResults.optimization.selected_patches ? (
    simResults.optimization.selected_patches.map((patch: string, idx: number) => (
      <div key={idx} className="flex items-center justify-between p-3 border border-primary rounded bg-primary-container text-on-primary-container transition-colors">
        <div className="flex flex-col">
          <span className="font-body-sm text-body-sm font-medium">{patch}</span>
          <span className="font-label-caps text-label-caps opacity-80 mt-1">Status: Selected by Optimizer</span>
        </div>
        <span className="material-symbols-outlined text-primary">check_circle</span>
      </div>
    ))
  ) : (
    <div className="col-span-1 md:col-span-2 p-4 border border-outline-variant border-dashed rounded text-center text-on-surface-variant font-body-sm">
      Run simulation to view AI-optimized strategic controls.
    </div>
  )}
</div>
</div>
<button onClick={runSimulation} className="w-full bg-primary text-on-primary font-body-sm text-body-sm py-3 rounded font-semibold hover:bg-opacity-90 transition-opacity">
                            Run Simulation
                        </button>
</div>
</div>
{/*  Strategic Breakdown  */}
<div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded-xl p-gutter hover:border-primary transition-colors">
<h3 className="font-title-lg text-title-lg text-primary mb-stack-lg">Risk by Business Unit</h3>
<div className="space-y-4">
{/*  Unit 1  */}
<div>
<div className="flex justify-between items-end mb-1">
<span className="font-body-sm text-body-sm font-medium">Payment Processing</span>
<span className="font-data-mono text-data-mono font-bold">₹2.0 Cr/yr</span><button onClick={() => acceptRisk("Payment Processing", 20000000)} disabled={isAccepting} className="ml-2 px-2 py-0.5 border border-outline-variant text-on-surface-variant hover:border-error hover:text-error rounded text-label-caps font-label-caps transition-colors disabled:opacity-50">{isAccepting ? "Logging..." : "Accept Risk"}</button>
</div>
<div className="w-full bg-surface-container h-2 rounded overflow-hidden">
<div className="bg-error h-2 rounded" style={{width: "45%"}}></div>
</div>
</div>
{/*  Unit 2  */}
<div>
<div className="flex justify-between items-end mb-1">
<span className="font-body-sm text-body-sm font-medium">Retail Operations</span>
<span className="font-data-mono text-data-mono font-bold">₹1.2 Cr/yr</span>
</div>
<div className="w-full bg-surface-container h-2 rounded overflow-hidden">
<div className="bg-[#ca8a04] h-2 rounded" style={{width: "28%"}}></div>
</div>
</div>
{/*  Unit 3  */}
<div>
<div className="flex justify-between items-end mb-1">
<span className="font-body-sm text-body-sm font-medium">Corporate IT</span>
<span className="font-data-mono text-data-mono font-bold">₹0.68 Cr/yr</span>
</div>
<div className="w-full bg-surface-container h-2 rounded overflow-hidden">
<div className="bg-[#eab308] h-2 rounded" style={{width: "15%"}}></div>
</div>
</div>
{/*  Unit 4  */}
<div>
<div className="flex justify-between items-end mb-1">
<span className="font-body-sm text-body-sm font-medium">Supply Chain</span>
<span className="font-data-mono text-data-mono font-bold">₹0.40 Cr/yr</span>
</div>
<div className="w-full bg-surface-container h-2 rounded overflow-hidden">
<div className="bg-primary-container h-2 rounded" style={{width: "12%"}}></div>
</div>
</div>
</div>
<button className="mt-stack-lg text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1 hover:underline">
                        View Detailed Ledger <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
</button>
</div>
</div>
{toastMessage && (
    <div className="fixed top-4 right-4 bg-surface-container-highest border border-outline-variant rounded-lg p-4 shadow-xl z-50 max-w-sm animate-in fade-in slide-in-from-top-5">
        <div className="flex items-start gap-3">
            <span className={`material-symbols-outlined ${txHash && txHash !== '0xmock' ? 'text-[#15803d]' : 'text-primary'}`}>
                {txHash && txHash !== '0xmock' ? 'verified_user' : 'info'}
            </span>
            <div>
                <p className="font-body-sm text-body-sm font-medium">{toastMessage}</p>
                {txHash && txHash !== '0xmock' && (
                    <a 
                        href={`https://sepolia.etherscan.io/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 font-label-caps text-label-caps bg-primary text-on-primary px-3 py-1.5 rounded hover:bg-opacity-90 transition-colors"
                    >
                        View on Etherscan <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    </a>
                )}
            </div>
        </div>
    </div>
)}
</main>
{/* AI Chat Panel */}
{isChatOpen && (
    <div className="fixed bottom-24 right-8 w-96 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl flex flex-col overflow-hidden z-50">
        <div className="bg-primary text-on-primary p-4 flex justify-between items-center">
            <h3 className="font-title-md font-bold">Virtual CISO</h3>
            <button onClick={() => setIsChatOpen(false)} className="hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
            </button>
        </div>
        <div className="h-80 overflow-y-auto p-4 bg-surface flex flex-col gap-2">
            {chatMessages.length === 0 && (
                <div className="text-on-surface-variant text-body-sm text-center mt-4">
                    Ask me about the risk simulation or compliance frameworks...
                </div>
            )}
            {chatMessages.map((msg, idx) => (
                <div key={idx} className={`p-3 rounded-lg max-w-[85%] ${msg.role === 'user' ? 'bg-primary-container text-on-primary-container self-end' : 'bg-surface-variant text-on-surface-variant self-start'}`}>
                    <p className="text-body-sm whitespace-pre-wrap">{msg.content || '...'}</p>
                </div>
            ))}
        </div>
        <div className="p-3 border-t border-outline-variant bg-surface-container-low flex gap-2">
            <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type your message..." 
                className="flex-1 bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary"
            />
            <button onClick={sendMessage} className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90">
                <span className="material-symbols-outlined">send</span>
            </button>
        </div>
    </div>
)}

<button 
    onClick={() => setIsChatOpen(!isChatOpen)}
    className="fixed bottom-stack-lg right-stack-lg w-[60px] h-[60px] rounded-[16px] bg-primary-container text-on-primary flex items-center justify-center shadow-lg z-50 hover:bg-opacity-90 transition-all active:scale-95" 
    aria-label="AI Assistant"
>
    <span className="material-symbols-outlined text-[28px] fill-icon">
        {isChatOpen ? 'close' : 'auto_awesome'}
    </span>
</button>
        </>
    );
}

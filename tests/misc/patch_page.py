import re

with open("frontend/src/app/page.tsx", "r") as f:
    content = f.read()

# 1. Add state variables for the toast
state_vars = """
    const [chatInput, setChatInput] = useState('');
    const [toastMessage, setToastMessage] = useState('');
    const [txHash, setTxHash] = useState('');
    const [isAccepting, setIsAccepting] = useState(false);
"""
content = content.replace("const [chatInput, setChatInput] = useState('');", state_vars.strip())

# 2. Add acceptRisk function right before return (
accept_func = """
    const acceptRisk = async (unitName: string, riskAmount: number) => {
        setIsAccepting(true);
        setToastMessage(`Hashing risk decision for ${unitName}...`);
        setTxHash('');
        
        try {
            const res = await fetch('http://localhost:8000/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    return (
"""
content = content.replace("return (", accept_func.strip())

# 3. Add Toast UI before </main>
toast_ui = """
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
"""
content = content.replace("</main>", toast_ui.strip())

# 4. Wire the button for Payment Processing
old_btn = '<button className="ml-2 px-2 py-0.5 border border-outline-variant text-on-surface-variant hover:border-error hover:text-error rounded text-label-caps font-label-caps transition-colors">Accept Risk</button>'
new_btn = '<button onClick={() => acceptRisk("Payment Processing", 20000000)} disabled={isAccepting} className="ml-2 px-2 py-0.5 border border-outline-variant text-on-surface-variant hover:border-error hover:text-error rounded text-label-caps font-label-caps transition-colors disabled:opacity-50">{isAccepting ? "Logging..." : "Accept Risk"}</button>'
content = content.replace(old_btn, new_btn)

with open("frontend/src/app/page.tsx", "w") as f:
    f.write(content)

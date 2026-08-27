import re
import os

html_file = "/Users/siddharthbhakta/CRQ_Prototype/frontend/stitch_cybervalue_risk_quantifier/executive_dashboard_crq_platform/code.html"

with open(html_file, "r") as f:
    html = f.read()

# Extract body content
body_match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL)
if body_match:
    content = body_match.group(1)
else:
    content = html

# Replace class with className
content = content.replace('class="', 'className="')

# Close self-closing tags
content = re.sub(r'(<input[^>]*)(?<!/)>', r'\1 />', content)
content = re.sub(r'(<img[^>]*)(?<!/)>', r'\1 />', content)
content = re.sub(r'(<hr[^>]*)(?<!/)>', r'\1 />', content)

# Remove HTML comments
content = re.sub(r'<!--(.*?)-->', r'{/* \1 */}', content, flags=re.DOTALL)

# Fix checked=""
content = content.replace('checked=""', 'defaultChecked={true}')

# Fix style tags
content = re.sub(r'style="width: (\d+%)"', r'style={{width: "\1"}}', content)
content = content.replace('style=""', '')

jsx = f"""\"use client\";

import React, {{ useState }} from 'react';

export default function ExecutiveDashboard() {{
    const [budget, setBudget] = useState(65);
    const [simResults, setSimResults] = useState(null);

    const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {{
        setBudget(Number(e.target.value));
    }};

    const runSimulation = async () => {{
        try {{
            // budget here is 0-100, let's map it to a budget. Max budget could be 15 Cr = 15,000,000
            const budgetValue = (budget / 100) * 15000000; 
            const res = await fetch('http://localhost:8000/api/simulate-risk', {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify({{ budget: budgetValue }})
            }});
            const data = await res.json();
            setSimResults(data);
            alert("Simulation complete! Results:\\n" + JSON.stringify(data.optimization, null, 2));
            console.log("Sim Results:", data);
        }} catch (e) {{
            console.error(e);
            alert("Error running simulation. Ensure FastAPI is running on port 8000.");
        }}
    }};

    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col">
            {content}
        </div>
    );
}}
"""

# Wire up the budget slider
jsx = re.sub(r'(<input[^>]*type="range"[^>]*)value="65"', r'\1 value={budget} onChange={handleBudgetChange}', jsx)
jsx = re.sub(r'(<span className="font-data-mono text-data-mono font-bold">)₹8\.5 Cr(</span>)', r'\1₹{((budget/100)*15).toFixed(1)} Cr\2', jsx)

# Wire up the run simulation button
# Find the button that says "Run Simulation"
jsx = jsx.replace('hover:bg-opacity-90 transition-opacity">\\n                            Run Simulation', 'hover:bg-opacity-90 transition-opacity" onClick={runSimulation}>\\n                            Run Simulation')

with open("/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/page.tsx", "w") as f:
    f.write(jsx)

print("Conversion complete!")

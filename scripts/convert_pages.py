import os
import re

def convert_html_to_jsx(html_path, out_path, component_name):
    if not os.path.exists(html_path):
        print(f"File not found: {html_path}")
        return

    with open(html_path, "r") as f:
        html = f.read()

    # Extract body content
    body_match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL)
    if body_match:
        content = body_match.group(1)
    else:
        content = html

    # Common replacements
    content = content.replace('class="', 'className="')
    content = content.replace('checked=""', 'defaultChecked={true}')
    content = re.sub(r'style="width:\s*(\d+%)"', r'style={{width: "\1"}}', content)
    content = content.replace('style=""', '')

    # Close self-closing tags
    content = re.sub(r'(<input[^>]*)(?<!/)>', r'\1 />', content)
    content = re.sub(r'(<img[^>]*)(?<!/)>', r'\1 />', content)
    content = re.sub(r'(<hr[^>]*)(?<!/)>', r'\1 />', content)
    content = re.sub(r'(<br[^>]*)(?<!/)>', r'\1 />', content)

    # Remove HTML comments
    content = re.sub(r'<!--(.*?)-->', r'{/* \1 */}', content, flags=re.DOTALL)

    # Wrap in JSX
    jsx = f"""import React from 'react';

export default function {component_name}() {{
    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col">
            {content}
        </div>
    );
}}
"""
    # Create directory if not exists
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    
    with open(out_path, "w") as f:
        f.write(jsx)
    print(f"Created {out_path}")

base_stitch = "/Users/siddharthbhakta/CRQ_Prototype/frontend/stitch_cybervalue_risk_quantifier"
base_app = "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app"

# Mapping: Folder Name -> (Route, Component Name)
pages = {
    "executive_cyber_risk_intelligence": ("analyze", "AnalyzePage"),
    "investment_optimizer_crq_platform": ("optimize", "OptimizePage"),
    "ingestion_training_crq_platform": ("ingestion", "IngestionPage")
}

for folder, (route, comp) in pages.items():
    html_path = os.path.join(base_stitch, folder, "code.html")
    out_path = os.path.join(base_app, route, "page.tsx")
    convert_html_to_jsx(html_path, out_path, comp)

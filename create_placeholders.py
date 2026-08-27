import os
import re

routes = ["reports", "support", "docs"]
base_app = "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app"

# 1. Create Placeholder Pages
for route in routes:
    dir_path = os.path.join(base_app, route)
    os.makedirs(dir_path, exist_ok=True)
    
    page_content = f"""export default function {route.capitalize()}Page() {{
    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex items-center justify-center">
            <div className="text-center">
                <span className="material-symbols-outlined text-[64px] text-outline mb-4">construction</span>
                <h1 className="font-headline-md text-primary">{route.capitalize()} Page</h1>
                <p className="font-body-md text-on-surface-variant mt-2">This module is currently under construction.</p>
                <a href="/" className="mt-6 inline-block bg-primary text-on-primary px-4 py-2 rounded hover:opacity-90 transition-opacity">Back to Dashboard</a>
            </div>
        </div>
    );
}}
"""
    with open(os.path.join(dir_path, "page.tsx"), "w") as f:
        f.write(page_content)

# 2. Update all the existing pages to link to these new routes
files_to_update = [
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/page.tsx",
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/optimize/page.tsx",
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/ingestion/page.tsx"
]

for file_path in files_to_update:
    if not os.path.exists(file_path):
        continue
        
    with open(file_path, "r") as f:
        content = f.read()

    # Function to replace href based on the text content of the <a> tag
    def replace_href(match):
        a_tag_start = match.group(1)
        inner_html = match.group(2)
        
        # Determine route based on inner text
        route = None
        lower_html = inner_html.lower()
        
        if "reports" in lower_html:
            route = "/reports"
        elif "support" in lower_html:
            route = "/support"
        elif "documentation" in lower_html or "docs" in lower_html:
            route = "/docs"
            
        if route:
            new_start = re.sub(r'href="[^"]*"', f'href="{route}"', a_tag_start)
            return f"{new_start}{inner_html}</a>"
        else:
            return match.group(0)

    # Regex to match entire <a> tags
    content = re.sub(r'(<a[^>]+href="[^"]*"[^>]*>)(.*?)</a>', replace_href, content, flags=re.DOTALL)
    
    with open(file_path, "w") as f:
        f.write(content)

print("Created placeholder pages and wired links!")

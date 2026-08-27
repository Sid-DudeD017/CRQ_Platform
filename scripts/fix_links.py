import os
import re

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
        route = "#"
        lower_html = inner_html.lower()
        
        if "dashboard" in lower_html or "overview" in lower_html:
            route = "/"
        elif "analyze" in lower_html or "intelligence" in lower_html:
            route = "/analyze"
        elif "optimize" in lower_html or "investment" in lower_html:
            route = "/optimize"
        elif "ingest" in lower_html or "training" in lower_html:
            route = "/ingestion"
            
        # Replace the href attribute in the opening tag
        # The regex match.group(1) looks like <a className="..." href="/" or href="#"
        # Let's just do a string replace on a_tag_start
        new_start = re.sub(r'href="[^"]*"', f'href="{route}"', a_tag_start)
        
        return f"{new_start}>{inner_html}</a>"

    # Regex to match entire <a> tags
    # <a ...> ... </a>
    content = re.sub(r'(<a[^>]+href="[^"]*"[^>]*>)(.*?)</a>', replace_href, content, flags=re.DOTALL)
    
    with open(file_path, "w") as f:
        f.write(content)

print("Links robustly updated!")

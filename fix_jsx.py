import os
import re

files_to_update = [
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/page.tsx",
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/optimize/page.tsx",
    "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app/ingestion/page.tsx"
]

def fix_jsx(file_path):
    if not os.path.exists(file_path):
        return
        
    with open(file_path, "r") as f:
        content = f.read()

    # 1. Fix the "Unexpected token" issue caused by <!DOCTYPE html> if the body regex failed
    if "<!DOCTYPE html>" in content:
        # We need to extract just the body contents again more robustly
        body_match = re.search(r'<body[^>]*>(.*?)</body>', content, re.DOTALL | re.IGNORECASE)
        if body_match:
            inner_body = body_match.group(1)
            # Replace the entire block from <!DOCTYPE to </html> with just the inner_body
            content = re.sub(r'<!DOCTYPE html>.*?<body[^>]*>', '', content, flags=re.DOTALL | re.IGNORECASE)
            content = re.sub(r'</body>.*?</html>', '', content, flags=re.DOTALL | re.IGNORECASE)
            # Ensure it didn't leave weird tags
            content = content.replace("</head>", "").replace("<html>", "").replace("</html>", "")

    # 2. Fix the `style="..."` issue
    # We need to convert style="key: value; key2: value2" to style={{key: 'value', key2: 'value2'}}
    # We'll use a regex to find all style="..." strings and convert them
    def style_replacer(match):
        style_string = match.group(1)
        if not style_string.strip():
            return "" # Remove empty style tags
        
        # Split by ;
        rules = [r.strip() for r in style_string.split(';') if r.strip()]
        jsx_styles = []
        for rule in rules:
            if ':' in rule:
                k, v = rule.split(':', 1)
                k = k.strip()
                v = v.strip()
                # Convert kebab-case to camelCase
                kParts = k.split('-')
                kCamel = kParts[0] + ''.join(x.title() for x in kParts[1:])
                # Wrap value in quotes if it's not a number
                if v.endswith('%') or not v.replace('.','',1).isdigit():
                    v_str = f'"{v}"'
                else:
                    v_str = v
                jsx_styles.append(f"{kCamel}: {v_str}")
        
        if jsx_styles:
            return "style={{" + ", ".join(jsx_styles) + "}}"
        return ""

    content = re.sub(r'style="([^"]*)"', style_replacer, content)
    
    # 3. Add "use client"; to all files just in case they need hooks later
    if '"use client";' not in content:
        content = '"use client";\\n' + content

    with open(file_path, "w") as f:
        f.write(content)

for f in files_to_update:
    fix_jsx(f)

print("Fixed JSX Syntax and Style props!")

import os
import re

base_app = "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app"

files_to_clean = [
    "page.tsx",
    "optimize/page.tsx",
    "ingestion/page.tsx"
]

def clean_file(filepath):
    full_path = os.path.join(base_app, filepath)
    if not os.path.exists(full_path): return
    with open(full_path, "r") as f:
        content = f.read()
    
    # Extract just the <main>...</main> content
    main_match = re.search(r'(<main[^>]*>.*?</main>)', content, re.DOTALL | re.IGNORECASE)
    if not main_match:
        print(f"Could not find <main> in {filepath}")
        return
        
    main_content = main_match.group(1)
    
    # Strip footer and AI assistant button from inside the main content if they exist
    main_content = re.sub(r'<footer.*?</footer>', '', main_content, flags=re.DOTALL | re.IGNORECASE)
    main_content = re.sub(r'<button[^>]*aria-label="AI Assistant".*?</button>', '', main_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Replace the ENTIRE return statement and everything after it
    # Find the start of the return statement
    return_index = content.find("return (")
    if return_index == -1:
        return_index = content.find("return(")
        
    if return_index != -1:
        # Keep everything BEFORE the return statement (state hooks, functions, etc.)
        top_half = content[:return_index]
        new_return = f"return (\n        <>\n            {main_content}\n        </>\n    );\n}}\n"
        
        with open(full_path, "w") as f:
            f.write(top_half + new_return)
        print(f"Successfully cleaned {filepath}")
    else:
        print(f"Could not find return statement in {filepath}")

for f in files_to_clean:
    clean_file(f)


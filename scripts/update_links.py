import os

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
        
    # Replace navigation links
    content = content.replace('href="#">Dashboard</a>', 'href="/">Dashboard</a>')
    content = content.replace('href="#">Optimize</a>', 'href="/optimize">Optimize</a>')
    content = content.replace('href="#">Ingest &amp; Train</a>', 'href="/ingestion">Ingest &amp; Train</a>')
    
    with open(file_path, "w") as f:
        f.write(content)

print("Links updated successfully!")

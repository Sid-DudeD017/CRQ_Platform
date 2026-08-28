import os
import shutil
import re

base_app = "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/app"
components_dir = "/Users/siddharthbhakta/CRQ_Prototype/frontend/src/components"

# 1. Delete .next cache to fix CSS bug
next_cache = "/Users/siddharthbhakta/CRQ_Prototype/frontend/.next"
if os.path.exists(next_cache):
    shutil.rmtree(next_cache)
    print("Deleted .next cache to fix CSS rendering.")

# 2. Update SharedLayout.tsx to include the functional Chatbot
shared_layout_path = os.path.join(components_dir, "SharedLayout.tsx")
with open(shared_layout_path, "r") as f:
    shared_content = f.read()

# We need to add state imports and the chatbot UI to SharedLayout
new_shared_content = shared_content.replace(
    "import { usePathname } from 'next/navigation';",
    "import { usePathname } from 'next/navigation';\nimport { useState } from 'react';"
)

# Add state to the component
new_shared_content = new_shared_content.replace(
    "const pathname = usePathname();",
    """const pathname = usePathname();
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);
    const [chatInput, setChatInput] = useState('');

    const sendMessage = async () => {
        if (!chatInput.trim()) return;
        
        const newMessages = [...chatMessages, { role: 'user', content: chatInput }];
        setChatMessages(newMessages);
        setChatInput('');
        
        try {
            const res = await fetch('http://localhost:8000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: chatInput, context: null })
            });
            
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let assistantResponse = '';
            
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
    };"""
)

# Replace the dummy button with the full interactive chatbot
chatbot_ui = """
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
                                    className="flex-1 bg-surface border border-outline-variant rounded px-3 py-2 text-body-sm focus:outline-none focus:border-primary text-on-surface"
                                />
                                <button onClick={sendMessage} className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90">
                                    <span className="material-symbols-outlined">send</span>
                                </button>
                            </div>
                        </div>
                    )}
                    
                    <button 
                        onClick={() => setIsChatOpen(!isChatOpen)}
                        className="fixed bottom-stack-lg right-stack-lg w-[60px] h-[60px] rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-lg z-50 hover:bg-opacity-90 transition-all active:scale-95" 
                        aria-label="AI Assistant"
                    >
                        <span className="material-symbols-outlined text-[28px]">
                            {isChatOpen ? 'close' : 'auto_awesome'}
                        </span>
                    </button>
"""

# Replace the dummy button in SharedLayout
new_shared_content = re.sub(
    r'\{\/\* Chatbot Button \*\/}.*?</button>', 
    chatbot_ui, 
    new_shared_content, 
    flags=re.DOTALL
)

with open(shared_layout_path, "w") as f:
    f.write(new_shared_content)
print("Updated SharedLayout.tsx with global Chatbot.")

# 3. Remove Chatbot from page.tsx
page_path = os.path.join(base_app, "page.tsx")
with open(page_path, "r") as f:
    page_content = f.read()

# Remove state hooks
page_content = re.sub(r'const \[isChatOpen.*?;\n', '', page_content)
page_content = re.sub(r'const \[chatMessages.*?;\n', '', page_content)
page_content = re.sub(r'const \[chatInput.*?;\n', '', page_content)

# Remove sendMessage function
page_content = re.sub(r'const sendMessage = async \(\) => \{.*?\n    \};\n', '', page_content, flags=re.DOTALL)

# Remove Chatbot UI from return block
page_content = re.sub(r'\{\/\* AI Chat Panel \*\/}.*?<\/button>', '', page_content, flags=re.DOTALL)

with open(page_path, "w") as f:
    f.write(page_content)
print("Removed duplicate Chatbot from page.tsx.")

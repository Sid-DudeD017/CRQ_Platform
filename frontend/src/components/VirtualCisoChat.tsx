"use client";

import React, { useState } from 'react';
import { API_BASE } from '@/lib/api';

export default function VirtualCisoChat() {
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatSending, setIsChatSending] = useState(false);

    const sendMessage = async () => {
        if (!chatInput.trim()) return;

        const newMessages = [...chatMessages, { role: 'user', content: chatInput }];
        setChatMessages(newMessages);
        setChatInput('');
        setIsChatSending(true);

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
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
        } finally {
            setIsChatSending(false);
        }
    };

    return (
        <>
            {isChatOpen && (
                <div className="fixed bottom-24 right-8 w-96 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl flex flex-col overflow-hidden z-50 animate-fade-scale-in">
                    <div className="bg-primary text-on-primary p-3.5 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                            <h3 className="font-title-md font-bold text-sm">Virtual CISO Agent</h3>
                        </div>
                        <button onClick={() => setIsChatOpen(false)} className="hover:opacity-80">
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>

                    <div className="h-80 overflow-y-auto p-4 bg-surface flex flex-col gap-2 custom-scrollbar">
                        {chatMessages.length === 0 && (
                            <div className="text-on-surface-variant text-xs text-center mt-6">
                                Ask the Virtual CISO about RBI/SEBI/DPDP compliance regulations, telemetry status, or budget optimization...
                            </div>
                        )}
                        {chatMessages.map((msg, idx) => {
                            const sourceMatch = msg.content.match(/\n*Sources?:\s*([A-Za-z0-9,\/ ]+)\s*$/i);
                            const mainText = sourceMatch ? msg.content.slice(0, sourceMatch.index) : msg.content;
                            const sourceTags = sourceMatch
                                ? sourceMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
                                : [];

                            return (
                                <div
                                    key={idx}
                                    className={`p-3 rounded-lg max-w-[85%] text-xs ${msg.role === 'user' ? 'bg-primary-container text-on-primary-container self-end' : 'bg-surface-variant text-on-surface-variant self-start'}`}
                                >
                                    <p className="whitespace-pre-wrap">{mainText}</p>
                                    {sourceTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-outline-variant/40">
                                            {sourceTags.map((tag, i) => (
                                                <span key={i} className="px-1.5 py-0.2 bg-primary-container text-on-primary-container rounded text-[10px] font-label-caps">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-2.5 border-t border-outline-variant bg-surface-container-low flex gap-1.5">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                            placeholder="Ask Virtual CISO..."
                            className="flex-1 bg-surface border border-outline-variant rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={isChatSending}
                            className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90 disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[16px]">
                                {isChatSending ? 'hourglass_top' : 'send'}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-xl z-50 hover:scale-105 active:scale-95 transition-all"
                aria-label="Virtual CISO Assistant"
            >
                <span className="material-symbols-outlined text-[24px]">
                    {isChatOpen ? 'close' : 'auto_awesome'}
                </span>
            </button>
        </>
    );
}

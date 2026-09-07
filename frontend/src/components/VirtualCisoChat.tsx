"use client";

import React, { useState } from 'react';
import { API_BASE } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useServiceStatus } from '@/lib/useServiceStatus';

export default function VirtualCisoChat() {
    const { token, username } = useAuth();
    // [No degraded-mode / service-health feedback - fix] Previously a
    // missing GROQ_API_KEY/OPENAI_API_KEY silently dropped every
    // conversation into keyword-only routing (see ai-agent/graph.py's
    // `llm` fallback) with no visible signal anywhere - a visitor had no
    // way to tell "the AI is offline" from "the AI just doesn't know
    // this". See backend/main.py::get_status.
    const { data: serviceStatus } = useServiceStatus();
    const aiInFallbackMode = serviceStatus?.ai_agent === 'fallback';
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatSending, setIsChatSending] = useState(false);
    // [Success metrics #15 - AI answer usefulness] Which message indices
    // have already been rated, and what they were rated - keyed by index
    // rather than a message id since chat messages have none (they're
    // never persisted server-side - see docs/PRIVACY.md). Prevents
    // double-submitting a rating and lets the UI show which way a
    // message was already rated.
    const [messageRatings, setMessageRatings] = useState<Record<number, 'up' | 'down'>>({});

    const rateMessage = async (idx: number, rating: 'up' | 'down') => {
        if (messageRatings[idx] || !token) return;
        const answer = chatMessages[idx]?.content || '';
        const question = chatMessages[idx - 1]?.role === 'user' ? chatMessages[idx - 1].content : '';
        setMessageRatings((prev) => ({ ...prev, [idx]: rating }));
        try {
            await fetch(`${API_BASE}/api/chat/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ question: question.slice(0, 2000), answer: answer.slice(0, 4000), rating }),
            });
        } catch (e) {
            // Best-effort - a failed rating submission isn't worth
            // interrupting the chat over, and the button already shows
            // the visitor's choice regardless.
        }
    };

    const sendMessage = async () => {
        if (!chatInput.trim()) return;

        if (!token) {
            setChatMessages([...chatMessages, { role: 'user', content: chatInput }, { role: 'assistant', content: 'Please log in to chat with the Virtual CISO.' }]);
            setChatInput('');
            return;
        }

        const newMessages = [...chatMessages, { role: 'user', content: chatInput }];
        setChatMessages(newMessages);
        setChatInput('');
        setIsChatSending(true);

        // Same crq_data_source:<username> key every other page (Overview,
        // Ingestion, Ledger, Optimize, Reports, CommandPalette) already reads
        // to know whether the user is on the demo fleet or their own ingested
        // data - previously the chat request never sent this at all, so the
        // Virtual CISO's tools always queried the demo fleet regardless of
        // which dashboard the question came from. Defaults to 'predefined'
        // to match backend/main.py's ChatRequest.data_source default.
        let dataSource: 'predefined' | 'own' = 'predefined';
        try {
            if (username) {
                const stored = localStorage.getItem(`crq_data_source:${username}`);
                if (stored === 'own' || stored === 'predefined') dataSource = stored;
            }
        } catch (e) {}

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: chatInput, context: null, data_source: dataSource })
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
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">smart_toy</span>
                            <h3 className="font-title-md font-bold text-sm">Virtual CISO Agent</h3>
                        </div>
                        <button onClick={() => setIsChatOpen(false)} aria-label="Close chat" className="hover:opacity-80">
                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>

                    {aiInFallbackMode && (
                        <div className="px-3.5 py-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-1.5 border-b border-outline-variant">
                            <span aria-hidden="true" className="material-symbols-outlined text-[14px] mt-0.5">info</span>
                            <span>Running without an AI key configured - answers use basic keyword routing, not a real LLM, until GROQ_API_KEY or OPENAI_API_KEY is set.</span>
                        </div>
                    )}

                    <div className="h-80 overflow-y-auto p-4 bg-surface flex flex-col gap-2 custom-scrollbar">
                        {chatMessages.length === 0 && (
                            <div className="text-on-surface-variant text-xs text-center mt-6">
                                Ask the Virtual CISO about RBI/SEBI/DPDP compliance regulations, telemetry status, or budget optimization...
                            </div>
                        )}
                        {chatMessages.map((msg, idx) => {
                            // [AI safety fix] graph.py prefixes every non-LLM
                            // canned/fallback answer with a literal '[Offline
                            // Mode]' marker (see ai-agent/graph.py) - detected
                            // and stripped here so it renders as a real badge
                            // instead of leaking as literal text in the bubble,
                            // making clear on a PER-ANSWER basis (not just the
                            // one-time banner above) that this specific reply
                            // isn't a real model response.
                            const isOfflineFallback = msg.role === 'assistant' && msg.content.includes('[Offline Mode]');
                            const withoutOfflineMarker = msg.content.split('[Offline Mode]').join('').trim();
                            const sourceMatch = withoutOfflineMarker.match(/\n*Sources?:\s*([A-Za-z0-9,\/ ]+)\s*$/i);
                            const mainText = sourceMatch ? withoutOfflineMarker.slice(0, sourceMatch.index) : withoutOfflineMarker;
                            const sourceTags = sourceMatch
                                ? sourceMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
                                : [];

                            return (
                                <div
                                    key={idx}
                                    className={`p-3 rounded-lg max-w-[85%] text-xs ${msg.role === 'user' ? 'bg-primary-container text-on-primary-container self-end' : 'bg-surface-variant text-on-surface-variant self-start'}`}
                                >
                                    {isOfflineFallback && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 mb-1.5 bg-[#ca8a04]/15 text-[#ca8a04] rounded text-[10px] font-label-caps">
                                            <span aria-hidden="true" className="material-symbols-outlined text-[12px]">bolt</span>
                                            Offline mode - non-AI response
                                        </span>
                                    )}
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
                                    {/* [Success metrics #15] Skip rating controls on offline-
                                        fallback answers and the empty streaming-placeholder bubble -
                                        rating "is this a useful AI answer" only makes sense for a
                                        real, complete model response. */}
                                    {msg.role === 'assistant' && !isOfflineFallback && mainText.length > 0 && (
                                        <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-outline-variant/40">
                                            <span className="text-[10px] text-on-surface-variant mr-1">Helpful?</span>
                                            <button
                                                type="button"
                                                onClick={() => rateMessage(idx, 'up')}
                                                aria-label="Mark this answer as helpful"
                                                aria-pressed={messageRatings[idx] === 'up'}
                                                className={`p-1 rounded transition-colors ${messageRatings[idx] === 'up' ? 'text-[#16a34a]' : 'text-on-surface-variant hover:text-[#16a34a]'}`}
                                            >
                                                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">thumb_up</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => rateMessage(idx, 'down')}
                                                aria-label="Mark this answer as not helpful"
                                                aria-pressed={messageRatings[idx] === 'down'}
                                                className={`p-1 rounded transition-colors ${messageRatings[idx] === 'down' ? 'text-error' : 'text-on-surface-variant hover:text-error'}`}
                                            >
                                                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">thumb_down</span>
                                            </button>
                                            {messageRatings[idx] && (
                                                <span className="text-[10px] text-on-surface-variant">Thanks for the feedback</span>
                                            )}
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
                            aria-label={isChatSending ? 'Sending message' : 'Send message'}
                            className="bg-primary text-on-primary p-2 rounded flex items-center justify-center hover:opacity-90 disabled:opacity-50"
                        >
                            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
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
                <span aria-hidden="true" className="material-symbols-outlined text-[24px]">
                    {isChatOpen ? 'close' : 'auto_awesome'}
                </span>
            </button>
        </>
    );
}

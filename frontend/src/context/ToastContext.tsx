"use client";
import React, { createContext, useCallback, useContext, useState } from 'react';

// Lightweight toast/snackbar system replacing native alert() popups
// throughout the app (Accept Risk, Run Simulation, New Analysis, chat
// errors) - alert() blocks the whole tab and looks like a browser dialog,
// not part of the product, which was the opposite of the "polished"
// micro-interactions ask.

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
    id: number;
    message: string;
    variant: ToastVariant;
}

interface ToastContextValue {
    showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
        const id = nextId++;
        setToasts((prev) => [...prev, { id, message, variant }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4500);
    }, []);

    const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

    const variantStyles: Record<ToastVariant, string> = {
        success: 'bg-[#15803d] text-white',
        error: 'bg-error text-on-error',
        info: 'bg-primary text-on-primary',
    };

    const variantIcon: Record<ToastVariant, string> = {
        success: 'check_circle',
        error: 'error',
        info: 'info',
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        onClick={() => dismiss(t.id)}
                        className={`pointer-events-auto max-w-sm shadow-2xl rounded-lg px-4 py-3 flex items-start gap-2 cursor-pointer animate-toast-in ${variantStyles[t.variant]}`}
                    >
                        <span className="material-symbols-outlined text-[20px] mt-0.5">{variantIcon[t.variant]}</span>
                        <span className="font-body-sm text-body-sm whitespace-pre-line">{t.message}</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return ctx;
}

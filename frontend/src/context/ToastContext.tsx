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
    detail?: { dataSaved?: 'yes' | 'no' | 'unknown'; retrySafe?: boolean };
}

interface ToastContextValue {
    // [Product improvement #7 - failure/empty states] `variant` alone only
    // ever answered "what happened". The optional third argument lets a
    // call site also say why, and - the two questions people actually
    // need after something fails - whether their data was saved and
    // whether retrying is safe, without touching any of the dozens of
    // existing two-argument call sites across the app.
    showToast: (message: string, variant?: ToastVariant, detail?: { dataSaved?: 'yes' | 'no' | 'unknown'; retrySafe?: boolean }) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, variant: ToastVariant = 'info', detail?: { dataSaved?: 'yes' | 'no' | 'unknown'; retrySafe?: boolean }) => {
        const id = nextId++;
        setToasts((prev) => [...prev, { id, message, variant, detail }]);
        // Toasts carrying extra data-saved/retry-safe detail stay up longer
        // (9s vs 4.5s) - there's more to read, and it's usually the more
        // consequential (error) toast that carries it.
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, detail ? 9000 : 4500);
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
            {/* [Accessibility - fix] role="status"/aria-live so a screen-reader
                user hears these the same moment a sighted user sees them -
                previously a toast was entirely silent to assistive tech,
                the one channel this app used for "your action just
                succeeded/failed" outside a full page reload. Errors get
                aria-live="assertive" (interrupts) since they're the ones
                someone needs to act on; success/info stay "polite". */}
            <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        onClick={() => dismiss(t.id)}
                        role="status"
                        aria-live={t.variant === 'error' ? 'assertive' : 'polite'}
                        className={`pointer-events-auto max-w-sm shadow-2xl rounded-lg px-4 py-3 flex items-start gap-2 cursor-pointer animate-toast-in ${variantStyles[t.variant]}`}
                    >
                        <span aria-hidden="true" className="material-symbols-outlined text-[20px] mt-0.5">{variantIcon[t.variant]}</span>
                        <span className="font-body-sm text-body-sm whitespace-pre-line">
                            {t.message}
                            {t.detail && (
                                <span className="block opacity-90 mt-0.5">
                                    {t.detail.dataSaved === 'yes' && 'Your data up to this point was saved. '}
                                    {t.detail.dataSaved === 'no' && 'Nothing was saved. '}
                                    {t.detail.dataSaved === 'unknown' && "We couldn't confirm this was saved. "}
                                    {t.detail.retrySafe === true && 'Safe to retry.'}
                                    {t.detail.retrySafe === false && 'Avoid retrying until this is resolved.'}
                                </span>
                            )}
                        </span>
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

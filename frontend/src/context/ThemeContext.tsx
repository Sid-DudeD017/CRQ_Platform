"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';

// Toggles the `dark` class on <html>, which flips every color token
// defined as a CSS variable in globals.css (see tailwind.config.ts -
// every "colors" entry there is now var(--token) instead of a hardcoded
// hex, so this one class toggle re-themes the whole app without touching
// any page). Persists the choice in localStorage; falls back to the
// OS-level preference on first visit.

type Theme = 'light' | 'dark';

interface ThemeContextValue {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('light');

    useEffect(() => {
        let initial: Theme = 'light';
        try {
            const saved = localStorage.getItem('crq_theme');
            if (saved === 'light' || saved === 'dark') {
                initial = saved;
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                initial = 'dark';
            }
        } catch (e) {
            // localStorage unavailable - just use the light default
        }
        setTheme(initial);
        document.documentElement.classList.toggle('dark', initial === 'dark');
    }, []);

    const toggleTheme = () => {
        setTheme((prev) => {
            const next: Theme = prev === 'dark' ? 'light' : 'dark';
            document.documentElement.classList.toggle('dark', next === 'dark');
            try {
                localStorage.setItem('crq_theme', next);
            } catch (e) {
                // ignore - theme just won't persist across reloads
            }
            return next;
        });
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return ctx;
}

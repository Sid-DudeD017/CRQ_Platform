"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

type Group = 'Navigate' | 'Actions' | 'Account';
type Item = {
    id: string;
    label: string;
    sublabel?: string;
    icon: string;
    action: () => void;
    group: Group;
};

// Mirrors SharedLayout's navItems split exactly - Training moved out to
// the starting page (it's not part of either dashboard anymore), and
// Ingestion IS "Overview" for an own-data account rather than a separate
// destination, so the quick-nav palette can't be used to route around
// either dashboard's own nav.
const PREDEFINED_PAGES: { path: string; icon: string; label: string }[] = [
    { path: '/overview', icon: 'dashboard', label: 'Overview' },
    { path: '/optimize', icon: 'trending_up', label: 'Investment Optimizer' },
    { path: '/ledger', icon: 'receipt_long', label: 'Risk Ledger' },
    { path: '/calibration', icon: 'target', label: 'Calibration' },
    { path: '/reports', icon: 'assessment', label: 'Reports' },
    { path: '/support', icon: 'help_outline', label: 'Support' },
    { path: '/docs', icon: 'description', label: 'Documentation' },
];
const OWN_DATA_PAGES: { path: string; icon: string; label: string }[] = [
    { path: '/ingestion', icon: 'dashboard', label: 'Overview' },
    { path: '/optimize', icon: 'trending_up', label: 'Investment Optimizer' },
    { path: '/ledger', icon: 'receipt_long', label: 'Risk Ledger' },
    { path: '/calibration', icon: 'target', label: 'Calibration' },
    { path: '/reports', icon: 'assessment', label: 'Reports' },
    { path: '/support', icon: 'help_outline', label: 'Support' },
    { path: '/docs', icon: 'description', label: 'Documentation' },
];

// Global Cmd/Ctrl+K quick nav + actions - fires the app's real navigation
// and auth/theme handlers rather than a fake demo list, so every result
// here genuinely does what it says.
export default function CommandPalette() {
    const router = useRouter();
    const { username, loginAs, logout, loggingInRole } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [dataSource, setDataSource] = useState<'predefined' | 'own' | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!username) return;
        try {
            const stored = localStorage.getItem(`crq_data_source:${username}`);
            setDataSource(stored === 'own' ? 'own' : 'predefined');
        } catch (e) {
            setDataSource('predefined');
        }
    }, [username]);
    const PAGES = dataSource === 'own' ? OWN_DATA_PAGES : PREDEFINED_PAGES;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
            if (isCmdK) {
                e.preventDefault();
                setOpen((v) => !v);
            } else if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        const onOpenRequest = () => setOpen(true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('crq:open-command-palette', onOpenRequest);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('crq:open-command-palette', onOpenRequest);
        };
    }, []);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveIndex(0);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    const items: Item[] = useMemo(() => {
        const nav: Item[] = PAGES.map((p) => ({
            id: `nav-${p.path}`,
            label: p.label,
            sublabel: p.path,
            icon: p.icon,
            group: 'Navigate',
            action: () => router.push(p.path),
        }));

        const actions: Item[] = [
            {
                id: 'toggle-theme',
                label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
                icon: theme === 'dark' ? 'light_mode' : 'dark_mode',
                group: 'Actions',
                action: toggleTheme,
            },
        ];

        const account: Item[] = username
            ? [{ id: 'logout', label: 'Log out', icon: 'logout', group: 'Account', action: logout }]
            : [
                  { id: 'login-ciso', label: 'Log in as CISO', icon: 'shield_person', group: 'Account', action: () => loginAs('ciso') },
                  { id: 'login-cfo', label: 'Log in as CFO', icon: 'account_balance', group: 'Account', action: () => loginAs('cfo') },
              ];

        return [...nav, ...actions, ...account];
    }, [theme, toggleTheme, username, logout, loginAs, router, PAGES]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter((it) => it.label.toLowerCase().includes(q) || it.sublabel?.toLowerCase().includes(q));
    }, [items, query]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const runItem = (it: Item) => {
        it.action();
        setOpen(false);
    };

    if (!open) return null;

    const groups: Group[] = ['Navigate', 'Actions', 'Account'];

    return (
        <div
            className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4 bg-black/40 animate-fade-scale-in"
            onClick={() => setOpen(false)}
        >
            <div
                className="w-full max-w-lg bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant">
                    <span aria-hidden="true" className="material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setActiveIndex((i) => Math.max(0, i - 1));
                            } else if (e.key === 'Enter' && filtered[activeIndex]) {
                                e.preventDefault();
                                runItem(filtered[activeIndex]);
                            }
                        }}
                        placeholder="Jump to a page or run an action..."
                        className="flex-1 bg-transparent outline-none font-body-md text-body-md placeholder:text-on-surface-variant"
                    />
                    <kbd className="hidden sm:inline-block font-label-caps text-label-caps text-on-surface-variant border border-outline-variant rounded px-1.5 py-0.5">Esc</kbd>
                </div>
                <div className="max-h-[60vh] overflow-y-auto custom-scrollbar py-2">
                    {filtered.length === 0 && (
                        <div className="px-4 py-6 text-center text-on-surface-variant font-body-sm text-body-sm">No matches</div>
                    )}
                    {groups.map((g) => {
                        const groupItems = filtered.filter((it) => it.group === g);
                        if (groupItems.length === 0) return null;
                        return (
                            <div key={g} className="mb-1">
                                <div className="px-4 pt-2 pb-1 font-label-caps text-label-caps text-on-surface-variant">{g}</div>
                                {groupItems.map((it) => {
                                    const idx = filtered.indexOf(it);
                                    const isActive = idx === activeIndex;
                                    return (
                                        <button
                                            key={it.id}
                                            onMouseEnter={() => setActiveIndex(idx)}
                                            onClick={() => runItem(it)}
                                            className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface hover:bg-surface-container-high'}`}
                                        >
                                            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{it.icon}</span>
                                            <span className="font-body-sm text-body-sm flex-1">{it.label}</span>
                                            {it.id.startsWith('login-') && loggingInRole === it.id.replace('login-', '') && (
                                                <span aria-hidden="true" className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

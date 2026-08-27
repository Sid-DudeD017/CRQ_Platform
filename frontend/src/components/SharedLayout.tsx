"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SharedLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    const navItems = [
        { path: '/', icon: 'dashboard', label: 'Overview' },
        { path: '/optimize', icon: 'trending_up', label: 'Investment' },
        { path: '/ingestion', icon: 'input', label: 'Ingestion' },
        { path: '/training', icon: 'model_training', label: 'Training' },
        { path: '/reports', icon: 'assessment', label: 'Reports' },
    ];

    return (
        <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col">
            {/* TopNavBar */}
            <nav className="bg-surface border-b border-outline-variant docked full-width top-0 z-50">
                <div className="flex justify-between items-center w-full px-container-padding max-w-[1440px] mx-auto h-16">
                    <div className="flex items-center gap-gutter">
                        <span className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight">CRQ Platform</span>
                    </div>
                    <div className="flex items-center gap-stack-md">
                        <button className="text-on-surface-variant hover:text-primary transition-colors"><span className="material-symbols-outlined">search</span></button>
                        <button className="text-on-surface-variant hover:text-primary transition-colors"><span className="material-symbols-outlined">help</span></button>
                        <button className="text-on-surface-variant hover:text-primary transition-colors"><span className="material-symbols-outlined">settings</span></button>
                        <div className="w-8 h-8 rounded-full bg-surface-variant overflow-hidden border border-outline-variant ml-2">
                            <img alt="User profile" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAC93YQQAb6_mPCcL0xS7VsO6k1um5wx1WcfYdlqwFufL5n4rRrFRGN8nRW8FqQlpxhXQbCLi317DOn09gFsNmQJJCromPSWQaDpl_sp8HG-mllU_Sd-RHFbNHwyPy02ohVNfTWwSilvB3qL5YnuGTw0bd9ftYWAOdvvrox_QcjjqC-53Fhs81jY7-6K03IMoI2IoBuuoHNaQ_d_AIEioAjjVr-QyrmwEAza66936YZqrNbTUH7-ZiKRg" />
                        </div>
                    </div>
                </div>
            </nav>

            <div className="flex flex-1 max-w-[1440px] mx-auto w-full">
                {/* SideNavBar */}
                <aside className="hidden md:flex flex-col bg-surface-container-low border-r border-outline-variant docked full-height left-0 w-64 flex-shrink-0">
                    <div className="py-stack-lg px-gutter h-full flex flex-col">
                        <div className="mb-stack-lg flex items-center gap-stack-sm">
                            <div className="w-10 h-10 rounded bg-primary-container text-on-primary-container flex items-center justify-center font-headline-sm">EP</div>
                            <div>
                                <h2 className="font-title-lg text-title-lg leading-tight">Executive Portal</h2>
                                <p className="font-body-sm text-body-sm text-on-surface-variant">Risk Management</p>
                            </div>
                        </div>
                        <button className="w-full bg-primary text-on-primary font-body-sm text-body-sm py-2 px-4 rounded font-semibold mb-stack-lg hover:bg-opacity-90 transition-opacity">
                            + New Analysis
                        </button>
                        <nav className="flex flex-col gap-unit flex-1">
                            {navItems.map((item) => {
                                const isActive = pathname === item.path;
                                return (
                                    <Link key={item.path} href={item.path} className={`flex items-center gap-stack-sm px-3 py-2 rounded-lg font-label-caps text-label-caps transition-transform duration-150 active:scale-95 ${isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
                                        <span className="material-symbols-outlined text-[18px]">{item.icon}</span> {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="mt-auto flex flex-col gap-unit pt-stack-md border-t border-outline-variant">
                            <Link href="/support" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span className="material-symbols-outlined text-[18px]">help_outline</span> Support
                            </Link>
                            <Link href="/docs" className="flex items-center gap-stack-sm px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps rounded-lg">
                                <span className="material-symbols-outlined text-[18px]">description</span> Documentation
                            </Link>
                        </div>
                    </div>
                </aside>

                {/* Main Content Wrapper */}
                <main className="flex-1 p-container-padding bg-background overflow-y-auto w-full relative">
                    {children}
                    
                    {/* Chatbot Button */}
                    <button className="fixed bottom-stack-lg right-stack-lg w-[60px] h-[60px] rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-lg z-50 hover:bg-opacity-90 transition-all active:scale-95" aria-label="AI Assistant">
                        <span className="material-symbols-outlined text-[28px]">auto_awesome</span>
                    </button>
                </main>
            </div>
            
            {/* Footer */}
            <footer className="bg-surface border-t border-outline-variant docked full-width bottom-0 z-40">
                <div className="flex flex-col md:flex-row justify-between items-center w-full px-container-padding py-stack-md max-w-[1440px] mx-auto gap-stack-sm">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">© 2024 CRQ Executive Minimalist. All rights reserved.</span>
                    <div className="flex gap-gutter font-body-sm text-body-sm text-on-surface-variant">
                        <span className="cursor-pointer hover:text-primary transition-colors">Contextual Help</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">Privacy Policy</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">Security Standards</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">API Documentation</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

import React, { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import { User, ChevronDown, Settings, LogOut, UserPen, Moon, Sun } from 'lucide-react';

interface HeaderProps {
    setIsAdminOpen: (isOpen: boolean) => void;
    lecturerName: string;
}

export function Header({ setIsAdminOpen, lecturerName }: HeaderProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [isDarkMode, setIsDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('theme') === 'dark' ||
                (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
        return false;
    });

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <header className="relative h-24 bg-[#002855] text-white flex items-center justify-between px-6 shadow-md z-10 shrink-0">
            <div className="flex items-center gap-4 flex-1">
                {/* Nové logo ÚPVSP bez okrajů */}
                <div className="bg-white dark:bg-slate-800/10 rounded-lg p-1 flex items-center justify-center shrink-0">
                    <img src="/logo-upvsp.png" alt="ÚPVSP Logo" className="h-14 w-auto object-contain rounded-sm" />
                </div>
                <div className="flex flex-col justify-center hidden md:flex flex-1 pr-12">
                    <h1 className="text-sm font-medium tracking-wide text-[#facc15] leading-tight">Útvar policejního vzdělávání a služební přípravy</h1>
                    <h1 className="text-xl font-bold tracking-tight text-[#facc15] leading-tight mb-0.5">EVALUZ: Vyhodnocování ÚZ účastníků ZOP</h1>
                    <div className="text-xs text-blue-200/60 mt-0.5">
                        <span>Vytvořeno interně na ÚPVSP. 2026. verze 3.1.1</span>
                    </div>
                </div>
                <h1 className="text-xl font-bold tracking-widest md:hidden">EVALUZ</h1>
            </div>
            <div className="flex items-center gap-6">
                <div className="relative" ref={dropdownRef}>
                    <div
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center gap-2 cursor-pointer group transition-all"
                    >
                        <span className="text-sm text-slate-300 font-medium">Přihlášený uživatel:</span>
                        <div className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[#facc15] hover:text-[#002855] text-white transition-colors duration-200">
                            <div className="w-8 h-8 rounded-full bg-slate-700 group-hover:bg-[#002855]/20 flex items-center justify-center transition-colors">
                                <User className="w-5 h-5 text-slate-300 group-hover:text-[#002855]" />
                            </div>
                            <span className="text-sm font-semibold">{lecturerName}</span>
                            <ChevronDown className="w-4 h-4 ml-1 text-slate-300 group-hover:text-[#002855]" />
                        </div>
                    </div>

                    {/* Dropdown Menu */}
                    {isDropdownOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-100 py-1 z-50 animate-in fade-in slide-in-from-top-2">
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    setIsAdminOpen(true);
                                    setTimeout(() => window.dispatchEvent(new CustomEvent('openProfileTab')), 50);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800/50 hover:text-[#002855] transition-colors flex items-center gap-2"
                            >
                                <UserPen className="w-4 h-4" />
                                Můj profil
                            </button>
                            <div className="border-t border-slate-100 my-1"></div>
                            <button
                                onClick={() => {
                                    localStorage.removeItem('upvsp_token');
                                    window.location.reload();
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                            >
                                <LogOut className="w-4 h-4" />
                                Odhlásit se
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className="p-2 text-slate-300 hover:text-white hover:bg-white dark:bg-slate-800/10 rounded-lg transition-colors"
                        aria-label="Přepnout tmavý režim"
                    >
                        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={() => setIsAdminOpen(true)}
                        className="flex items-center gap-2 text-sm font-medium text-white transition-colors bg-[#004085] dark:bg-slate-700/80 hover:bg-[#0050a0] dark:hover:bg-slate-600 px-3 py-2 rounded-lg border border-[#004e9c] dark:border-slate-600"
                    >
                        <Settings className="w-4 h-4" />
                        Administrace
                    </button>
                </div>
            </div>

            {/* Vzkaz umístěný fixně do pravého spodního okraje, přesně pod tlačítkem Administrace */}
            <span className="hidden md:block absolute bottom-2 right-6 text-xs text-blue-200/50 italic">
                ...vždycky EjÁj
            </span>
        </header>
    );
}

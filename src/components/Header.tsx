import React, { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, Settings, LogOut, UserPen } from 'lucide-react';

interface HeaderProps {
    setIsAdminOpen: (isOpen: boolean) => void;
    lecturerName: string;
}

export function Header({ setIsAdminOpen, lecturerName }: HeaderProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

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
        <header className="h-20 bg-[#002855] text-white flex items-center justify-between px-6 shadow-md z-10 shrink-0">
            <div className="flex items-center gap-4">
                {/* Nové logo ÚPVSP bez okrajů */}
                <div className="bg-white/10 rounded-lg p-1 flex items-center justify-center">
                    <img src="/logo-upvsp.png" alt="ÚPVSP Logo" className="h-12 w-auto object-contain rounded-sm" />
                </div>
                <div className="flex flex-col justify-center hidden md:flex">
                    <h1 className="text-sm font-medium tracking-wide text-blue-100/80 leading-tight">Útvar policejního vzdělávání a služební přípravy</h1>
                    <h1 className="text-lg font-bold tracking-tight leading-tight">EVALUZ: Asistent pro vyhodnocování úředních záznamů v ZOP</h1>
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
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-slate-100 py-1 z-50 animate-in fade-in slide-in-from-top-2">
                            <button
                                onClick={() => {
                                    setIsDropdownOpen(false);
                                    setIsAdminOpen(true);
                                    setTimeout(() => window.dispatchEvent(new CustomEvent('openProfileTab')), 50);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-[#002855] transition-colors flex items-center gap-2"
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
                <button
                    onClick={() => setIsAdminOpen(true)}
                    className="flex items-center gap-2 text-sm font-medium hover:text-[#D4AF37] transition-colors"
                >
                    <Settings className="w-4 h-4" />
                    Administrace
                </button>
            </div>
        </header>
    );
}

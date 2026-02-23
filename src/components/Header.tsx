import React from 'react';
import { User, ChevronDown, Settings } from 'lucide-react';

interface HeaderProps {
    setIsAdminOpen: (isOpen: boolean) => void;
}

export function Header({ setIsAdminOpen }: HeaderProps) {
    return (
        <header className="h-16 bg-[#002855] text-white flex items-center justify-between px-6 shadow-md z-10 shrink-0">
            <div className="flex items-center gap-3">
                {/* Nové logo ÚPVSP bez okrajů */}
                <div className="bg-white/10 rounded-lg p-1 flex items-center justify-center">
                    <img src="/logo-upvsp.png" alt="ÚPVSP Logo" className="h-10 w-auto object-contain rounded-sm" />
                </div>
                <h1 className="text-xl font-semibold tracking-wide">ÚPVSP | AI Evaluátor ÚZ</h1>
            </div>
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 cursor-pointer hover:text-[#D4AF37] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-300" />
                    </div>
                    <span className="text-sm font-medium">npor. Mgr. Jan Novák - Lektor</span>
                    <ChevronDown className="w-4 h-4" />
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

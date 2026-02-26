import React, { useState, useEffect } from 'react';
import { Settings, X, SlidersHorizontal, AlertCircle, Save, Loader2, CheckCircle2, UserPen, Download, History } from 'lucide-react';

/**
 * Vlastnosti komponenty AdminModal
 */
interface AdminModalProps {
    /** Příznak, zda je modální okno otevřené */
    isOpen: boolean;
    /** Funkce pro zavření modálního okna */
    onClose: () => void;
    /** Příznak pro režim prvního spuštění (vynucené nastavení profilu) */
    isSetupMode?: boolean;
    /** Callback po úspěšném dokončení úvodního nastavení */
    onSetupComplete?: (token: string) => void;
}

/**
 * Centrální administrace systému EVALUZ.
 * Umožňuje konfiguraci promptů, nastavení vLLM engine, správu uživatelského profilu 
 * a sledování historie exportů.
 */
export function AdminModal({ isOpen, onClose, isSetupMode, onSetupComplete }: AdminModalProps) {
    /** 
     * Aktuálně aktivní záložka v administraci.
     * V režimu setup se začíná na profilu.
     */
    const [adminTab, setAdminTab] = useState<'prompt1' | 'prompt2' | 'prompt3' | 'vllm' | 'profile'>(isSetupMode ? 'profile' : 'prompt1');

    // States for Prompts
    const [prompt1, setPrompt1] = useState('');
    const [prompt2, setPrompt2] = useState('');
    const [prompt3, setPrompt3] = useState('');
    const [temp1, setTemp1] = useState(0.1);
    const [temp2, setTemp2] = useState(0.1);
    const [temp3, setTemp3] = useState(0.1);

    // States for vLLM configuraiton
    const [vllmUrl, setVllmUrl] = useState('');
    const [vllmModel, setVllmModel] = useState('');
    const [vllmApiKey, setVllmApiKey] = useState('');
    const [isApiKeyFocused, setIsApiKeyFocused] = useState(false);

    // Profile State
    const [profile, setProfile] = useState({
        title_before: '',
        first_name: '',
        last_name: '',
        title_after: '',
        rank_shortcut: '',
        rank_full: '',
        school_location: '',
        funkcni_zarazeni: '',
        email: '',
        password: ''
    });

    // History data
    const [exportsHistory, setExportsHistory] = useState<any[]>([]);

    useEffect(() => {
        const handleOpenProfileTab = () => setAdminTab('profile');
        window.addEventListener('openProfileTab', handleOpenProfileTab);
        return () => window.removeEventListener('openProfileTab', handleOpenProfileTab);
    }, []);

    // UI states
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (isOpen && !isSetupMode) {
            fetchAdminData();
        }
    }, [isOpen, isSetupMode]);

    /**
     * Načte všechna administrační data ze serveru:
     * - Systémové prompty pro všechny fáze
     * - Nastavení vLLM (URL, Model, API Klíč)
     * - Aktuální profil přihlášeného lektora
     * - Historii exportů provedených uživatelem
     */
    const fetchAdminData = async () => {
        setIsLoading(true);
        try {
            // Načtení promptů z DB
            const promptRes = await fetch('http://localhost:8000/api/v1/admin/prompts', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (promptRes.ok) {
                const promptsData = await promptRes.json();
                promptsData.forEach((p: any) => {
                    if (p.phase_name === 'prompt1') { setPrompt1(p.content); setTemp1(p.temperature); }
                    if (p.phase_name === 'prompt2') { setPrompt2(p.content); setTemp2(p.temperature); }
                    if (p.phase_name === 'prompt3') { setPrompt3(p.content); setTemp3(p.temperature); }
                });
            }

            // Načtení globálního nastavení (vLLM konektivita)
            const settingsRes = await fetch('http://localhost:8000/api/v1/admin/settings', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                settingsData.forEach((s: any) => {
                    if (s.key === 'VLLM_API_URL') setVllmUrl(s.value);
                    if (s.key === 'VLLM_MODEL_NAME') setVllmModel(s.value);
                    if (s.key === 'VLLM_API_KEY') setVllmApiKey(s.value);
                });
            }

            // Načtení detailů o aktuálním uživateli (pro doložku)
            const meRes = await fetch('http://localhost:8000/api/v1/auth/me', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (meRes.ok) {
                const meData = await meRes.json();
                setProfile({
                    title_before: meData.title_before || '',
                    first_name: meData.first_name || '',
                    last_name: meData.last_name || '',
                    title_after: meData.title_after || '',
                    rank_shortcut: meData.rank_shortcut || '',
                    rank_full: meData.rank_full || '',
                    school_location: meData.school_location || '',
                    funkcni_zarazeni: meData.funkcni_zarazeni || '',
                    email: meData.email || '',
                    password: ''
                });
            }

            // Načtení historie exportů
            const historyRes = await fetch('http://localhost:8000/api/v1/export/history', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (historyRes.ok) {
                const historyData = await historyRes.json();
                setExportsHistory(historyData);
            }

        } catch (error) {
            console.error('Chyba při inicializaci administrace:', error);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Provede zkušební dotaz na nakonfigurované vLLM rozhraní.
     * Ověřuje, zda je server dostupný a zda model odpovídá.
     */
    const handleTestConnection = async () => {
        setIsTestingConnection(true);
        try {
            const res = await fetch('http://localhost:8000/api/v1/admin/test-llm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({
                    base_url: vllmUrl,
                    model_id: vllmModel,
                    api_key: vllmApiKey
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert(data.message || "Připojení k vLLM je v pořádku.");
            } else {
                alert(`Chyba připojení: ${data.detail || 'Neznámá chyba'}`);
            }
        } catch (error) {
            console.error('Test spojení selhal:', error);
            alert("Nepodařilo se kontaktovat server pro testování spojení.");
        } finally {
            setIsTestingConnection(false);
        }
    };

    /**
     * Uloží aktuálně upravovaná data na základě zvolené záložky.
     * Podporuje vytváření účtu (setup), ukládání promptů, profilu nebo vLLM nastavení.
     */
    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            if (isSetupMode) {
                // Speciální případ: Vytvoření prvního uživatele
                const res = await fetch('http://localhost:8000/api/v1/auth/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: profile.email,
                        password: profile.password,
                        first_name: profile.first_name,
                        last_name: profile.last_name,
                        title_before: profile.title_before,
                        title_after: profile.title_after,
                        rank_shortcut: profile.rank_shortcut,
                        rank_full: profile.rank_full,
                        school_location: profile.school_location,
                        funkcni_zarazeni: profile.funkcni_zarazeni
                    })
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.detail || "Chyba při vytváření účtu");
                }
                const data = await res.json();
                if (onSetupComplete) onSetupComplete(data.access_token);
                return;
            }

            // Ukládání běží podle toho, který tab je aktivní
            if (adminTab === 'vllm') {
                await fetch('http://localhost:8000/api/v1/admin/settings', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify([
                        { key: 'VLLM_API_URL', value: vllmUrl },
                        { key: 'VLLM_MODEL_NAME', value: vllmModel },
                        { key: 'VLLM_API_KEY', value: vllmApiKey }
                    ])
                });
            } else if (adminTab === 'profile') {
                await fetch('http://localhost:8000/api/v1/auth/me', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify(profile)
                });
            } else {
                await fetch('http://localhost:8000/api/v1/admin/prompts', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify([
                        { phase_name: 'prompt1', content: prompt1, temperature: temp1 },
                        { phase_name: 'prompt2', content: prompt2, temperature: temp2 },
                        { phase_name: 'prompt3', content: prompt3, temperature: temp3 }
                    ])
                });
            }
            setSaveSuccess(true);
            // Má-li se změna (vč. role v hlavičce) projevit ihned, vynutíme reload nebo re-fetch.
            // Pro jednoduchost a jistotu čistého stavu volíme reload po krátké prodlevě.
            if (adminTab === 'profile') {
                setTimeout(() => window.location.reload(), 1000);
            } else {
                setTimeout(() => setSaveSuccess(false), 3000);
            }
        } catch (error) {
            console.error('Ukládání selhalo:', error);
            alert("Chyba při ukládání na server.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    // Helper specific to current tab
    const currentPromptText = adminTab === 'prompt1' ? prompt1 : adminTab === 'prompt2' ? prompt2 : prompt3;
    const currentPromptTemp = adminTab === 'prompt1' ? temp1 : adminTab === 'prompt2' ? temp2 : temp3;
    const setPromptText = adminTab === 'prompt1' ? setPrompt1 : adminTab === 'prompt2' ? setPrompt2 : setPrompt3;
    const setPromptTemp = adminTab === 'prompt1' ? setTemp1 : adminTab === 'prompt2' ? setTemp2 : setTemp3;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Modal Header */}
                <div className="px-6 py-4 bg-[#002855] text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5 text-[#D4AF37]" />
                        <h2 className="text-lg font-semibold tracking-wide">
                            {isSetupMode ? "První spuštění: Vytvoření hlavního lektorského účtu" : "Administrace systému EVALUZ & Prompt Engineering"}
                        </h2>
                    </div>
                    {!isSetupMode && (
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {/* Modal Body */}
                <div className="flex-1 flex overflow-hidden relative">
                    {/* Modal Sidebar */}
                    {!isSetupMode && (
                        <div className="w-64 bg-slate-50 border-r border-slate-200 p-4 flex flex-col gap-1">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Kategorie promptů</h3>
                            <button
                                onClick={() => setAdminTab('prompt1')}
                                className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${adminTab === 'prompt1'
                                    ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                            >
                                Fáze 1: Precizace kritérií
                            </button>
                            <button
                                onClick={() => setAdminTab('prompt2')}
                                className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${adminTab === 'prompt2'
                                    ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                            >
                                Fáze 2: Evaluace ÚZ (JSON)
                            </button>
                            <button
                                onClick={() => setAdminTab('prompt3')}
                                className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${adminTab === 'prompt3'
                                    ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                            >
                                Fáze 3: Globální analýza
                            </button>
                            <div className="my-2 border-t border-slate-200"></div>
                            <button
                                onClick={() => setAdminTab('vllm')}
                                className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${adminTab === 'vllm'
                                    ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                            >
                                <SlidersHorizontal className="w-4 h-4" />
                                Napojení na vLLM (API)
                            </button>

                            <div className="my-2 border-t border-slate-200"></div>

                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2 mt-2">Uživatelský účet</h3>
                            <button
                                onClick={() => setAdminTab('profile')}
                                className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${adminTab === 'profile'
                                    ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                    : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                            >
                                <UserPen className="w-4 h-4" />
                                Profil a podpisová doložka
                            </button>
                        </div>
                    )}

                    {/* Modal Content */}
                    <div className="flex-1 p-6 flex flex-col bg-white overflow-hidden">
                        {isLoading ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                                <p>Načítám z databáze...</p>
                            </div>
                        ) : adminTab === 'profile' ? (
                            <div className="flex-1 flex flex-col overflow-y-auto pr-2">
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-[#002855] mb-1">Profil lektora a podpisová doložka</h3>
                                    <p className="text-sm text-slate-500">Údaje zadané níže budou použity pro generování PDF a oddělení vašich dat.</p>
                                </div>

                                <div className="space-y-6 max-w-2xl">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Služební e-mail uživatele</label>
                                        <input type="email" required value={profile.email} disabled={!isSetupMode} onChange={e => setProfile({ ...profile, email: e.target.value })} className={`w-full border ${isSetupMode ? 'border-slate-300 focus:ring-2 focus:ring-[#002855]' : 'border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed'} rounded-lg px-4 py-2 text-sm outline-none`} />
                                    </div>

                                    {isSetupMode && (
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Bezpečné heslo pro přihlášení</label>
                                            <input type="password" minLength={12} pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{12,}" title="Min. 12 znaků, kombinace A, a, 1" required value={profile.password} onChange={e => setProfile({ ...profile, password: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                            <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Min. 12 znaků, kombinace A, a, 1</p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Titul před jménem</label>
                                            <input type="text" placeholder="Bc., Mgr., Ing." value={profile.title_before} onChange={e => setProfile({ ...profile, title_before: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Titul za jménem</label>
                                            <input type="text" placeholder="Ph.D." value={profile.title_after} onChange={e => setProfile({ ...profile, title_after: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Jméno</label>
                                            <input type="text" value={profile.first_name} onChange={e => setProfile({ ...profile, first_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Příjmení</label>
                                            <input type="text" value={profile.last_name} onChange={e => setProfile({ ...profile, last_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">hodnostní označení</label>
                                            <input type="text" placeholder="plk., kpt., por." value={profile.rank_shortcut} onChange={e => setProfile({ ...profile, rank_shortcut: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Hodnost</label>
                                            <select value={profile.rank_full} onChange={e => setProfile({ ...profile, rank_full: e.target.value })} className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] outline-none bg-white">
                                                <option value="">Vyberte hodnost</option>
                                                <option value="vrchní komisař">vrchní komisař</option>
                                                <option value="rada">rada</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Funkční zařazení</label>
                                            <select
                                                value={profile.funkcni_zarazeni}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    let newRankShortcut = profile.rank_shortcut;
                                                    let newRankFull = profile.rank_full;

                                                    if (val === 'Lektor') {
                                                        newRankShortcut = 'kpt.';
                                                        newRankFull = 'vrchní komisař';
                                                    } else if (val === 'Metodik') {
                                                        newRankShortcut = 'pplk.';
                                                        newRankFull = 'rada';
                                                    }

                                                    setProfile({
                                                        ...profile,
                                                        funkcni_zarazeni: val,
                                                        rank_shortcut: newRankShortcut,
                                                        rank_full: newRankFull
                                                    });
                                                }}
                                                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] outline-none bg-white"
                                            >
                                                <option value="">Vyberte zařazení</option>
                                                <option value="Lektor">Lektor</option>
                                                <option value="Metodik">Metodik</option>
                                                <option value="Administrátor">Administrátor</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Školní útvar / Pracoviště</label>
                                            <select
                                                value={profile.school_location}
                                                onChange={e => setProfile({ ...profile, school_location: e.target.value })}
                                                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] outline-none bg-white"
                                            >
                                                <option value="">Vyberte útvar...</option>
                                                <option value="ÚPVSP">ÚPVSP</option>
                                                <option value="VZ Holešov">VZ Holešov</option>
                                                <option value="VZ Brno">VZ Brno</option>
                                                <option value="VZ Hrdlořezy">VZ Hrdlořezy</option>
                                                <option value="VZ Pardubice">VZ Pardubice</option>
                                                <option value="VZ Jihlava">VZ Jihlava</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Živý náhled doložky */}
                                    <div className="mt-8 p-5 bg-slate-50 border border-slate-200 rounded-xl relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-[#D4AF37]"></div>
                                        <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                                            <UserPen className="w-3.5 h-3.5" />
                                            Živý náhled podpisové doložky
                                        </h4>
                                        <div className="text-[15px] text-slate-800 leading-relaxed font-medium">
                                            {profile.rank_shortcut} {profile.title_before} {profile.first_name} {profile.last_name}{profile.title_after ? `, ${profile.title_after}` : ''}
                                            <br />
                                            {profile.rank_full}
                                            <br />
                                            Útvar policejního vzdělávání a služební přípravy
                                            {profile.school_location && profile.school_location !== 'ÚPVSP' && (
                                                <>
                                                    <br />
                                                    <span className="text-[#002855] font-semibold">{profile.school_location}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Historie Exportů */}
                                {!isSetupMode && exportsHistory.length > 0 && (
                                    <div className="mt-8">
                                        <h3 className="text-lg font-bold text-[#002855] mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
                                            <History className="w-5 h-5 text-slate-500" />
                                            Moje poslední exporty
                                        </h3>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-[#002855]/5 text-[#002855] text-xs uppercase font-semibold">
                                                    <tr>
                                                        <th className="px-4 py-3 rounded-tl-lg">Datum exportu</th>
                                                        <th className="px-4 py-3">Scénář / Třída</th>
                                                        <th className="px-4 py-3">Typ</th>
                                                        <th className="px-4 py-3 text-right rounded-tr-lg">Akce</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {exportsHistory.map((item, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                            <td className="px-4 py-3 font-medium text-slate-600">{item.created_at}</td>
                                                            <td className="px-4 py-3 font-semibold text-slate-800">{item.scenario_name}</td>
                                                            <td className="px-4 py-3">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#D4AF37]/10 text-[#C5A028]">
                                                                    {item.type}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                <a
                                                                    href={`http://localhost:8000${item.download_url}`}
                                                                    download
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#002855] hover:bg-[#002855] hover:text-white border border-[#002855]/20 rounded transition-colors"
                                                                >
                                                                    <Download className="w-3.5 h-3.5" />
                                                                    Stáhnout znovu
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : adminTab !== 'vllm' ? (
                            <>
                                <div className="mb-4">
                                    <h3 className="text-lg font-bold text-[#002855] mb-1">
                                        Systémový prompt: {adminTab === 'prompt1' ? 'Fáze 1' : adminTab === 'prompt2' ? 'Fáze 2' : 'Fáze 3'}
                                    </h3>
                                    <p className="text-sm text-slate-500 flex items-start gap-1.5 mb-2">
                                        <AlertCircle className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-shrink-0" />
                                        <span>
                                            Zde můžete upravit chování AI. Změny se projeví u všech lektorů a uloží se do DB.
                                            {adminTab === 'prompt3' && (
                                                <span className="block mt-1 text-[#002855] font-medium">
                                                    Tip: V textu níže můžete libovolně upravit hranice pro hodnocení třídy (např. Vynikající 90-100% místo 80-100%). AI se těmito pásmy bude při analýze striktně řídit.
                                                </span>
                                            )}
                                        </span>
                                    </p>
                                </div>

                                <textarea
                                    className="flex-1 w-full border border-slate-300 rounded-xl p-4 font-mono text-sm text-slate-700 focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none resize-none leading-relaxed bg-slate-50"
                                    value={currentPromptText}
                                    onChange={(e) => setPromptText(e.target.value)}
                                />

                                <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                                    <div>
                                        <label className="block text-sm font-semibold text-[#002855] mb-1">Model Temperature</label>
                                        <p className="text-xs text-slate-500">Určuje míru kreativity vs. faktické přesnosti modelu.</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="0" max="1" step="0.1"
                                            value={currentPromptTemp}
                                            onChange={(e) => setPromptTemp(parseFloat(e.target.value))}
                                            className="w-32 accent-[#002855]"
                                        />
                                        <span className="bg-white border border-slate-200 px-3 py-1 rounded-md text-sm font-mono font-medium text-[#002855]">
                                            {currentPromptTemp} (Faktická přesnost)
                                        </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col">
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-[#002855] mb-1">Konfigurace inferenčního enginu</h3>
                                    <p className="text-sm text-slate-500">Nastavení připojení k lokálnímu vLLM (L40S) serveru uložené v DB.</p>
                                </div>

                                <div className="space-y-6 max-w-2xl">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">API Endpoint URL</label>
                                        <div className="flex gap-3">
                                            <input
                                                type="text"
                                                placeholder="http://localhost:8000/v1"
                                                value={vllmUrl}
                                                onChange={(e) => setVllmUrl(e.target.value)}
                                                className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                                            />
                                            <button
                                                onClick={handleTestConnection}
                                                disabled={isTestingConnection || !vllmUrl || !vllmModel}
                                                className="px-4 py-2.5 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {isTestingConnection && <Loader2 className="w-4 h-4 animate-spin" />}
                                                {isTestingConnection ? 'Testuji...' : 'Test připojení'}
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Název modelu / Model ID</label>
                                        <input
                                            type="text"
                                            placeholder="qwen2.5-32b-instruct"
                                            value={vllmModel}
                                            onChange={(e) => setVllmModel(e.target.value)}
                                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">API Key (volitelné)</label>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            data-lpignore="true"
                                            placeholder="sk-..."
                                            value={isApiKeyFocused ? vllmApiKey : (vllmApiKey ? '••••••••••••••••' : '')}
                                            onChange={(e) => setVllmApiKey(e.target.value)}
                                            onFocus={() => setIsApiKeyFocused(true)}
                                            onBlur={() => setIsApiKeyFocused(false)}
                                            onPaste={(e) => e.stopPropagation()}
                                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                                            title="API klíč (skrytý pro bezpečnost, změňte kliknutím a vložením nového)"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <div>
                        {saveSuccess && (
                            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 animate-in fade-in slide-in-from-bottom-2">
                                <CheckCircle2 className="w-4 h-4" /> Uloženo do databáze
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {!isSetupMode && (
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium shadow-sm"
                            >
                                Zrušit (Zavřít)
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={isSaving || isLoading}
                            className={`flex items-center gap-2 px-5 py-2.5 ${saveSuccess ? 'bg-emerald-600' : 'bg-gradient-to-r from-[#D4AF37] to-[#C5A028]'} text-white rounded-lg hover:opacity-90 transition-all text-sm font-bold shadow-md disabled:opacity-50`}
                        >
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : saveSuccess ? (
                                <CheckCircle2 className="w-4 h-4" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {isSaving ? 'Ukládám...' : saveSuccess ? 'Uloženo' : (isSetupMode ? 'Vytvořit účet' : 'Uložit do DB')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}


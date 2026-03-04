import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import { Settings, X, SlidersHorizontal, AlertCircle, Save, Loader2, CheckCircle2, UserPen, Download, History, Users, UserPlus, Key, Power } from 'lucide-react';
import { useDialog } from '../contexts/DialogContext';

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
    const { showAlert, showPrompt } = useDialog();
    /** 
     * Aktuálně aktivní záložka v administraci.
     * V režimu setup se začíná na profilu.
     */
    const [adminTab, setAdminTab] = useState<'prompt1' | 'prompt2' | 'prompt3' | 'vllm' | 'profile' | 'users' | 'rag'>(isSetupMode ? 'profile' : 'prompt1');

    // States for Prompts
    const [prompt1, setPrompt1] = useState('');
    const [prompt2, setPrompt2] = useState('');
    const [prompt3, setPrompt3] = useState('');
    const [temp1, setTemp1] = useState(0.1);
    const [temp2, setTemp2] = useState(0.1);
    const [temp3, setTemp3] = useState(0.1);

    // States for vLLM configuraiton
    const [vllmUrl, setVllmUrl] = useState('');
    const [vllmApiKey, setVllmApiKey] = useState('');
    const [isApiKeyFocused, setIsApiKeyFocused] = useState(false);

    // Multi-LLM Routing
    const [llmPlatform, setLlmPlatform] = useState('vllm'); // vllm, ollama, lmstudio
    const [modelExtraction, setModelExtraction] = useState('');
    const [thinkingExtraction, setThinkingExtraction] = useState(false);
    const [modelPhase1, setModelPhase1] = useState('');
    const [thinkingPhase1, setThinkingPhase1] = useState(false);
    const [modelPhase2, setModelPhase2] = useState('');
    const [thinkingPhase2, setThinkingPhase2] = useState(true);
    const [modelPhase3, setModelPhase3] = useState('');
    const [thinkingPhase3, setThinkingPhase3] = useState(true);

    // Advanced LLM settings
    const [vllmTopP, setVllmTopP] = useState(1.0);
    const [vllmPresence, setVllmPresence] = useState(0.0);
    const [vllmFreq, setVllmFreq] = useState(0.0);
    const [vllmMaxTokens, setVllmMaxTokens] = useState(2048);
    const [vllmEnableThinking, setVllmEnableThinking] = useState(true);

    // MLOps & RAG
    const [enableRagModule, setEnableRagModule] = useState(false);

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
        password: '',
        is_superadmin: false
    });

    // Users Management State
    const [usersList, setUsersList] = useState<any[]>([]);
    const [isUsersLoading, setIsUsersLoading] = useState(false);
    const [showAddUser, setShowAddUser] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '', is_superadmin: false });

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
            const promptRes = await fetch(`${API_BASE_URL}/admin/prompts`, {
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
            const settingsRes = await fetch(`${API_BASE_URL}/admin/settings`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                settingsData.forEach((s: any) => {
                    if (s.key === 'VLLM_API_URL') setVllmUrl(s.value);
                    if (s.key === 'VLLM_API_KEY') setVllmApiKey(s.value);
                    if (s.key === 'VLLM_TOP_P') setVllmTopP(parseFloat(s.value));
                    if (s.key === 'VLLM_PRESENCE_PENALTY') setVllmPresence(parseFloat(s.value));
                    if (s.key === 'VLLM_FREQUENCY_PENALTY') setVllmFreq(parseFloat(s.value));
                    if (s.key === 'VLLM_MAX_TOKENS') setVllmMaxTokens(parseInt(s.value, 10));

                    // Multi-LLM Parsing
                    if (s.key === 'LLM_PLATFORM') setLlmPlatform(s.value);
                    if (s.key === 'MODEL_EXTRACTION') setModelExtraction(s.value);
                    if (s.key === 'THINKING_EXTRACTION') setThinkingExtraction(s.value === 'true');
                    if (s.key === 'MODEL_PHASE1') setModelPhase1(s.value);
                    if (s.key === 'THINKING_PHASE1') setThinkingPhase1(s.value === 'true');
                    if (s.key === 'MODEL_PHASE2') setModelPhase2(s.value);
                    if (s.key === 'THINKING_PHASE2') setThinkingPhase2(s.value === 'true');
                    if (s.key === 'MODEL_PHASE3') setModelPhase3(s.value);
                    if (s.key === 'THINKING_PHASE3') setThinkingPhase3(s.value === 'true');

                    if (s.key === 'ENABLE_RAG_MODULE') setEnableRagModule(s.value === 'true');
                });
            }

            // Načtení detailů o aktuálním uživateli (pro doložku)
            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
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
                    password: '',
                    is_superadmin: meData.is_superadmin || false
                });
            }

            // Načtení historie exportů
            const historyRes = await fetch(`${API_BASE_URL}/export/history`, {
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

    const fetchUsers = async () => {
        setIsUsersLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/users`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUsersList(data);
            }
        } catch (e) {
            console.error("Failed to fetch users", e);
        } finally {
            setIsUsersLoading(false);
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API_BASE_URL}/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify(newUser)
            });
            if (res.ok) {
                showAlert("Uživatel úspěšně vytvořen.");
                setShowAddUser(false);
                setNewUser({ email: '', password: '', first_name: '', last_name: '', is_superadmin: false });
                fetchUsers();
            } else {
                const err = await res.json();
                showAlert(err.detail || "Chyba při vytváření.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleToggleActive = async (id: number) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/users/${id}/toggle-active`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) fetchUsers();
        } catch (e) {
            console.error(e);
        }
    };

    const handleResetPassword = async (id: number) => {
        const pass = await showPrompt("Zadejte zástupné jednorázové heslo pro uživatele (min. 6 znaků):");
        if (!pass || pass.length < 6) return;
        try {
            const res = await fetch(`${API_BASE_URL}/admin/users/${id}/reset-password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({ new_password: pass })
            });
            if (res.ok) {
                showAlert("Heslo uživatele bylo úspěšně přepsáno.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    /**
     * Provede zkušební dotaz na nakonfigurované vLLM rozhraní.
     * Ověřuje, zda je server dostupný a zda model odpovídá.
     */
    const handleTestConnection = async () => {
        setIsTestingConnection(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/test-llm`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({
                    base_url: vllmUrl,
                    model_id: modelPhase2 || modelExtraction || 'test-model',
                    api_key: vllmApiKey
                })
            });
            const data = await res.json();
            if (res.ok) {
                showAlert(data.message || "Připojení k vLLM je v pořádku.");
            } else {
                showAlert(`Chyba připojení: ${data.detail || 'Neznámá chyba'}`);
            }
        } catch (error) {
            console.error('Test spojení selhal:', error);
            showAlert("Nepodařilo se kontaktovat server pro testování spojení.");
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
                const res = await fetch(`${API_BASE_URL}/auth/setup`, {
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
                await fetch(`${API_BASE_URL}/admin/settings`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify([
                        { key: 'VLLM_API_URL', value: vllmUrl },
                        { key: 'VLLM_API_KEY', value: vllmApiKey },
                        { key: 'LLM_PLATFORM', value: llmPlatform },
                        { key: 'MODEL_EXTRACTION', value: modelExtraction },
                        { key: 'THINKING_EXTRACTION', value: thinkingExtraction ? 'true' : 'false' },
                        { key: 'MODEL_PHASE1', value: modelPhase1 },
                        { key: 'THINKING_PHASE1', value: thinkingPhase1 ? 'true' : 'false' },
                        { key: 'MODEL_PHASE2', value: modelPhase2 },
                        { key: 'THINKING_PHASE2', value: thinkingPhase2 ? 'true' : 'false' },
                        { key: 'MODEL_PHASE3', value: modelPhase3 },
                        { key: 'THINKING_PHASE3', value: thinkingPhase3 ? 'true' : 'false' },
                        { key: 'VLLM_TOP_P', value: vllmTopP.toString() },
                        { key: 'VLLM_PRESENCE_PENALTY', value: vllmPresence.toString() },
                        { key: 'VLLM_FREQUENCY_PENALTY', value: vllmFreq.toString() },
                        { key: 'VLLM_MAX_TOKENS', value: vllmMaxTokens.toString() }
                    ])
                });
            } else if (adminTab === 'profile') {
                await fetch(`${API_BASE_URL}/auth/me`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify(profile)
                });
            } else if (adminTab === 'rag') {
                await fetch(`${API_BASE_URL}/admin/settings`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                    },
                    body: JSON.stringify([
                        { key: 'ENABLE_RAG_MODULE', value: enableRagModule ? 'true' : 'false' }
                    ])
                });
            } else {
                await fetch(`${API_BASE_URL}/admin/prompts`, {
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
            showAlert("Chyba při ukládání na server.");
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
                        <div className="w-64 bg-slate-50 border-r border-slate-200 p-4 flex flex-col gap-1 overflow-y-auto">
                            {(profile.is_superadmin || profile.funkcni_zarazeni === 'Metodik') && (
                                <>
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
                                </>
                            )}

                            {profile.is_superadmin && (
                                <>
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

                                    <button
                                        onClick={() => setAdminTab('rag')}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${adminTab === 'rag'
                                            ? 'bg-purple-100/50 text-purple-700 font-semibold border-l-4 border-purple-500'
                                            : 'text-slate-600 hover:bg-slate-100'
                                            }`}
                                    >
                                        <div className="w-4 h-4 bg-gradient-to-tr from-purple-600 to-fuchsia-500 rounded-sm flex items-center justify-center">
                                            <span className="text-[10px] text-white font-black">AI</span>
                                        </div>
                                        Laboratoř & MLOps
                                    </button>

                                    <div className="my-2 border-t border-slate-200"></div>
                                </>
                            )}

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

                            {profile.is_superadmin && (
                                <>
                                    <div className="my-2 border-t border-slate-200"></div>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2 mt-2">Pokročilá správa</h3>
                                    <button
                                        onClick={() => { setAdminTab('users'); fetchUsers(); }}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${adminTab === 'users'
                                            ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]'
                                            : 'text-slate-600 hover:bg-slate-100'
                                            }`}
                                    >
                                        <Users className="w-4 h-4" />
                                        Správa uživatelů
                                    </button>
                                </>
                            )}
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
                                                                    href={`${API_BASE_URL.replace('/api/v1', '')}${item.download_url}`}
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
                        ) : adminTab === 'users' ? (
                            <div className="flex-1 flex flex-col overflow-y-auto pr-2">
                                <div className="flex justify-between items-center mb-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-[#002855] mb-1">Správa uživatelů</h3>
                                        <p className="text-sm text-slate-500">Účty lektorů s přístupem do aplikace.</p>
                                    </div>
                                    <button onClick={() => setShowAddUser(!showAddUser)} className="flex items-center gap-1.5 px-3 py-2 bg-[#002855]/10 text-[#002855] font-semibold rounded-lg hover:bg-[#002855]/20 transition-colors text-sm">
                                        <UserPlus className="w-4 h-4" /> {showAddUser ? 'Zavřít' : 'Nový uživatel'}
                                    </button>
                                </div>

                                {showAddUser && (
                                    <form onSubmit={handleAddUser} className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-700 mb-1">E-mail</label>
                                                <input type="email" required value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-700 mb-1">Dočasné heslo</label>
                                                <input type="password" required value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-700 mb-1">Jméno</label>
                                                <input type="text" required value={newUser.first_name} onChange={e => setNewUser({ ...newUser, first_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-700 mb-1">Příjmení</label>
                                                <input type="text" required value={newUser.last_name} onChange={e => setNewUser({ ...newUser, last_name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none" />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input type="checkbox" id="is_superadmin" checked={newUser.is_superadmin} onChange={e => setNewUser({ ...newUser, is_superadmin: e.target.checked })} />
                                            <label htmlFor="is_superadmin" className="text-sm font-medium text-slate-700">Je to SuperAdmin (může spravovat ostatní)</label>
                                        </div>
                                        <button type="submit" className="w-full py-2 bg-[#002855] text-white font-semibold rounded-lg text-sm hover:bg-[#001f44]">Vytvořit účet</button>
                                    </form>
                                )}

                                {isUsersLoading ? (
                                    <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
                                ) : (
                                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                        <table className="w-full text-sm text-left bg-white">
                                            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                                <tr>
                                                    <th className="px-4 py-3">Jméno a Příjmení</th>
                                                    <th className="px-4 py-3">E-mail</th>
                                                    <th className="px-4 py-3">Role a Stav</th>
                                                    <th className="px-4 py-3 text-right">Akce</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {usersList.map((u: any) => (
                                                    <tr key={u.id} className="hover:bg-slate-50/50">
                                                        <td className="px-4 py-3 font-medium text-slate-800">{u.first_name} {u.last_name}</td>
                                                        <td className="px-4 py-3 text-slate-500">{u.email}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex gap-2 items-center">
                                                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${u.is_superadmin ? 'bg-blue-100 text-[#002855]' : 'bg-slate-100 text-slate-600'}`}>
                                                                    {u.is_superadmin ? 'SuperAdmin' : 'Lektor'}
                                                                </span>
                                                                {!u.is_active && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">Deaktivován</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 flex gap-2 justify-end">
                                                            <button onClick={() => handleResetPassword(u.id)} className="p-1.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 rounded shadow-sm transition-colors" title="Vnutit nové heslo">
                                                                <Key className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleToggleActive(u.id)} className={`p-1.5 bg-white border border-slate-200 shadow-sm rounded transition-colors ${u.is_active ? 'hover:border-red-300 hover:bg-red-50 text-slate-600 hover:text-red-600' : 'hover:border-emerald-300 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600'}`} title={u.is_active ? "Zablokovat přístup" : "Povolit přístup"}>
                                                                <Power className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
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
                        ) : adminTab === 'vllm' ? (
                            <div className="flex-1 flex flex-col overflow-y-auto pr-2">
                                <div className="mb-6 border-b border-slate-200 pb-4">
                                    <h3 className="text-lg font-bold text-[#002855] mb-1">Správa LLM Backendů (Multi-LLM)</h3>
                                    <p className="text-sm text-slate-500">Volba inferenčního enginu a mapování úloh na konkrétní modely.</p>
                                </div>

                                <div className="space-y-6 max-w-3xl">
                                    <div className="bg-slate-50 p-4 border border-slate-200 rounded-xl">
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                                            <Power className="w-4 h-4 text-blue-600" />
                                            Hlavní připojení (Endpoint Node)
                                        </h4>
                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cílová Platforma</label>
                                                <select
                                                    value={llmPlatform}
                                                    onChange={(e) => setLlmPlatform(e.target.value)}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none shadow-sm"
                                                >
                                                    <option value="vllm">vLLM (Produkce GPU)</option>
                                                    <option value="lmstudio">LM Studio (Lokální vývoj)</option>
                                                    <option value="ollama">Ollama (Lokální CLI)</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">API Endpoint URL</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        placeholder={llmPlatform === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:8000/v1'}
                                                        value={vllmUrl}
                                                        onChange={(e) => setVllmUrl(e.target.value)}
                                                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none shadow-sm"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-4 items-end">
                                            <div className="flex-1">
                                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">API Key (volitelné)</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    placeholder="sk-..."
                                                    value={isApiKeyFocused ? vllmApiKey : (vllmApiKey ? '••••••••••••••••' : '')}
                                                    onChange={(e) => setVllmApiKey(e.target.value)}
                                                    onFocus={() => setIsApiKeyFocused(true)}
                                                    onBlur={() => setIsApiKeyFocused(false)}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none shadow-sm"
                                                />
                                            </div>
                                            <button
                                                onClick={handleTestConnection}
                                                disabled={isTestingConnection || !vllmUrl}
                                                className="px-4 py-2 border border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
                                            >
                                                {isTestingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                                                {isTestingConnection ? 'Testuji...' : 'Test připojení'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Task Routing */}
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                                            <SlidersHorizontal className="w-4 h-4 text-[#D4AF37]" />
                                            Task Routing (Přiřazení modelů a uvažování)
                                        </h4>
                                        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                                            Rozdělením úkolů mezi menší rychlé modely (např. Llama3) a mohutné reasoning modely (např. Qwen2.5) drasticky zvýšíte plynulost aplikace.
                                        </p>

                                        <div className="space-y-3">
                                            {/* Extrakce */}
                                            <div className="grid grid-cols-[1fr_2fr_auto] gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <div>
                                                    <span className="block text-sm font-semibold text-slate-700">Fast-Scan Vytěžení</span>
                                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">Analýza jména z dokumentu</span>
                                                </div>
                                                <input type="text" placeholder="např. llama3.2-1b" value={modelExtraction} onChange={e => setModelExtraction(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none" />
                                                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-100 transition-colors">
                                                    <input type="checkbox" checked={thinkingExtraction} onChange={e => setThinkingExtraction(e.target.checked)} className="w-4 h-4 accent-[#002855]" /> Enable Thinking
                                                </label>
                                            </div>

                                            {/* Fáze 1 */}
                                            <div className="grid grid-cols-[1fr_2fr_auto] gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <div>
                                                    <span className="block text-sm font-semibold text-slate-700">Fáze 1</span>
                                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">Precizace a příprava kritérií</span>
                                                </div>
                                                <input type="text" placeholder="např. qwen2.5-14b-instruct" value={modelPhase1} onChange={e => setModelPhase1(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none" />
                                                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-100 transition-colors">
                                                    <input type="checkbox" checked={thinkingPhase1} onChange={e => setThinkingPhase1(e.target.checked)} className="w-4 h-4 accent-[#002855]" /> Enable Thinking
                                                </label>
                                            </div>

                                            {/* Fáze 2 */}
                                            <div className="grid grid-cols-[1fr_2fr_auto] gap-4 items-center bg-blue-50/50 border border-blue-200 rounded-lg p-3">
                                                <div>
                                                    <span className="block text-sm font-bold text-[#002855]">Fáze 2 (Core)</span>
                                                    <span className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide">Samotné hodnocení ÚZ (Nejtěžší)</span>
                                                </div>
                                                <input type="text" placeholder="např. qwen2.5-32b-instruct" value={modelPhase2} onChange={e => setModelPhase2(e.target.value)} className="w-full border border-blue-300 rounded-md px-3 py-1.5 text-sm outline-none ring-1 ring-blue-100" />
                                                <label className="flex items-center gap-2 text-sm font-bold text-blue-900 bg-white border border-blue-200 px-3 py-1.5 rounded-md cursor-pointer hover:bg-blue-50 transition-colors">
                                                    <input type="checkbox" checked={thinkingPhase2} onChange={e => setThinkingPhase2(e.target.checked)} className="w-4 h-4 accent-[#002855]" /> Enable Thinking
                                                </label>
                                            </div>

                                            {/* Fáze 3 */}
                                            <div className="grid grid-cols-[1fr_2fr_auto] gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <div>
                                                    <span className="block text-sm font-semibold text-slate-700">Fáze 3</span>
                                                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">Statistická analýza třídy</span>
                                                </div>
                                                <input type="text" placeholder="Odpovídá hlavnímu modelu" value={modelPhase3} onChange={e => setModelPhase3(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none" />
                                                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-100 transition-colors">
                                                    <input type="checkbox" checked={thinkingPhase3} onChange={e => setThinkingPhase3(e.target.checked)} className="w-4 h-4 accent-[#002855]" /> Enable Thinking
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-6 mt-6 border-t border-slate-200">
                                        <h3 className="text-md font-bold text-slate-800 mb-1 flex items-center gap-2">
                                            <Settings className="w-4 h-4 text-slate-400" />
                                            Sdílené samplovací parametry
                                        </h3>
                                        <p className="text-xs text-slate-500 mb-6 font-medium">
                                            Tyto hodnoty budou aplikovány globálně na <strong>všechny specifikované modely výše</strong>.
                                        </p>

                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                                <label className="block text-sm font-semibold text-slate-700 mb-1">Max Tokens (Limit odpovědi)</label>
                                                <p className="text-[10px] text-slate-400 mb-2 leading-tight">Hard stop stav pro generování. Qwen3.5 potřebuje 2048+.</p>
                                                <input type="number" min="128" max="32768" value={vllmMaxTokens} onChange={e => setVllmMaxTokens(parseInt(e.target.value) || 2048)} className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none shadow-sm" />
                                            </div>
                                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col justify-center">
                                                <p className="text-xs text-slate-500 italic text-center">Teplotu (Kreativitu) modelu lze nastavit ručně pro každou jednotlivou fázi hodnocení v příslušných záložkách.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex items-center justify-between">
                                                <div className="pr-4 w-1/2">
                                                    <label className="block text-sm font-semibold text-[#002855] mb-1">Top_P (Nucleus Sampling)</label>
                                                    <p className="text-xs text-slate-500 leading-tight">Vybírá nejlepší slova v percentilu. Snižuje šanci na utíkání od tématu. Doporučeno: 0.8 pro kratší odpovědi.</p>
                                                </div>
                                                <div className="flex items-center gap-3 w-1/2 justify-end">
                                                    <input type="range" min="0" max="1" step="0.05" value={vllmTopP} onChange={(e) => setVllmTopP(parseFloat(e.target.value))} className="w-32 accent-[#002855]" />
                                                    <span className="w-12 text-center bg-white border border-slate-200 px-2 py-1 rounded text-sm font-mono text-[#002855]">{vllmTopP}</span>
                                                </div>
                                            </div>

                                            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex items-center justify-between">
                                                <div className="pr-4 w-1/2">
                                                    <label className="block text-sm font-semibold text-[#002855] mb-1">Presence Penalty</label>
                                                    <p className="text-xs text-slate-500 leading-tight">Zamezuje neúnavnému generování nových témat a redukuje "rozvláčnost". 0.0 je neutrální, 1.0 je vysoké rozšiřování.</p>
                                                </div>
                                                <div className="flex items-center gap-3 w-1/2 justify-end">
                                                    <input type="range" min="-2.0" max="2.0" step="0.1" value={vllmPresence} onChange={(e) => setVllmPresence(parseFloat(e.target.value))} className="w-32 accent-[#002855]" />
                                                    <span className="w-12 text-center bg-white border border-slate-200 px-2 py-1 rounded text-sm font-mono text-[#002855]">{vllmPresence}</span>
                                                </div>
                                            </div>

                                            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex items-center justify-between">
                                                <div className="pr-4 w-1/2">
                                                    <label className="block text-sm font-semibold text-[#002855] mb-1">Frequency Penalty</label>
                                                    <p className="text-xs text-slate-500 leading-tight">Penalizuje často se opakující slova. Pomáhá zamezit smyčkám při dlouhých výstupech (0.0 neutrální).</p>
                                                </div>
                                                <div className="flex items-center gap-3 w-1/2 justify-end">
                                                    <input type="range" min="-2.0" max="2.0" step="0.1" value={vllmFreq} onChange={(e) => setVllmFreq(parseFloat(e.target.value))} className="w-32 accent-[#002855]" />
                                                    <span className="w-12 text-center bg-white border border-slate-200 px-2 py-1 rounded text-sm font-mono text-[#002855]">{vllmFreq}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : adminTab === 'rag' ? (
                            <div className="flex-1 flex flex-col overflow-y-auto pr-2">
                                <div className="mb-6 border-b border-slate-200 pb-4">
                                    <h3 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-700 to-fuchsia-600 mb-1 flex items-center gap-2">
                                        AI Laboratoř & MLOps (Zlaté příklady)
                                    </h3>
                                    <p className="text-sm text-slate-500">
                                        Experimentální funkce pro učení se z vlastních (perfektních) hodnocení. Využívá RAG.
                                    </p>
                                </div>
                                <div className="space-y-6 max-w-3xl">
                                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 p-6 rounded-xl shadow-sm">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h4 className="text-md font-bold text-slate-800 flex items-center gap-2 mb-2">
                                                    Zapnout sdílenou paměť Zlatých příkladů (RAG)
                                                </h4>
                                                <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
                                                    Pokud tuto funkci aktivujete, ukáže se lektorům u každé úspěšné evaluace tlačítko <strong className="text-yellow-600">"Uložit jako Zlatý příklad"</strong>. Pokud jej stisknou, jejich dokonale opravené hodnocení se propíše do sítě a pomůže modelu automaticky zlepšit odhady pro ostatní studenty v dané situaci (tzv. referenční etalon, Few-Shot RAG).
                                                </p>
                                            </div>
                                            <div className="shrink-0 pt-2">
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={enableRagModule}
                                                        onChange={(e) => setEnableRagModule(e.target.checked)}
                                                    />
                                                    <div className="w-14 h-7 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-slate-500 bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                                        <strong className="text-blue-800 block mb-1">Jak to funguje technicky?</strong>
                                        <p>Zlaté příklady jsou ukládány do databáze (Cosine podoba, či textová filtrace podle Scenario ID). Připojený LLM při zapnutí Fáze 2 stáhne nejbližší zlatý příklad do historie chatu a naformátuje z něj bezchybnou JSON ukázku pro model. To drasticky redukuje halucinace Fáze 2.</p>
                                    </div>
                                </div>
                            </div>
                        ) : null}
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
                            disabled={isSaving || isLoading || adminTab === 'users'}
                            style={{ opacity: adminTab === 'users' ? 0.3 : 1 }}
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
        </div >
    );
}


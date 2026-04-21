import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import {
    faGear, faXmark, faSliders, faCircleExclamation, faFloppyDisk, faCircleCheck,
    faUserPen, faDownload, faClockRotateLeft, faUsers, faUserPlus, faKey, faPowerOff,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
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
    const [adminTab, setAdminTab] = useState<'prompt1' | 'prompt2' | 'prompt3' | 'vllm' | 'profile' | 'users'>(isSetupMode ? 'profile' : 'prompt1');

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
    const [vllmContextWindow, setVllmContextWindow] = useState(8192);
    const [vllmEnableThinking, setVllmEnableThinking] = useState(true);
    const [concurrencyOpenRouter, setConcurrencyOpenRouter] = useState(2);
    const [concurrencyVllm, setConcurrencyVllm] = useState(8);


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
    const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '', role: 'vyucujici' });

    // History data
    const [exportsHistory, setExportsHistory] = useState<any[]>([]);

    // Poznámka: openProfileTab event byl odstraněn — profil se nyní otevírá
    // v samostatném ProfileModal (viz Header.tsx → setIsProfileOpen).

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
                    if (s.key === 'LLM_CONTEXT_WINDOW') setVllmContextWindow(parseInt(s.value, 10));

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

                    if (s.key === 'LLM_CONCURRENCY_OPENROUTER') setConcurrencyOpenRouter(parseInt(s.value, 10) || 2);
                    if (s.key === 'LLM_CONCURRENCY_VLLM') setConcurrencyVllm(parseInt(s.value, 10) || 8);
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
                setNewUser({ email: '', password: '', first_name: '', last_name: '', role: 'vyucujici' });
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

    const handleRoleChange = async (id: number, newRole: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/users/${id}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                showAlert("Role úspěšně změněna.");
                fetchUsers();
            } else {
                const err = await res.json();
                showAlert(err.detail || "Chyba při změně role.");
            }
        } catch (e) {
            console.error(e);
            showAlert("Chyba spojení při změně role.");
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
                        { key: 'VLLM_MAX_TOKENS', value: vllmMaxTokens.toString() },
                        { key: 'LLM_CONTEXT_WINDOW', value: vllmContextWindow.toString() },
                        { key: 'LLM_CONCURRENCY_OPENROUTER', value: concurrencyOpenRouter.toString() },
                        { key: 'LLM_CONCURRENCY_VLLM', value: concurrencyVllm.toString() }
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
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 960, height: '85vh', display: 'flex', flexDirection: 'column' }}>
                {/* Modal Header */}
                <div className="modal__header modal__header--primary">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon={faGear} /> {isSetupMode ? "První spuštění: Vytvoření hlavního účtu vyučujícího" : "Administrace systému EVALUZ"}
                    </span>
                    {!isSetupMode && (
                        <button className="btn btn--sm btn--icon-only" style={{ background: 'transparent', border: 'none', color: '#fff' }} onClick={onClose}>
                            <Icon icon={faXmark} />
                        </button>
                    )}
                </div>

                {/* Modal Body */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    {/* Sidebar */}
                    {!isSetupMode && (
                        <div style={{ width: 220, background: 'var(--bg-surface-2)', borderRight: '1px solid var(--border-color)', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flexShrink: 0 }}>
                            {profile.is_superadmin && (
                                <>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px 2px' }}>Kategorie promptů</span>
                                    {(['prompt1', 'prompt2', 'prompt3'] as const).map((tab, i) => (
                                        <button key={tab} onClick={() => setAdminTab(tab)} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 5, fontSize: '0.82rem', fontWeight: adminTab === tab ? 700 : 500, background: adminTab === tab ? 'var(--color-primary-light, rgba(15,82,125,0.1))' : 'transparent', color: adminTab === tab ? 'var(--color-primary)' : 'var(--text-secondary)', border: `1px solid ${adminTab === tab ? 'var(--color-primary)' : 'transparent'}`, borderLeft: adminTab === tab ? `3px solid var(--color-primary)` : '3px solid transparent', cursor: 'pointer' }}>
                                            Fáze {i + 1}: {['Precizace kritérií', 'Evaluace ÚZ', 'Globální analýza'][i]}
                                        </button>
                                    ))}
                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                                    <button onClick={() => setAdminTab('vllm')} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 5, fontSize: '0.82rem', fontWeight: adminTab === 'vllm' ? 700 : 500, background: adminTab === 'vllm' ? 'rgba(15,82,125,0.1)' : 'transparent', color: adminTab === 'vllm' ? 'var(--color-primary)' : 'var(--text-secondary)', border: `1px solid ${adminTab === 'vllm' ? 'var(--color-primary)' : 'transparent'}`, borderLeft: adminTab === 'vllm' ? '3px solid var(--color-primary)' : '3px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Icon icon={faSliders} size="xs" /> Napojení na vLLM (API)
                                    </button>
                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                                </>
                            )}
                            {profile.is_superadmin && (
                                <>
                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px 2px' }}>Pokročilá správa</span>
                                    <button onClick={() => { setAdminTab('users'); fetchUsers(); }} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 5, fontSize: '0.82rem', fontWeight: adminTab === 'users' ? 700 : 500, background: adminTab === 'users' ? 'rgba(15,82,125,0.1)' : 'transparent', color: adminTab === 'users' ? 'var(--color-primary)' : 'var(--text-secondary)', border: `1px solid ${adminTab === 'users' ? 'var(--color-primary)' : 'transparent'}`, borderLeft: adminTab === 'users' ? '3px solid var(--color-primary)' : '3px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Icon icon={faUsers} size="xs" /> Správa uživatelů
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Content */}
                    <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {isLoading ? (
                            <div className="loading-overlay" style={{ position: 'relative', flex: 1 }}>
                                <span className="spinner spinner--lg" />
                                <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Načítám z databáze...</p>
                            </div>
                        ) : adminTab === 'profile' ? (
                            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                                <div style={{ marginBottom: 16 }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Profil vyučujícího a podpisová doložka</h3>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Údaje zadané níže budou použity pro generování PDF a oddělení vašich dat.</p>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600 }}>
                                    <div className="form-group">
                                        <label>Služební e-mail uživatele</label>
                                        <input type="email" required value={profile.email} disabled={!isSetupMode} onChange={e => setProfile({ ...profile, email: e.target.value })} className="form-control" />
                                    </div>
                                    {isSetupMode && (
                                        <div className="form-group">
                                            <label>Bezpečné heslo pro přihlášení</label>
                                            <input type="password" minLength={12} pattern="(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{12,}" title="Min. 12 znaků, kombinace A, a, 1" required value={profile.password} onChange={e => setProfile({ ...profile, password: e.target.value })} className="form-control" />
                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Icon icon={faCircleExclamation} size="xs" /> Min. 12 znaků, kombinace A, a, 1</p>
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        <div className="form-group"><label>Titul před jménem</label><input type="text" placeholder="Bc., Mgr., Ing." value={profile.title_before} onChange={e => setProfile({ ...profile, title_before: e.target.value })} className="form-control" /></div>
                                        <div className="form-group"><label>Titul za jménem</label><input type="text" placeholder="Ph.D." value={profile.title_after} onChange={e => setProfile({ ...profile, title_after: e.target.value })} className="form-control" /></div>
                                        <div className="form-group"><label>Jméno</label><input type="text" value={profile.first_name} onChange={e => setProfile({ ...profile, first_name: e.target.value })} className="form-control" /></div>
                                        <div className="form-group"><label>Příjmení</label><input type="text" value={profile.last_name} onChange={e => setProfile({ ...profile, last_name: e.target.value })} className="form-control" /></div>
                                        <div className="form-group"><label>Hodnostní označení</label><input type="text" placeholder="plk., kpt., por." value={profile.rank_shortcut} onChange={e => setProfile({ ...profile, rank_shortcut: e.target.value })} className="form-control" /></div>
                                        <div className="form-group">
                                            <label>Hodnost</label>
                                            <select value={profile.rank_full} onChange={e => setProfile({ ...profile, rank_full: e.target.value })} className="form-control">
                                                <option value="">Vyberte hodnost</option>
                                                <option value="vrchní komisař">vrchní komisař</option>
                                                <option value="rada">rada</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Funkční zařazení</label>
                                            <select value={profile.funkcni_zarazeni} onChange={e => {
                                                const val = e.target.value;
                                                let newRankShortcut = profile.rank_shortcut;
                                                let newRankFull = profile.rank_full;
                                                if (val === 'Lektor') { newRankShortcut = 'kpt.'; newRankFull = 'vrchní komisař'; }
                                                else if (val === 'Metodik') { newRankShortcut = 'pplk.'; newRankFull = 'rada'; }
                                                setProfile({ ...profile, funkcni_zarazeni: val, rank_shortcut: newRankShortcut, rank_full: newRankFull });
                                            }} className="form-control">
                                                <option value="">Vyberte zařazení</option>
                                                <option value="Vyučující">Vyučující</option>
                                                <option value="Metodik">Metodik</option>
                                                <option value="Administrátor">Administrátor</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Organizační článek</label>
                                            <select value={profile.school_location} onChange={e => setProfile({ ...profile, school_location: e.target.value })} className="form-control">
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
                                    <div style={{ padding: 16, background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', borderLeft: '3px solid var(--color-warning)', borderRadius: 6, marginTop: 8 }}>
                                        <h4 style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Icon icon={faUserPen} size="xs" /> Živý náhled podpisové doložky
                                        </h4>
                                        <div style={{ fontSize: '0.9rem', lineHeight: 1.7, fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {profile.rank_shortcut} {profile.title_before} {profile.first_name} {profile.last_name}{profile.title_after ? `, ${profile.title_after}` : ''}<br />
                                            {profile.rank_full}<br />
                                            Útvar policejního vzdělávání a služební přípravy
                                            {profile.school_location && profile.school_location !== 'ÚPVSP' && (<><br /><span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{profile.school_location}</span></>)}
                                        </div>
                                    </div>

                                    {/* Historie exportů */}
                                    {!isSetupMode && exportsHistory.length > 0 && (
                                        <div style={{ marginTop: 16 }}>
                                            <h4 style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                                                <Icon icon={faClockRotateLeft} /> Moje poslední exporty
                                            </h4>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Datum exportu</th>
                                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Scénář / Třída</th>
                                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Typ</th>
                                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Akce</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {exportsHistory.map((item, idx) => (
                                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                            <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{item.created_at}</td>
                                                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item.scenario_name}</td>
                                                            <td style={{ padding: '8px 12px' }}><span className="badge badge--light">{item.type}</span></td>
                                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                                <a href={`${API_BASE_URL.replace('/api/v1', '')}${item.download_url}`} download onClick={(e) => e.stopPropagation()} className="btn btn--outline btn--sm">
                                                                    <Icon icon={faDownload} /> Stáhnout znovu
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : adminTab === 'users' ? (
                            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                                    <div>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Správa uživatelů</h3>
                                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Účty uživatelů s přístupem do aplikace.</p>
                                    </div>
                                    <button className="btn btn--outline btn--sm" onClick={() => setShowAddUser(!showAddUser)}>
                                        <Icon icon={faUserPlus} /> {showAddUser ? 'Zavřít' : 'Nový uživatel'}
                                    </button>
                                </div>
                                {showAddUser && (
                                    <form onSubmit={handleAddUser} className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <div className="form-group"><label>E-mail</label><input type="email" required value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} className="form-control" /></div>
                                            <div className="form-group"><label>Dočasné heslo</label><input type="password" required value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="form-control" /></div>
                                            <div className="form-group"><label>Jméno</label><input type="text" required value={newUser.first_name} onChange={e => setNewUser({ ...newUser, first_name: e.target.value })} className="form-control" /></div>
                                            <div className="form-group"><label>Příjmení</label><input type="text" required value={newUser.last_name} onChange={e => setNewUser({ ...newUser, last_name: e.target.value })} className="form-control" /></div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Role:</label>
                                            <select value={newUser.role || 'vyucujici'} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="form-control" style={{ width: 'auto' }}>
                                                <option value="vyucujici">Vyučující</option>
                                                <option value="admin">Admin</option>
                                                <option value="superadmin">SuperAdmin</option>
                                            </select>
                                        </div>
                                        <button type="submit" className="btn btn--positive">Vytvořit účet</button>
                                    </form>
                                )}
                                {isUsersLoading ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><span className="spinner spinner--lg" /></div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Jméno a Příjmení</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>E-mail</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Role a Stav</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Akce</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usersList.map((u: any) => (
                                                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{u.first_name} {u.last_name}</td>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{u.email}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                            <select value={u.is_superadmin ? 'superadmin' : (u.is_admin ? 'admin' : 'vyucujici')} onChange={(e) => handleRoleChange(u.id, e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.78rem', padding: '3px 28px 3px 6px' }}>
                                                                <option value="vyucujici">Vyučující</option>
                                                                <option value="admin">Admin</option>
                                                                <option value="superadmin">SuperAdmin</option>
                                                            </select>
                                                            {!u.is_active && <span className="badge badge--negative">Deaktivován</span>}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                            <button className="btn btn--sm btn--icon-only btn--outline" onClick={() => handleResetPassword(u.id)} title="Vnutit nové heslo"><Icon icon={faKey} /></button>
                                                            <button className={`btn btn--sm btn--icon-only ${u.is_active ? 'btn--negative' : 'btn--positive'}`} onClick={() => handleToggleActive(u.id)} title={u.is_active ? "Zablokovat přístup" : "Povolit přístup"}><Icon icon={faPowerOff} /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ) : adminTab !== 'vllm' ? (
                            <>
                                <div style={{ marginBottom: 12 }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>
                                        Systémový prompt: {adminTab === 'prompt1' ? 'Fáze 1' : adminTab === 'prompt2' ? 'Fáze 2' : 'Fáze 3'}
                                    </h3>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                        <Icon icon={faCircleExclamation} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
                                        <span>
                                            Zde můžete upravit chování AI. Změny se projeví u všech uživatelů a uloží se do DB.
                                            {adminTab === 'prompt3' && <span style={{ display: 'block', marginTop: 4, color: 'var(--color-primary)', fontWeight: 600 }}>Tip: V textu níže můžete libovolně upravit hranice pro hodnocení třídy (např. Vynikající 90-100% místo 80-100%). AI se těmito pásmy bude při analýze striktně řídit.</span>}
                                        </span>
                                    </p>
                                </div>
                                <textarea className="form-control" style={{ flex: 1, resize: 'none', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 }} value={currentPromptText} onChange={(e) => setPromptText(e.target.value)} />
                                <div className="card" style={{ marginTop: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                    <div>
                                        <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-primary)', display: 'block', marginBottom: 2 }}>Model Temperature</label>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Určuje míru kreativity vs. faktické přesnosti modelu.</p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <input type="range" min="0" max="1" step="0.1" value={currentPromptTemp} onChange={(e) => setPromptTemp(parseFloat(e.target.value))} style={{ width: 120, accentColor: 'var(--color-primary)' }} />
                                        <span style={{ padding: '3px 10px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', borderRadius: 5, fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--color-primary)' }}>{currentPromptTemp} (Faktická přesnost)</span>
                                    </div>
                                </div>
                            </>
                        ) : adminTab === 'vllm' ? (
                            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Správa LLM Backendů (Multi-LLM)</h3>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Volba inferenčního enginu a mapování úloh na konkrétní modely.</p>
                                </div>

                                <div className="card" style={{ padding: 14, flexShrink: 0 }}>
                                    <h4 style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Icon icon={faPowerOff} style={{ color: 'var(--color-primary)' }} /> Hlavní připojení (Endpoint Node)
                                    </h4>
                                    <div className="form-group" style={{ marginBottom: 8 }}>
                                        <label>Cílová Platforma</label>
                                        <select value={llmPlatform} onChange={(e) => setLlmPlatform(e.target.value)} className="form-control" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%236c757d' d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', backgroundSize: '12px', paddingRight: 32 }}>
                                            <option value="vllm">vLLM (Produkce GPU)</option>
                                            <option value="openrouter">OpenRouter (API Gateway)</option>
                                            <option value="lmstudio">LM Studio (Lokální vývoj)</option>
                                            <option value="ollama">Ollama (Lokální CLI)</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 8 }}>
                                        <label>API Endpoint URL</label>
                                        <input type="text" placeholder={
                                            llmPlatform === 'ollama' ? 'http://localhost:11434/v1' :
                                            llmPlatform === 'lmstudio' ? 'http://localhost:1234/v1' :
                                            llmPlatform === 'openrouter' ? 'https://openrouter.ai/api/v1' :
                                            'http://localhost:8000/v1'
                                        } value={vllmUrl} onChange={(e) => setVllmUrl(e.target.value)} className="form-control" />
                                    </div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                        <div className="form-group" style={{ flex: 1, margin: 0 }}>
                                            <label>API Key {llmPlatform === 'vllm' ? '(volitelné)' : '(povinné)'}</label>
                                            <input type="text" autoComplete="off" placeholder={llmPlatform === 'openrouter' ? 'sk-or-v1-...' : 'sk-...'} value={isApiKeyFocused ? vllmApiKey : (vllmApiKey ? '••••••••••••••••' : '')} onChange={(e) => setVllmApiKey(e.target.value)} onFocus={() => setIsApiKeyFocused(true)} onBlur={() => setIsApiKeyFocused(false)} className="form-control" />
                                        </div>
                                        <button className="btn btn--outline" onClick={handleTestConnection} disabled={isTestingConnection || !vllmUrl}>
                                            {isTestingConnection ? <span className="spinner spinner--sm" /> : <Icon icon={faPowerOff} />}
                                            {isTestingConnection ? 'Testuji...' : 'Test připojení'}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <h4 style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Icon icon={faSliders} style={{ color: 'var(--color-warning)' }} /> Task Routing (Přiřazení modelů a uvažování)
                                    </h4>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>Rozdělením úkolů mezi menší rychlé modely (např. Llama3) a mohutné reasoning modely (např. Qwen2.5) drasticky zvýšíte plynulost aplikace.</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {[
                                            { label: 'Fast-Scan Vytěžení', desc: 'Analýza jména z dokumentu', model: modelExtraction, setModel: setModelExtraction, thinking: thinkingExtraction, setThinking: setThinkingExtraction, ph: 'např. llama3.2-1b', highlight: false },
                                            { label: 'Fáze 1', desc: 'Precizace a příprava kritérií', model: modelPhase1, setModel: setModelPhase1, thinking: thinkingPhase1, setThinking: setThinkingPhase1, ph: 'např. qwen2.5-14b-instruct', highlight: false },
                                            { label: 'Fáze 2 (Core)', desc: 'Samotné hodnocení ÚZ (Nejtěžší)', model: modelPhase2, setModel: setModelPhase2, thinking: thinkingPhase2, setThinking: setThinkingPhase2, ph: 'např. qwen2.5-32b-instruct', highlight: true },
                                            { label: 'Fáze 3', desc: 'Statistická analýza třídy', model: modelPhase3, setModel: setModelPhase3, thinking: thinkingPhase3, setThinking: setThinkingPhase3, ph: 'Odpovídá hlavnímu modelu', highlight: false },
                                        ].map((row, i) => (
                                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 10, alignItems: 'center', padding: '10px 12px', background: row.highlight ? 'rgba(15,82,125,0.06)' : 'var(--bg-surface-2)', border: `1px solid ${row.highlight ? 'var(--color-primary)' : 'var(--border-color)'}`, borderRadius: 6 }}>
                                                <div><span style={{ display: 'block', fontWeight: row.highlight ? 700 : 600, fontSize: '0.82rem', color: row.highlight ? 'var(--color-primary)' : 'var(--text-primary)' }}>{row.label}</span><span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{row.desc}</span></div>
                                                <input type="text" placeholder={row.ph} value={row.model} onChange={e => row.setModel(e.target.value)} className="form-control" style={{ fontSize: '0.82rem' }} />
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', padding: '6px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 5, whiteSpace: 'nowrap' }}>
                                                    <input type="checkbox" checked={row.thinking} onChange={e => row.setThinking(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} /> Enable Thinking
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
                                    <h4 style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Icon icon={faGear} size="sm" /> Sdílené samplovací parametry</h4>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>Tyto hodnoty budou aplikovány globálně na <strong>všechny specifikované modely výše</strong>.</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                                        <div className="card" style={{ padding: 12 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: 4 }}>Max Tokens (Limit odpovědi)</label>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>Hard stop stav pro generování. Qwen3.5 potřebuje 2048+.</p>
                                            <input type="number" min="128" max="32768" value={vllmMaxTokens} onChange={e => setVllmMaxTokens(parseInt(e.target.value) || 2048)} className="form-control" />
                                        </div>
                                        <div className="card" style={{ padding: 12 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: 4, color: 'var(--color-primary)' }}>
                                                Context Window {llmPlatform === 'ollama' && <span className="badge badge--positive" style={{ fontSize: '0.6rem', marginLeft: 4 }}>Auto-Apply</span>}
                                            </label>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>Velikost kontextu modelu. Pro ÚZ s 25+ kritérii doporučeno 16384+.</p>
                                            <input type="number" min="1024" max="128000" step="1024" value={vllmContextWindow} onChange={e => setVllmContextWindow(parseInt(e.target.value) || 8192)} className="form-control" />
                                        </div>
                                    </div>

                                    {/* Batch concurrency — rozděleno dle platformy */}
                                    <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12, marginBottom: 14, marginTop: 4 }}>
                                        <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 2px' }}>Paralelní zpracování (Batch Concurrency)</h4>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Počet ÚZ vyhodnocovaných souběžně. Změna se projeví po restartu serveru.</p>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                                        <div className="card" style={{ padding: 12 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: 4 }}>
                                                OpenRouter
                                                <span className="badge badge--warning" style={{ fontSize: '0.6rem', marginLeft: 6 }}>Rate-limit</span>
                                            </label>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>OpenRouter má rate limity. Doporučeno: 1–3.</p>
                                            <input type="number" min="1" max="10" value={concurrencyOpenRouter} onChange={e => setConcurrencyOpenRouter(parseInt(e.target.value) || 2)} className="form-control" />
                                        </div>
                                        <div className="card" style={{ padding: 12 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: 4 }}>
                                                vLLM (GPU server)
                                                <span className="badge badge--positive" style={{ fontSize: '0.6rem', marginLeft: 6 }}>Batch</span>
                                            </label>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>L40S zvládne 8+ souběžných. Doporučeno: 8.</p>
                                            <input type="number" min="1" max="32" value={concurrencyVllm} onChange={e => setConcurrencyVllm(parseInt(e.target.value) || 8)} className="form-control" />
                                        </div>
                                    </div>

                                    {llmPlatform !== 'ollama' && (
                                        <div className="alert alert--warning" style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <Icon icon={faCircleExclamation} style={{ flexShrink: 0, marginTop: 2 }} />
                                            <p style={{ margin: 0, fontSize: '0.78rem' }}>U platformy <strong>{llmPlatform.toUpperCase()}</strong> musí být tato hodnota nastavena přímo v inferenčním serveru. EVALUZ tuto hodnotu pro {llmPlatform.toUpperCase()} používá pouze jako limit pro přípravu promptu.</p>
                                        </div>
                                    )}
                                    {[
                                        { key: 'Top_P (Nucleus Sampling)', desc: 'Vybírá nejlepší slova v percentilu. Snižuje šanci na utíkání od tématu. Doporučeno: 0.8.', val: vllmTopP, set: setVllmTopP, min: 0, max: 1, step: 0.05 },
                                        { key: 'Presence Penalty', desc: 'Zamezuje generování nových témat a redukuje rozvláčnost. 0.0 je neutrální.', val: vllmPresence, set: setVllmPresence, min: -2, max: 2, step: 0.1 },
                                        { key: 'Frequency Penalty', desc: 'Penalizuje opakující se slova. Pomáhá zamezit smyčkám (0.0 neutrální).', val: vllmFreq, set: setVllmFreq, min: -2, max: 2, step: 0.1 },
                                    ].map((row, i) => (
                                        <div key={i} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <div style={{ flex: 1, paddingRight: 16 }}>
                                                <label style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--color-primary)', display: 'block', marginBottom: 2 }}>{row.key}</label>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{row.desc}</p>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <input type="range" min={row.min} max={row.max} step={row.step} value={row.val} onChange={(e) => row.set(parseFloat(e.target.value))} style={{ width: 100, accentColor: 'var(--color-primary)' }} />
                                                <span style={{ width: 44, textAlign: 'center', padding: '2px 6px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--color-primary)' }}>{row.val}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="modal__footer">
                    <div>
                        {saveSuccess && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-positive)' }}>
                                <Icon icon={faCircleCheck} /> Uloženo do databáze
                            </span>
                        )}
                    </div>
                    {/* NCIKT pořadí: Negativní → Neutrální → Pozitivní */}
                    <div className="btn-group">
                        {!isSetupMode && (
                            <button className="btn btn--negative" onClick={onClose}>Zrušit (Zavřít)</button>
                        )}
                        <button
                            className={`btn btn--positive btn--lg${saveSuccess ? '' : ''}`}
                            onClick={handleSave}
                            disabled={isSaving || isLoading || adminTab === 'users'}
                            style={{ opacity: adminTab === 'users' ? 0.3 : 1 }}
                        >
                            {isSaving ? <span className="spinner spinner--sm spinner--white" /> : saveSuccess ? <Icon icon={faCircleCheck} /> : <Icon icon={faFloppyDisk} />}
                            {isSaving ? 'Ukládám...' : saveSuccess ? 'Uloženo' : (isSetupMode ? 'Vytvořit účet' : 'Uložit do DB')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}


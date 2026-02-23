import React, { useState, useEffect } from 'react';
import { Settings, X, SlidersHorizontal, AlertCircle, Save, Loader2, CheckCircle2 } from 'lucide-react';

interface AdminModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
    const [adminTab, setAdminTab] = useState<'prompt1' | 'prompt2' | 'prompt3' | 'vllm'>('prompt1');

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

    // UI states
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchAdminData();
        }
    }, [isOpen]);

    const fetchAdminData = async () => {
        setIsLoading(true);
        try {
            // Fetch Prompts
            const promptRes = await fetch('http://localhost:8000/api/v1/admin/prompts');
            if (promptRes.ok) {
                const promptsData = await promptRes.json();
                promptsData.forEach((p: any) => {
                    if (p.phase_name === 'prompt1') { setPrompt1(p.content); setTemp1(p.temperature); }
                    if (p.phase_name === 'prompt2') { setPrompt2(p.content); setTemp2(p.temperature); }
                    if (p.phase_name === 'prompt3') { setPrompt3(p.content); setTemp3(p.temperature); }
                });
            }

            // Fetch Settings
            const settingsRes = await fetch('http://localhost:8000/api/v1/admin/settings');
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                settingsData.forEach((s: any) => {
                    if (s.key === 'VLLM_API_URL') setVllmUrl(s.value);
                    if (s.key === 'VLLM_MODEL_NAME') setVllmModel(s.value);
                    if (s.key === 'VLLM_API_KEY') setVllmApiKey(s.value);
                });
            }
        } catch (error) {
            console.error('Failed to fetch admin data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTestingConnection(true);
        try {
            const res = await fetch('http://localhost:8000/api/v1/admin/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            console.error('Test connection failed:', error);
            alert("Nepodařilo se kontaktovat server pro testování spojení.");
        } finally {
            setIsTestingConnection(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            if (adminTab !== 'vllm') {
                // Save Prompts
                await fetch('http://localhost:8000/api/v1/admin/prompts', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([
                        { phase_name: 'prompt1', content: prompt1, temperature: temp1 },
                        { phase_name: 'prompt2', content: prompt2, temperature: temp2 },
                        { phase_name: 'prompt3', content: prompt3, temperature: temp3 }
                    ])
                });
            } else {
                // Save Settings
                await fetch('http://localhost:8000/api/v1/admin/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([
                        { key: 'VLLM_API_URL', value: vllmUrl },
                        { key: 'VLLM_MODEL_NAME', value: vllmModel },
                        { key: 'VLLM_API_KEY', value: vllmApiKey }
                    ])
                });
            }
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to save data:', error);
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
                        <h2 className="text-lg font-semibold tracking-wide">Administrace systému & Prompt Engineering</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 flex overflow-hidden relative">
                    {/* Modal Sidebar */}
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
                    </div>

                    {/* Modal Content */}
                    <div className="flex-1 p-6 flex flex-col bg-white overflow-hidden">
                        {isLoading ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                                <p>Načítám konfiguraci z databáze...</p>
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
                        <button
                            onClick={onClose}
                            className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium shadow-sm"
                        >
                            Zrušit (Zavřít)
                        </button>
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
                            {isSaving ? 'Ukládám...' : saveSuccess ? 'Uloženo' : 'Uložit do DB'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}


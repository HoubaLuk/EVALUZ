import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../utils/api';

import { Wand2, UploadCloud, User, CheckCircle2, ChevronRight, Shield, Save, Loader2, Paperclip } from 'lucide-react';
import { useDialog } from '../contexts/DialogContext';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    uploadedText?: string;
}

interface TabCriteriaProps {
    scenarioId: string | null;
    scenarioName: string | null;
    onCriteriaSaved?: () => void;
}

/**
 * KOMPONENTA: TAB CRITERIA (SPRÁVA KRITÉRIÍ)
 * Tato část aplikace slouží k definování hodnotících kritérií.
 * Lektor zde může využít AI asistenta (Phase 1) k vyladění kritérií před samotným hodnocením.
 */
export function TabCriteria({ scenarioId, scenarioName, onCriteriaSaved }: TabCriteriaProps) {
    const { showAlert } = useDialog();
    const [messages, setMessages] = useState<ChatMessage[]>([{
        role: 'assistant',
        content: 'Dobrý den, jsem váš AI asistent pro tvorbu hodnotících kritérií. Vložte prosím název modelové situace a svá heslovitá kritéria. Budu se vás následně doptávat na detaily.'
    }]);
    const [inputValue, setInputValue] = useState('');
    const [isChatLoading, setIsChatLoading] = useState(false);

    const [criteriaMarkdown, setCriteriaMarkdown] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isFetchingCriteria, setIsFetchingCriteria] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch existing criteria when scenarioId changes
    useEffect(() => {
        // Reset chat messages to default when scenario changes
        setMessages([{
            role: 'assistant',
            content: 'Dobrý den, jsem váš AI asistent pro tvorbu hodnotících kritérií. Vložte prosím název modelové situace a svá heslovitá kritéria. Budu se vás následně doptávat na detaily.'
        }]);

        if (!scenarioId) {
            setCriteriaMarkdown('Vyberte prosím situaci v levém panelu.');
            return;
        }
        fetchCriteria();
    }, [scenarioId]);

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isChatLoading]);

    const fetchCriteria = async () => {
        if (!scenarioId) return;

        setIsFetchingCriteria(true);
        setCriteriaMarkdown('Načítám kritéria...');

        try {
            const res = await fetch(`${API_BASE_URL}/criteria/${scenarioId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setCriteriaMarkdown(data.markdown_content);
            } else {
                setCriteriaMarkdown(''); // Reset if no criteria exist for this scenario
            }
        } catch (error) {
            console.error('Nepodařilo se načíst kritéria:', error);
            setCriteriaMarkdown('');
        } finally {
            setIsFetchingCriteria(false);
        }
    };

    /**
     * FUNKCE: NAHRÁNÍ METODIKY DO CHATU
     * Umožňuje lektorovi nahrát soubor zadání, ze kterého si AI "vyčte" kontext
     * a následně lépe pomůže s návrhem kritérií.
     */
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);

        const fileMessage: ChatMessage = {
            role: 'user',
            content: `Posílám soubor metodiky ke studiu: ${file.name}`
        };
        setMessages(prev => [...prev, fileMessage]);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_BASE_URL}/criteria/extract-context`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                body: formData
            });

            if (!res.ok) throw new Error('Failed to extract file context');
            const data = await res.json();

            // FAST TRACK: Insert directly into the text area
            setCriteriaMarkdown(data.text);

            // Add assistant message with the optional processing button
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Soubor byl úspěšně nahrán. Text jsem vložil přímo do pole s kritérii k vaší revizi.',
                uploadedText: data.text
            }]);

        } catch (error) {
            console.error('Chyba při nahrávání souboru:', error);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Nepodařilo se zpracovat nahraný soubor. Zkuste to prosím znovu.'
            }]);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const processLLMRequest = async (chatMessages: ChatMessage[]) => {
        setIsChatLoading(true);

        try {
            const res = await fetch(`${API_BASE_URL}/criteria/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({
                    scenario: scenarioId || "Neznámá situace",
                    messages: chatMessages
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || 'Network response was not ok');
            }

            const data = await res.json();
            const responseText = data.response;

            // Update criteria panel ONLY if a separator '---' or typical header is found
            if (responseText.includes('---')) {
                const parts = responseText.split('---');
                const possibleCriteria = parts[parts.length - 1].trim();
                if (possibleCriteria.length > 30) {
                    setCriteriaMarkdown(possibleCriteria);
                }
            } else if (responseText.includes('###')) {
                const headerIdx = responseText.indexOf('###');
                setCriteriaMarkdown(responseText.slice(headerIdx).trim());
            }

            setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);

        } catch (error: any) {
            console.error('Chyba při komunikaci s LLM:', error);

            let errorMessage = `Došlo k chybě: ${error.message}.`;
            if (error.message.includes('401') || error.message.toLowerCase().includes('authentication')) {
                errorMessage = "Chyba autentizace. Zkontrolujte prosím API klíč v Administraci a nezapomeňte jej Uložit do DB.";
            }

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: errorMessage
            }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    /**
     * FUNKCE: ODESLÁNÍ ZPRÁVY ASISTENTOVI
     * Odesílá historii chatu na backend (Sokratovské dotazování).
     * Pokud AI odpověď obsahuje separátor "---", automaticky se návrh kritérií 
     * překlopí do pravého editačního panelu.
     */
    const handleSendMessage = async () => {
        if (!inputValue.trim() || isChatLoading) return;

        const newUserMsg: ChatMessage = { role: 'user', content: inputValue.trim() };
        const updatedChat = [...messages, newUserMsg];
        setMessages(updatedChat);
        setInputValue('');

        await processLLMRequest(updatedChat);
    };

    const handleProcessUploadedText = async (text: string) => {
        if (isChatLoading) return;

        const llmPrompt = `Zde je podkladový materiál z nahraného souboru:\n\n${text}\n\nPřeformátuj a strukturuj tento text do jasných a stručných hodnotících kritérií pro modelovou situaci. Vytvoř logické bloky a bodování.`;

        const newUserMsg: ChatMessage = { role: 'user', content: 'Prosím o zpracování nahraného textu do strukturovaných kritérií.' };
        // We do not want to fill the chat history with the entire raw text, so we append the prompt under the hood
        const hiddenContextMsg: ChatMessage = { role: 'user', content: llmPrompt };

        const updatedChat = [...messages, newUserMsg];
        setMessages(updatedChat);

        await processLLMRequest([...updatedChat, hiddenContextMsg]);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    };

    const handleSaveCriteria = async () => {
        if (!scenarioId) return;
        setIsSaving(true);
        setSaveSuccess(false);

        try {
            const res = await fetch(`${API_BASE_URL}/criteria/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({
                    scenario: scenarioId,
                    markdown_content: criteriaMarkdown // Save the manually edited text directly
                })
            });

            if (res.ok) {
                setSaveSuccess(true);
                if (onCriteriaSaved) onCriteriaSaved();
                fetchCriteria(); // Refresh the right column
                setTimeout(() => setSaveSuccess(false), 3000);
            }
        } catch (error) {
            console.error(error);
            showAlert("Nepodařilo se uložit kritéria.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full flex gap-6 max-w-7xl mx-auto overflow-hidden">
            {/* Left Column: Socratic AI Chat */}
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden max-w-[50%]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Wand2 className="w-5 h-5 text-[#002855]" />
                        <h3 className="font-semibold text-[#002855]">AI Asistent</h3>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-800/50/50">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200' : 'bg-[#002855]'
                                }`}>
                                {msg.role === 'user' ? <User className="w-4 h-4 text-slate-600 dark:text-slate-300" /> : <Wand2 className="w-4 h-4 text-[#D4AF37]" />}
                            </div>
                            <div className={`rounded-2xl p-3 text-sm shadow-sm whitespace-pre-wrap max-w-[85%] flex flex-col gap-2 ${msg.role === 'user'
                                ? 'bg-[#002855] text-white rounded-tr-none'
                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-tl-none'
                                }`}>
                                <div>{msg.content}</div>
                                {msg.uploadedText && (
                                    <button
                                        onClick={() => handleProcessUploadedText(msg.uploadedText!)}
                                        disabled={isChatLoading}
                                        className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#002855] bg-slate-100 hover:bg-slate-200 py-1.5 px-3 rounded-md transition-colors w-fit border border-slate-200 dark:border-slate-700 disabled:opacity-50"
                                    >
                                        <Wand2 className="w-3 h-3" />
                                        Chci tento text dodatečně nechat zpracovat AI asistentem
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {(isChatLoading || isUploading) && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#002855] flex items-center justify-center flex-shrink-0">
                                <Wand2 className="w-4 h-4 text-[#D4AF37]" />
                            </div>
                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-none p-4 text-sm text-slate-700 dark:text-slate-300 shadow-sm flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                <div className="p-4 border-t border-slate-100 bg-white dark:bg-slate-800">
                    <div className="relative flex items-center gap-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept=".docx,.rtf,.pdf"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isChatLoading || isUploading || !scenarioId}
                            className="p-3 text-slate-500 dark:text-slate-400 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 border border-transparent shadow-sm"
                            title="Nahrát metodiku (.docx, .rtf, .pdf)"
                        >
                            <Paperclip className="w-5 h-5" />
                        </button>
                        <input
                            type="text"
                            placeholder={scenarioId ? "Napište zprávu asistentovi..." : "Nejprve vyberte situaci v levém panelu..."}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isChatLoading || isUploading || !scenarioId}
                            className="flex-1 border border-slate-300 dark:border-slate-600 rounded-lg pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none disabled:bg-slate-50 dark:bg-slate-800/50 disabled:text-slate-500 dark:text-slate-400"
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={!inputValue.trim() || isChatLoading || isUploading || !scenarioId}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#002855] text-white rounded-md hover:bg-[#002855]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Right Column: Criteria Output */}
            <div className="flex-1 flex flex-col gap-4 max-w-[50%]">
                <div className="flex items-center justify-between bg-[#002855] text-white p-4 rounded-xl shadow-sm">
                    <h3 className="text-lg font-bold tracking-wide">
                        HODNOTÍCÍ KRITÉRIA: {scenarioName ? scenarioName.toUpperCase() : (scenarioId ? scenarioId.toUpperCase() : 'NEVYBRÁNO')}
                    </h3>
                    <Shield className="w-5 h-5 text-[#D4AF37]" />
                </div>

                <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden flex flex-col">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 font-medium">
                        Zde můžete manuálně upravit vygenerovaná kritéria. Změny se trvale uloží.
                    </div>
                    <textarea
                        value={criteriaMarkdown}
                        onChange={(e) => setCriteriaMarkdown(e.target.value)}
                        disabled={!scenarioId || isFetchingCriteria}
                        className={`flex-1 w-full p-4 resize-none outline-none font-sans text-sm text-slate-700 dark:text-slate-300 leading-relaxed overflow-y-auto ${(!scenarioId || isFetchingCriteria) ? 'bg-slate-50 dark:bg-slate-800/50 opacity-70 cursor-not-allowed' : ''}`}
                        placeholder={isFetchingCriteria ? "Načítám kritéria..." : "Zde pište svá kritéria..."}
                    />
                </div>

                <button
                    onClick={handleSaveCriteria}
                    disabled={isSaving || isChatLoading || isUploading || isFetchingCriteria || !scenarioId}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 text-white rounded-xl hover:opacity-90 transition-opacity text-base font-bold shadow-md ${saveSuccess ? 'bg-emerald-600' : 'bg-gradient-to-r from-[#D4AF37] to-[#C5A028]'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {isSaving ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : saveSuccess ? (
                        <CheckCircle2 className="w-5 h-5" />
                    ) : (
                        <Save className="w-5 h-5" />
                    )}

                    {isSaving ? 'Ukládám...' : saveSuccess ? 'Kritéria uložena!' : '✨ Uložit chat jako finální kritéria do DB'}
                </button>
            </div>
        </div>
    );
}

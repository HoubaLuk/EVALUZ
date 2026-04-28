import React, { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../utils/api';
import {
  faWandMagicSparkles, faCloudArrowUp, faUser,
  faCircleCheck, faChevronRight, faShield, faFloppyDisk,
  faSpinner, faPaperclip, faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
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

export function TabCriteria({ scenarioId, scenarioName, onCriteriaSaved }: TabCriteriaProps) {
  const { showAlert } = useDialog();
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'assistant',
    content: 'Dobrý den, jsem váš AI asistent pro tvorbu hodnotících kritérií. Vložte prosím název modelové situace a svá heslovitá kritéria. Budu se vás následně doptávat na detaily.',
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [criteriaMarkdown, setCriteriaMarkdown] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingCriteria, setIsFetchingCriteria] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: 'Dobrý den, jsem váš AI asistent pro tvorbu hodnotících kritérií. Vložte prosím název modelové situace a svá heslovitá kritéria. Budu se vás následně doptávat na detaily.',
    }]);
    if (!scenarioId) { setCriteriaMarkdown('Vyberte prosím situaci v levém panelu.'); return; }
    fetchCriteria();
  }, [scenarioId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatLoading]);

  const fetchCriteria = async () => {
    if (!scenarioId) return;
    setIsFetchingCriteria(true);
    setCriteriaMarkdown('Načítám kritéria...');
    try {
      const res = await fetch(`${API_BASE_URL}/criteria/${scenarioId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
      });
      if (res.ok) { const data = await res.json(); setCriteriaMarkdown(data.markdown_content); }
      else setCriteriaMarkdown('');
    } catch (error) { setCriteriaMarkdown(''); }
    finally { setIsFetchingCriteria(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setMessages(prev => [...prev, { role: 'user', content: `Posílám soubor metodiky ke studiu: ${file.name}` }]);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE_URL}/criteria/extract-context`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to extract file context');
      const data = await res.json();
      setCriteriaMarkdown(data.text);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Soubor byl úspěšně nahrán. Text jsem vložil přímo do pole s kritérii k vaší revizi.', uploadedText: data.text }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Nepodařilo se zpracovat nahraný soubor. Zkuste to prosím znovu.' }]);
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
        body: JSON.stringify({ scenario: scenarioId || 'Neznámá situace', messages: chatMessages }),
      });
      if (!res.ok) { const errorData = await res.json(); throw new Error(errorData.detail || 'Network response was not ok'); }
      const data = await res.json();
      const responseText = data.response;
      if (responseText.includes('---')) {
        const parts = responseText.split('---');
        const possibleCriteria = parts[parts.length - 1].trim();
        if (possibleCriteria.length > 30) setCriteriaMarkdown(possibleCriteria);
      } else if (responseText.includes('###')) {
        const headerIdx = responseText.indexOf('###');
        setCriteriaMarkdown(responseText.slice(headerIdx).trim());
      }
      setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
    } catch (error: any) {
      let errorMessage = `Došlo k chybě: ${error.message}.`;
      if (error.message.includes('401') || error.message.toLowerCase().includes('authentication')) {
        errorMessage = 'Chyba autentizace. Zkontrolujte API klíč v Administraci.';
      }
      setMessages(prev => [...prev, { role: 'assistant', content: errorMessage }]);
    } finally { setIsChatLoading(false); }
  };

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
    const llmPrompt = `Zde je podkladový materiál z nahraného souboru:\n\n${text}\n\nPřeformátuj a strukturuj tento text do jasných a stručných hodnotících kritérií.`;
    const newUserMsg: ChatMessage = { role: 'user', content: 'Prosím o zpracování nahraného textu do strukturovaných kritérií.' };
    const hiddenContextMsg: ChatMessage = { role: 'user', content: llmPrompt };
    const updatedChat = [...messages, newUserMsg];
    setMessages(updatedChat);
    await processLLMRequest([...updatedChat, hiddenContextMsg]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSendMessage();
  };

  const handleSaveCriteria = async () => {
    if (!scenarioId) return;
    setIsSaving(true); setSaveSuccess(false); setSaveError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/criteria/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
        body: JSON.stringify({ scenario: scenarioId, markdown_content: criteriaMarkdown }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        if (onCriteriaSaved) onCriteriaSaved();
        fetchCriteria();
      } else {
        const errorData = await res.json();
        setSaveError(errorData.detail || 'Nepodařilo se uložit kritéria.');
      }
    } catch (error: any) {
      setSaveError(error.message || 'Chyba při komunikaci se serverem.');
    } finally { setIsSaving(false); }
  };

  return (
    <div style={{ height: '100%', display: 'flex', gap: 16, overflow: 'hidden' }}>
      {/* Levý panel: AI Chat */}
      <div className="card" style={{ flex: 1, maxWidth: '50%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="card__header card__header--primary" style={{ gap: 8 }}>
          <Icon icon={faWandMagicSparkles} />
          <span>AI Asistent — tvorba kritérií</span>
        </div>

        {/* Zprávy chatu */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-surface-2)' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'user' ? 'var(--bg-surface)' : 'var(--color-primary)',
                color: msg.role === 'user' ? 'var(--text-secondary)' : '#fff',
                border: msg.role === 'user' ? '1px solid var(--border-color)' : 'none',
              }}>
                <Icon icon={msg.role === 'user' ? faUser : faWandMagicSparkles} size="xs" />
              </div>
              <div style={{
                background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--bg-surface)',
                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                border: msg.role === 'user' ? 'none' : '1px solid var(--border-color)',
                borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                padding: '8px 12px', fontSize: '0.85rem', maxWidth: '85%',
                whiteSpace: 'pre-wrap', lineHeight: 1.5,
              }}>
                {msg.content}
                {msg.uploadedText && (
                  <button
                    className="btn btn--outline btn--sm"
                    style={{ marginTop: 8, display: 'flex' }}
                    onClick={() => handleProcessUploadedText(msg.uploadedText!)}
                    disabled={isChatLoading}
                  >
                    <Icon icon={faWandMagicSparkles} size="xs" />
                    Zpracovat text AI asistentem
                  </button>
                )}
              </div>
            </div>
          ))}
          {(isChatLoading || isUploading) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon icon={faWandMagicSparkles} size="xs" style={{ color: '#fff' }} />
              </div>
              <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 150, 300].map(delay => (
                  <div key={delay} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)', animation: `ncikt-pulse 1.2s ease-in-out ${delay}ms infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Vstup */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-surface)' }}>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".docx,.rtf,.pdf" style={{ display: 'none' }} />
          <button
            className="btn btn--outline btn--sm btn--icon-only"
            onClick={() => fileInputRef.current?.click()}
            disabled={isChatLoading || isUploading || !scenarioId}
            title="Nahrát metodiku (.docx, .rtf, .pdf)"
          >
            <Icon icon={faPaperclip} />
          </button>
          <input
            type="text"
            className="form-control"
            placeholder={scenarioId ? 'Napište zprávu asistentovi...' : 'Nejprve vyberte situaci...'}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isChatLoading || isUploading || !scenarioId}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn--primary btn--icon-only"
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isChatLoading || isUploading || !scenarioId}
            title="Odeslat"
          >
            <Icon icon={faChevronRight} />
          </button>
        </div>
      </div>

      {/* Pravý panel: Kritéria */}
      <div style={{ flex: 1, maxWidth: '50%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card__header card__header--primary" style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            HODNOTÍCÍ KRITÉRIA: {scenarioName ? scenarioName.toUpperCase() : (scenarioId ? scenarioId.toUpperCase() : 'NEVYBRÁNO')}
          </span>
          <Icon icon={faShield} />
        </div>

        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '6px 12px', background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Zde můžete manuálně upravit vygenerovaná kritéria. Změny se trvale uloží.
          </div>
          <textarea
            value={criteriaMarkdown}
            onChange={e => { setCriteriaMarkdown(e.target.value); setSaveSuccess(false); setSaveError(null); }}
            disabled={!scenarioId || isFetchingCriteria}
            className="form-control"
            style={{ flex: 1, resize: 'none', border: 'none', borderRadius: 0, padding: 16, fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.6, overflowY: 'auto' }}
            placeholder={isFetchingCriteria ? 'Načítám kritéria...' : 'Zde pište svá kritéria...'}
          />
        </div>

        {/* NCIKT pořadí: Negativní → Pozitivní */}
        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
          <button
            className={`btn btn--lg${saveError ? ' btn--negative' : saveSuccess ? ' btn--positive' : ' btn--positive'}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={handleSaveCriteria}
            disabled={isSaving || isChatLoading || isUploading || isFetchingCriteria || !scenarioId}
          >
            {isSaving
              ? <><span className="spinner spinner--sm spinner--white" /> Ukládám...</>
              : saveError
                ? <><Icon icon={faCircleExclamation} /> Chyba při ukládání</>
                : saveSuccess
                  ? <><Icon icon={faCircleCheck} /> Kritéria uložena!</>
                  : <><Icon icon={faFloppyDisk} /> Uložit hodnotící kritéria</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

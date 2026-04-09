import React, { createContext, useContext, useState, ReactNode } from 'react';

type DialogType = 'alert' | 'confirm' | 'prompt';

interface DialogOptions {
    type: DialogType;
    title?: string;
    message: string;
    defaultValue?: string; // For prompt
    resolve: (value: any) => void;
}

interface DialogContextProps {
    showAlert: (message: string, title?: string) => Promise<void>;
    showConfirm: (message: string, title?: string) => Promise<boolean>;
    showPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextProps | undefined>(undefined);

export const useDialog = () => {
    const context = useContext(DialogContext);
    if (!context) {
        throw new Error('useDialog must be used within a DialogProvider');
    }
    return context;
};

export const DialogProvider = ({ children }: { children: ReactNode }) => {
    const [dialogs, setDialogs] = useState<DialogOptions[]>([]);

    const showAlert = (message: string, title: string = "EVALUZ hlásí") => {
        return new Promise<void>((resolve) => {
            setDialogs(prev => [...prev, { type: 'alert', title, message, resolve }]);
        });
    };

    const showConfirm = (message: string, title: string = "EVALUZ hlásí") => {
        return new Promise<boolean>((resolve) => {
            setDialogs(prev => [...prev, { type: 'confirm', title, message, resolve }]);
        });
    };

    const showPrompt = (message: string, defaultValue: string = "", title: string = "EVALUZ hlásí") => {
        return new Promise<string | null>((resolve) => {
            setDialogs(prev => [...prev, { type: 'prompt', title, message, defaultValue, resolve }]);
        });
    };

    const handleClose = (value: any) => {
        setDialogs(prev => {
            const newDialogs = [...prev];
            const active = newDialogs.shift();
            if (active) active.resolve(value);
            return newDialogs;
        });
    };

    return (
        <DialogContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
            {children}
            {dialogs.length > 0 && (
                <DialogModal dialog={dialogs[0]} onClose={handleClose} />
            )}
        </DialogContext.Provider>
    );
};

function DialogModal({ dialog, onClose }: { dialog: DialogOptions; onClose: (val: any) => void }) {
    const [inputValue, setInputValue] = useState(dialog.defaultValue || '');

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', padding: 16
        }}>
            <div className="card" style={{
                width: '100%', maxWidth: 440, borderRadius: 12,
                boxShadow: 'var(--shadow-lg)', overflow: 'hidden'
            }}>
                {/* Záhlaví — primární barva dle NCIKT */}
                <div style={{
                    background: 'var(--color-primary)',
                    padding: '14px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                    <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                        {dialog.title}
                    </h3>
                </div>

                {/* Tělo */}
                <div style={{ padding: '20px 24px' }}>
                    <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>
                        {dialog.message}
                    </p>

                    {dialog.type === 'prompt' && (
                        <input
                            autoFocus
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            className="form-control"
                            style={{ marginTop: 12 }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') onClose(inputValue);
                                if (e.key === 'Escape') onClose(null);
                            }}
                        />
                    )}
                </div>

                {/* Zápatí s tlačítky — dle NCIKT pořadí: Negativní → Pozitivní */}
                <div style={{
                    padding: '12px 24px 16px',
                    display: 'flex', justifyContent: 'flex-end', gap: 8,
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-surface-2)'
                }}>
                    {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                        <button
                            className="btn btn--light btn--sm"
                            onClick={() => onClose(dialog.type === 'prompt' ? null : false)}
                        >
                            Zrušit
                        </button>
                    )}
                    <button
                        className={`btn btn--sm ${dialog.type === 'confirm' ? 'btn--positive' : 'btn--primary'}`}
                        onClick={() => onClose(dialog.type === 'prompt' ? inputValue : true)}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};

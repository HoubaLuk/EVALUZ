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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="bg-[#002855] px-6 py-4 flex items-center justify-between">
                    <h3 className="text-white font-semibold text-lg">{dialog.title}</h3>
                </div>

                <div className="p-6">
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{dialog.message}</p>

                    {dialog.type === 'prompt' && (
                        <input
                            autoFocus
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            className="mt-4 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#002855] focus:border-transparent"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') onClose(inputValue);
                                if (e.key === 'Escape') onClose(null);
                            }}
                        />
                    )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                    {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                        <button
                            onClick={() => onClose(dialog.type === 'prompt' ? null : false)}
                            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:bg-slate-800/50 transition-colors"
                        >
                            Zrušit
                        </button>
                    )}

                    <button
                        onClick={() => onClose(dialog.type === 'prompt' ? inputValue : true)}
                        className="px-4 py-2 text-sm font-medium text-white bg-[#002855] rounded-md hover:bg-[#001f44] transition-colors"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};

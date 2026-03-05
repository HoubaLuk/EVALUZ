import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import { Folder, ChevronDown, MoreVertical, FileText, Edit2, Trash2, Copy, ChevronLeft, ChevronRight, HardDrive, Loader2, HelpCircle, CheckCircle2, XCircle } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { ClassData } from '../types';
import { useDialog } from '../contexts/DialogContext';

export interface SidebarProps {
    classes: ClassData[];
    setClasses: React.Dispatch<React.SetStateAction<ClassData[]>>;
    activeClassId: string | null;
    activeScenarioId: string | null;
    onSelectScenario: (classId: string, scenarioId: string) => void;
}

export type EditMode =
    | null
    | { type: 'new_class' }
    | { type: 'new_scenario', classId: string }
    | { type: 'rename_class', classId: string, currentName: string }
    | { type: 'rename_scenario', classId: string, scenId: string, currentName: string };

export function Sidebar({ classes, setClasses, activeClassId, activeScenarioId, onSelectScenario }: SidebarProps) {
    const { showConfirm, showAlert } = useDialog();

    const [editMode, setEditMode] = React.useState<EditMode>(null);
    const [editValue, setEditValue] = React.useState('');
    const [isCollapsed, setIsCollapsed] = React.useState(() => {
        const saved = localStorage.getItem('upvsp_sidebar_collapsed');
        return saved ? JSON.parse(saved) : false;
    });
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncInfo, setLastSyncInfo] = useState<{ name: string; date: string } | null>(() => {
        const saved = localStorage.getItem('evaluz_last_sync');
        return saved ? JSON.parse(saved) : null;
    });
    const [showSyncHelp, setShowSyncHelp] = useState(false);
    const [syncDirHandle, setSyncDirHandle] = useState<any>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const saveClasses = React.useCallback((newClasses: ClassData[]) => {
        setClasses(newClasses);
        localStorage.setItem('upvsp_classes', JSON.stringify(newClasses));
    }, [setClasses]);

    const handleSaveEdit = React.useCallback(() => {
        if (!editMode) return;
        const val = editValue.trim();
        if (editMode.type === 'new_class' && val) {
            const newClass: ClassData = {
                id: `class-${Date.now()}`,
                name: val,
                expanded: true,
                scenarios: []
            };
            saveClasses([...classes, newClass]);
        } else if (editMode.type === 'new_scenario' && val) {
            const newClasses = classes.map(c => c.id === editMode.classId ? {
                ...c,
                expanded: true,
                scenarios: [...c.scenarios, { id: `scen-${Date.now()}`, name: val }]
            } : c);
            saveClasses(newClasses);
        } else if (editMode.type === 'rename_class' && val && val !== editMode.currentName) {
            saveClasses(classes.map(c => c.id === editMode.classId ? { ...c, name: val } : c));
        } else if (editMode.type === 'rename_scenario' && val && val !== editMode.currentName) {
            saveClasses(classes.map(c => c.id === editMode.classId ? {
                ...c,
                scenarios: c.scenarios.map(s => s.id === editMode.scenId ? { ...s, name: val } : s)
            } : c));
        }
        setEditMode(null);
        setEditValue('');
    }, [editMode, editValue, classes, saveClasses]);

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditMode(null);
            setEditValue('');
        }
    };

    const startEdit = (e: React.MouseEvent | undefined, mode: EditMode, initialValue: string = '') => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setEditMode(mode);
        setEditValue(initialValue);
    };

    const toggleClassExpansion = React.useCallback((classId: string, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const newClasses = classes.map(c =>
            c.id === classId ? { ...c, expanded: !c.expanded } : c
        );
        saveClasses(newClasses);
    }, [classes, saveClasses]);

    const deleteClass = React.useCallback(async (id: string, name: string) => {
        const conf = await showConfirm(`Opravdu chcete smazat třídu "${name}" i se všemi modelovými situacemi?`);
        if (conf) {
            saveClasses(classes.filter(c => c.id !== id));
            if (activeClassId === id) {
                onSelectScenario('', '');
            }
        }
    }, [classes, saveClasses, showConfirm, activeClassId, onSelectScenario]);

    const duplicateScenario = React.useCallback((classId: string, scenId: string) => {
        saveClasses(classes.map(c => {
            if (c.id === classId) {
                const target = c.scenarios.find(s => s.id === scenId);
                if (target) {
                    const newScenarios = [...c.scenarios];
                    const index = newScenarios.indexOf(target);
                    newScenarios.splice(index + 1, 0, { id: `scen-${Date.now()}`, name: `${target.name} (Kopie)` });
                    return { ...c, expanded: true, scenarios: newScenarios };
                }
            }
            return c;
        }));
    }, [classes, saveClasses]);

    const deleteScenario = React.useCallback(async (classId: string, scenId: string, name: string) => {
        const conf = await showConfirm(`Opravdu chcete smazat modelovou situaci "${name}"?`);
        if (conf) {
            saveClasses(classes.map(c => c.id === classId ? {
                ...c,
                scenarios: c.scenarios.filter(s => s.id !== scenId)
            } : c));
            if (activeScenarioId === scenId) {
                onSelectScenario(classId, '');
            }
        }
    }, [classes, saveClasses, showConfirm, activeScenarioId, onSelectScenario]);

    const performSync = async (dirHandle: any) => {
        try {
            setIsSyncing(true);
            let currentClasses = JSON.parse(JSON.stringify(classes)) as ClassData[];
            let totalFiles = 0;
            let newClassesCount = 0;
            let newScenariosCount = 0;

            for await (const [className, classHandle] of (dirHandle as any).entries()) {
                if ((classHandle as any).kind !== 'directory') continue;

                let cls = currentClasses.find(c => c.name === className);
                if (!cls) {
                    cls = { id: `class-${Date.now()}-${Math.random()}`, name: className, expanded: true, scenarios: [] };
                    currentClasses.push(cls);
                    newClassesCount++;
                } else {
                    cls.expanded = true;
                }

                for await (const [scenName, scenHandle] of (classHandle as any).entries()) {
                    if ((scenHandle as any).kind !== 'directory') continue;

                    let scen = cls.scenarios.find(s => s.name === scenName);
                    if (!scen) {
                        scen = { id: `scen-${Date.now()}-${Math.random()}`, name: scenName };
                        cls.scenarios.push(scen);
                        newScenariosCount++;
                    }

                    const validFiles: File[] = [];
                    for await (const [fileName, fileHandle] of (scenHandle as any).entries()) {
                        if ((fileHandle as any).kind === 'file') {
                            const file = await (fileHandle as any).getFile();
                            const ext = file.name.split('.').pop()?.toLowerCase();
                            if (ext && ['pdf', 'doc', 'docx', 'rtf', 'odt'].includes(ext) && !fileName.startsWith('~') && !fileName.startsWith('.')) {
                                validFiles.push(file);
                            }
                        }
                    }

                    if (validFiles.length > 0) {
                        totalFiles += validFiles.length;
                        const formData = new FormData();
                        validFiles.forEach(f => formData.append('files', f));
                        formData.append('scenario_id', scen.id);

                        await fetch(`${API_BASE_URL}/evaluate/fast-scan`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                            body: formData
                        });
                    }
                }
            }

            saveClasses(currentClasses);
            const msg = totalFiles > 0
                ? `Sync dokončen! ${newClassesCount > 0 ? newClassesCount + ' nových tříd, ' : ''}${newScenariosCount > 0 ? newScenariosCount + ' nových situací, ' : ''}${totalFiles} souborů nahráno.`
                : newClassesCount > 0 || newScenariosCount > 0
                    ? `Struktura synchronizována (${newClassesCount} tříd, ${newScenariosCount} situací). Žádné dokumenty k nahrání.`
                    : 'Žádné nové položky nalezeny. Zkontrolujte strukturu složek (viz nápověda ❓).';

            setLastSyncInfo({
                name: dirHandle.name,
                date: new Date().toLocaleString('cs-CZ')
            });
            localStorage.setItem('evaluz_last_sync', JSON.stringify({
                name: dirHandle.name,
                date: new Date().toLocaleString('cs-CZ')
            }));

            setToast({ message: msg, type: totalFiles > 0 || newClassesCount > 0 || newScenariosCount > 0 ? 'success' : 'error' });

            if (totalFiles > 0) {
                window.dispatchEvent(new CustomEvent('evaluz-sync-complete'));
            }

            setTimeout(() => setToast(null), 8000);
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('HDD Sync Error:', e);
                setToast({ message: 'Nastala chyba při synchronizaci. Zkontrolujte strukturu složek.', type: 'error' });
                setTimeout(() => setToast(null), 6000);
            }
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSelectAndSync = async () => {
        try {
            const dirHandle = await (window as any).showDirectoryPicker();
            setSyncDirHandle(dirHandle);
            await performSync(dirHandle);
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('Directory Picker Error:', e);
        }
    };

    const handleDirectSync = async () => {
        if (syncDirHandle) {
            await performSync(syncDirHandle);
        } else {
            await handleSelectAndSync();
        }
    };

    return (
        <aside className={`bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col shadow-sm z-10 transition-all duration-300 relative ${isCollapsed ? 'w-[68px]' : 'w-72'}`}>
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -right-3 top-4 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full p-1 text-slate-400 dark:text-slate-300 hover:text-[#002855] dark:hover:text-blue-300 hover:border-[#002855] dark:hover:border-blue-400 transition-colors z-20 shadow-sm"
            >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <div className={`p-4 border-b border-slate-100 dark:border-slate-700 flex flex-col gap-2 ${isCollapsed ? 'items-center' : ''}`}>
                {!isCollapsed && <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Pracovní prostor</h2>}

                {!isCollapsed ? (
                    <>
                        <div className="flex gap-1.5">
                            <button
                                onClick={handleDirectSync}
                                disabled={isSyncing}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 border text-sm font-semibold whitespace-nowrap shadow-sm transition-colors rounded-lg disabled:opacity-50 relative group ${syncDirHandle
                                        ? 'bg-[#002855] text-white border-[#002855] hover:bg-[#003a7a]'
                                        : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                    }`}
                                title={syncDirHandle ? `Synchronizovat složku: ${syncDirHandle.name}` : 'Klikněte pro výběr složky a synchronizaci'}
                            >
                                {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
                                {isSyncing ? 'Synchronizuji...' : 'Sync ÚZ v PC'}
                                {syncDirHandle && !isSyncing && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white dark:border-slate-800 rounded-full shadow-sm" />
                                )}
                            </button>
                            <button
                                onClick={handleSelectAndSync}
                                className={`p-2 border rounded-lg transition-colors ${syncDirHandle
                                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-100'
                                        : 'text-slate-400 hover:text-[#002855] dark:hover:text-blue-300 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                                    }`}
                                title="Změnit cílovou složku pro synchronizaci"
                            >
                                <Folder className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setShowSyncHelp(!showSyncHelp)}
                                className="p-2 text-slate-400 hover:text-[#002855] dark:hover:text-blue-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                title="Nápověda ke struktuře složek"
                            >
                                <HelpCircle className="w-4 h-4" />
                            </button>
                        </div>
                        {showSyncHelp && (
                            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                <p className="font-bold text-[#002855] dark:text-blue-300 mb-1">📁 Požadovaná struktura složek:</p>
                                <code className="block bg-white dark:bg-slate-800 p-2 rounded text-[11px] font-mono mb-2">
                                    Kořenová složka/<br />
                                    &nbsp;&nbsp;├── ZOP 02-2026/<br />
                                    &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;├── MS1 - Téma/<br />
                                    &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;├── student1.docx<br />
                                    &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;└── student2.pdf<br />
                                    &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;└── MS2 - Téma/<br />
                                    &nbsp;&nbsp;└── ZOP 03-2026/<br />
                                </code>
                                <p className="text-slate-500 dark:text-slate-400 mb-1">Podporované formáty: <strong>.docx, .doc, .pdf, .rtf</strong></p>
                                <p className="text-red-500 dark:text-red-400 font-semibold">⚠ Nenazývejte složky s lomítkem „/" (např. ZOP 02/2026). Na macOS jsou pro prohlížeč neviditelné! Použijte pomlčku: ZOP 02-2026</p>
                            </div>
                        )}
                    </>
                ) : (
                    <button
                        onClick={() => setIsCollapsed(false)}
                        className="w-full flex items-center justify-center p-2 text-slate-500 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Sync ÚZ v PC"
                    >
                        <HardDrive className="w-5 h-5" />
                    </button>
                )}
            </div>

            <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                {!isCollapsed ? (
                    editMode?.type === 'new_class' ? (
                        <input
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            onBlur={handleSaveEdit}
                            placeholder="Název třídy (Enter pro uložení)"
                            className="w-full px-3 py-1.5 border border-[#002855]/30 rounded-md text-sm outline-none focus:border-[#002855] focus:ring-1 focus:ring-[#002855]"
                        />
                    ) : (
                        <button
                            onClick={(e) => startEdit(e, { type: 'new_class' })}
                            className="w-full flex items-center justify-center gap-2 py-2 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold whitespace-nowrap"
                        >
                            <Folder className="w-4 h-4" />
                            + Nová třída
                        </button>
                    )
                ) : (
                    <button
                        onClick={() => setIsCollapsed(false)}
                        className="w-full flex items-center justify-center p-2 text-[#002855] border-2 border-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors"
                        title="Přidat třídu"
                    >
                        <Folder className="w-5 h-5" />
                    </button>
                )}
            </div>
            <div className="p-4 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="space-y-4">
                    {classes.map(cls => (
                        <div key={cls.id} className="space-y-1">
                            {/* Class Folder */}
                            <div
                                className={`relative group/class flex items-center px-2 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors ${isCollapsed ? 'justify-center' : 'justify-between'}`}
                                title={isCollapsed ? cls.name : undefined}
                            >
                                <div
                                    className={`flex items-center gap-2 cursor-pointer ${isCollapsed ? '' : 'flex-1'}`}
                                    onClick={(e) => {
                                        if (isCollapsed) {
                                            setIsCollapsed(false);
                                            // Automatically expand this class when opening sidebar via folder click
                                            if (!cls.expanded) toggleClassExpansion(cls.id, e);
                                        } else {
                                            toggleClassExpansion(cls.id, e);
                                        }
                                    }}
                                >
                                    {!isCollapsed && <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${cls.expanded ? '' : '-rotate-90'}`} />}
                                    <Folder className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                                    {!isCollapsed && (editMode?.type === 'rename_class' && editMode.classId === cls.id ? (
                                        <input
                                            autoFocus
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            onKeyDown={handleInputKeyDown}
                                            onBlur={handleSaveEdit}
                                            onClick={e => e.stopPropagation()}
                                            className="font-medium text-sm bg-transparent border-b border-[#002855] outline-none flex-1 max-w-[140px]"
                                        />
                                    ) : (
                                        <span className="font-medium text-sm truncate max-w-[160px]">{cls.name}</span>
                                    ))}
                                </div>
                                {!isCollapsed && (
                                    <div className="relative">
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger asChild>
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    className="opacity-0 group-hover/class:opacity-100 p-1 text-slate-400 hover:text-[#002855] transition-all rounded-md hover:bg-slate-200 focus:opacity-100 outline-none data-[state=open]:opacity-100 data-[state=open]:bg-slate-200"
                                                    title="Možnosti třídy"
                                                >
                                                    <MoreVertical className="w-3.5 h-3.5" />
                                                </button>
                                            </DropdownMenu.Trigger>

                                            <DropdownMenu.Portal>
                                                <DropdownMenu.Content
                                                    onCloseAutoFocus={(e) => e.preventDefault()}
                                                    className="w-44 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50 animate-in fade-in-80 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
                                                    sideOffset={5}
                                                    align="end"
                                                >
                                                    <DropdownMenu.Item
                                                        onSelect={(e) => startEdit(undefined, { type: 'rename_class', classId: cls.id, currentName: cls.name }, cls.name)}
                                                        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer outline-none data-[highlighted]:bg-slate-50"
                                                    >
                                                        <Edit2 className="w-4 h-4 text-slate-400" /> Přejmenovat
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Separator className="h-px bg-slate-100 my-1" />
                                                    <DropdownMenu.Item
                                                        onSelect={() => deleteClass(cls.id, cls.name)}
                                                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium cursor-pointer outline-none data-[highlighted]:bg-red-50"
                                                    >
                                                        <Trash2 className="w-4 h-4 text-red-500" /> Smazat třídu
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Portal>
                                        </DropdownMenu.Root>
                                    </div>
                                )}
                            </div>

                            {/* Scenarios */}
                            {!isCollapsed && cls.expanded && (
                                <div className="pl-6 space-y-1">
                                    {cls.scenarios.map(scen => {
                                        const isSelected = scen.id === activeScenarioId;

                                        return (
                                            <div
                                                key={scen.id}
                                                onClick={() => onSelectScenario(cls.id, scen.id)}
                                                className={`relative group/scen flex items-center justify-between px-2 py-1.5 rounded-md transition-colors cursor-pointer ${isSelected
                                                    ? 'bg-[#002855]/5 text-[#002855] border-l-2 border-[#002855]'
                                                    : 'text-slate-600 hover:bg-slate-50'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2 pl-1 flex-1">
                                                    <FileText className={`w-4 h-4 ${isSelected ? 'text-[#002855]' : 'text-slate-400'}`} />
                                                    {editMode?.type === 'rename_scenario' && editMode.scenId === scen.id ? (
                                                        <input
                                                            autoFocus
                                                            value={editValue}
                                                            onChange={e => setEditValue(e.target.value)}
                                                            onKeyDown={handleInputKeyDown}
                                                            onBlur={handleSaveEdit}
                                                            onClick={e => e.stopPropagation()}
                                                            className="font-medium text-sm bg-transparent border-b border-[#002855] outline-none flex-1 max-w-[140px]"
                                                        />
                                                    ) : (
                                                        <span className={`text-sm ${isSelected ? 'font-semibold' : ''}`}>{scen.name}</span>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <DropdownMenu.Root>
                                                        <DropdownMenu.Trigger asChild>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                }}
                                                                className={`opacity-0 group-hover/scen:opacity-100 p-1 transition-all rounded-md focus:opacity-100 outline-none data-[state=open]:opacity-100 data-[state=open]:bg-slate-200 ${isSelected
                                                                    ? 'text-[#002855]/60 hover:text-[#002855] hover:bg-[#002855]/10 data-[state=open]:bg-[#002855]/10'
                                                                    : 'text-slate-400 hover:text-[#002855] hover:bg-slate-200'
                                                                    }`}
                                                            >
                                                                <MoreVertical className="w-3.5 h-3.5" />
                                                            </button>
                                                        </DropdownMenu.Trigger>

                                                        <DropdownMenu.Portal>
                                                            <DropdownMenu.Content
                                                                onCloseAutoFocus={(e) => e.preventDefault()}
                                                                className="w-44 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-50 animate-in fade-in-80 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
                                                                sideOffset={5}
                                                                align="end"
                                                            >
                                                                <DropdownMenu.Item
                                                                    onSelect={(e) => startEdit(undefined, { type: 'rename_scenario', classId: cls.id, scenId: scen.id, currentName: scen.name }, scen.name)}
                                                                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer outline-none data-[highlighted]:bg-slate-50"
                                                                >
                                                                    <Edit2 className="w-4 h-4 text-slate-400" /> Přejmenovat
                                                                </DropdownMenu.Item>
                                                                <DropdownMenu.Item
                                                                    onSelect={() => duplicateScenario(cls.id, scen.id)}
                                                                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer outline-none data-[highlighted]:bg-slate-50"
                                                                >
                                                                    <Copy className="w-4 h-4 text-slate-400" /> Duplikovat
                                                                </DropdownMenu.Item>
                                                                <DropdownMenu.Separator className="h-px bg-slate-100 my-1" />
                                                                <DropdownMenu.Item
                                                                    onSelect={() => deleteScenario(cls.id, scen.id, scen.name)}
                                                                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium cursor-pointer outline-none data-[highlighted]:bg-red-50"
                                                                >
                                                                    <Trash2 className="w-4 h-4 text-red-500" /> Smazat
                                                                </DropdownMenu.Item>
                                                            </DropdownMenu.Content>
                                                        </DropdownMenu.Portal>
                                                    </DropdownMenu.Root>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Add Scenario Button */}
                                    <div className="pt-1 pl-1">
                                        {editMode?.type === 'new_scenario' && editMode.classId === cls.id ? (
                                            <input
                                                autoFocus
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onKeyDown={handleInputKeyDown}
                                                onBlur={handleSaveEdit}
                                                placeholder="Název (MS/OOP: Téma)"
                                                className="w-full px-2 py-1.5 border border-[#002855]/30 rounded-md text-sm outline-none focus:border-[#002855] focus:ring-1 focus:ring-[#002855] mt-1"
                                            />
                                        ) : (
                                            <button
                                                onClick={(e) => startEdit(e, { type: 'new_scenario', classId: cls.id })}
                                                className="flex items-center gap-2 px-2 py-1.5 w-full text-left text-slate-400 hover:text-[#D4AF37] hover:bg-slate-50 rounded-md transition-colors text-sm font-medium cursor-pointer"
                                            >
                                                <FileText className="w-4 h-4 opacity-50" />
                                                + Nová modelová situace
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <div className={`absolute bottom-4 left-4 right-4 p-3 rounded-lg shadow-lg border flex items-start gap-2 text-sm animate-in slide-in-from-bottom-4 z-50 ${toast.type === 'success'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                    }`}>
                    {toast.type === 'success'
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                        : <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    }
                    <span className="flex-1">{toast.message}</span>
                    <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600">
                        <XCircle className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
        </aside>
    );
}

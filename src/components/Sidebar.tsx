import React, { useState, useEffect } from 'react';
import { Folder, ChevronDown, MoreVertical, FileText, Edit2, Trash2, Copy } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { ClassData } from '../types';

interface SidebarProps {
    classes: ClassData[];
    setClasses: React.Dispatch<React.SetStateAction<ClassData[]>>;
    activeClassId: string | null;
    activeScenarioId: string | null;
    onSelectScenario: (classId: string, scenarioId: string) => void;
}

type EditMode =
    | null
    | { type: 'new_class' }
    | { type: 'new_scenario', classId: string }
    | { type: 'rename_class', classId: string, currentName: string }
    | { type: 'rename_scenario', classId: string, scenId: string, currentName: string };

export function Sidebar({ classes, setClasses, activeClassId, activeScenarioId, onSelectScenario }: SidebarProps) {
    React.useEffect(() => {
        console.log("SIDEBAR MOUNTED");
        return () => console.log("SIDEBAR UNMOUNTED");
    }, []);

    const [editMode, setEditMode] = React.useState<EditMode>(null);
    const [editValue, setEditValue] = React.useState('');

    const saveClasses = React.useCallback((newClasses: ClassData[]) => {
        setClasses(newClasses);
        localStorage.setItem('upvsp_classes', JSON.stringify(newClasses));
    }, []);

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

    const deleteClass = React.useCallback((id: string, name: string) => {
        console.log("Otevírám dialog pro: Smazat třídu", name);
        if (window.confirm(`Opravdu chcete smazat třídu "${name}" i se všemi modelovými situacemi?`)) {
            saveClasses(classes.filter(c => c.id !== id));
        }
    }, [classes, saveClasses]);

    const duplicateScenario = React.useCallback((classId: string, scenId: string) => {
        console.log("Provádím akci: Duplikovat situaci ID:", scenId);
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

    const deleteScenario = React.useCallback((classId: string, scenId: string, name: string) => {
        console.log("Otevírám dialog pro: Smazat situaci", name);
        if (window.confirm(`Opravdu chcete smazat modelovou situaci "${name}"?`)) {
            saveClasses(classes.map(c => c.id === classId ? {
                ...c,
                scenarios: c.scenarios.filter(s => s.id !== scenId)
            } : c));
        }
    }, [classes, saveClasses]);

    return (
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-0">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pracovní prostor</h2>
            </div>
            <div className="p-4 border-b border-slate-100">
                {editMode?.type === 'new_class' ? (
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
                        className="w-full flex items-center justify-center gap-2 py-2 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold"
                    >
                        <Folder className="w-4 h-4" />
                        + Nová třída
                    </button>
                )}
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
                <div className="space-y-4">
                    {classes.map(cls => (
                        <div key={cls.id} className="space-y-1">
                            {/* Class Folder */}
                            <div className="relative group/class flex items-center justify-between px-2 py-1.5 text-slate-700 hover:bg-slate-50 rounded-md transition-colors">
                                <div
                                    className="flex items-center gap-2 cursor-pointer flex-1"
                                    onClick={(e) => toggleClassExpansion(cls.id, e)}
                                >
                                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${cls.expanded ? '' : '-rotate-90'}`} />
                                    <Folder className="w-4 h-4 text-[#D4AF37]" />
                                    {editMode?.type === 'rename_class' && editMode.classId === cls.id ? (
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
                                        <span className="font-medium text-sm">{cls.name}</span>
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
                            </div>

                            {/* Scenarios */}
                            {cls.expanded && (
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
        </aside>
    );
}

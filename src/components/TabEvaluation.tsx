import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Wand2, CheckCircle2, AlertCircle, User, MessageSquareQuote, Download, Shield, X, XCircle, Loader2, MoreVertical, Trash2, Save, Pencil, GraduationCap, UserCheck, Hourglass } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Student } from '../types';

const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div
            className="relative flex items-center"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#002855] text-white text-xs rounded-md whitespace-nowrap z-50 shadow-lg">
                    {content}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#002855]"></div>
                </div>
            )}
        </div>
    );
};

interface TabEvaluationProps {
    selectedStudent: number | null;
    setSelectedStudent: (id: number | null) => void;
    scenarioId: string | null;
    className?: string;
    scenarioName?: string;
    onEvaluatedChange?: (hasEvaluated: boolean) => void;
}

export function TabEvaluation({ selectedStudent, setSelectedStudent, scenarioId, className, scenarioName, onEvaluatedChange }: TabEvaluationProps) {
    const [students, setStudents] = useState<Student[]>([]);
    const [selectAll, setSelectAll] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [activeSourceQuote, setActiveSourceQuote] = useState<string | null>(null);

    // Name editing state
    const [isEditingName, setIsEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState("");

    // Real API State
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationProgress, setEvaluationProgress] = useState(0);
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const fetchEvaluations = async () => {
        try {
            const url = scenarioId
                ? `http://localhost:8000/api/v1/analytics/class/1?scenario_id=${scenarioId}`
                : `http://localhost:8000/api/v1/analytics/class/1`;

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const data = await res.json();

                const historyStudents: Student[] = data.map((evalRecord: any, index: number) => ({
                    id: evalRecord.id || (10000 + index),
                    name: evalRecord.jmeno_studenta,
                    cleanedName: evalRecord.cleaned_name,
                    identita: evalRecord.identita,
                    status: (evalRecord.vysledky && evalRecord.vysledky.length > 0) ? 'evaluated' : 'pending',
                    score: evalRecord.celkove_skore,
                    maxScore: 25,
                    evaluationDetails: evalRecord.vysledky,
                    zpetna_vazba: evalRecord.zpetna_vazba
                }));


                setStudents(historyStudents);

                if (historyStudents.length > 0 && !selectedStudent) {
                    setSelectedStudent(historyStudents[0].id);
                }

                if (onEvaluatedChange) {
                    onEvaluatedChange(historyStudents.some(s => s.status === 'evaluated'));
                }
            }
        } catch (e) {
            console.error("Nepodařilo se načíst historii evaluací", e);
        }
    };

    useEffect(() => {
        setStudents([]);
        if (onEvaluatedChange) onEvaluatedChange(false);
        fetchEvaluations();
    }, [scenarioId]);

    const toggleStudent = (id: number) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedIds([]);
        } else {
            setSelectedIds(students.map(s => s.id));
        }
        setSelectAll(!selectAll);
    };

    const openSourceModal = (quote: string) => {
        const finalQuote = (quote && quote.trim() !== "" && quote !== "Chybí.") ? quote : "Zdroj nebyl AI asistentem explicitně identifikován.";
        setActiveSourceQuote(finalQuote);
        setIsSourceModalOpen(true);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files) as File[];
            setFiles(prev => {
                const map = new Map();
                for (const f of [...prev, ...selectedFiles]) {
                    map.set(f.name, f);
                }
                return Array.from(map.values());
            });

            // Optimistic pre-render
            const optimisticStudents: Student[] = selectedFiles.map((f, i) => {
                let displayName = f.name.replace(/\.(docx|rtf|pdf)$/i, '');
                return {
                    id: Date.now() + i, // docasne
                    name: f.name,
                    cleanedName: displayName,
                    status: 'pending',
                    score: 0,
                    maxScore: 25,
                };
            });
            setStudents(prev => [...optimisticStudents, ...prev]);

            // Posíláme na Fast-Scan
            const formData = new FormData();
            selectedFiles.forEach(f => formData.append('files', f));
            formData.append('scenario_id', scenarioId || 'default');

            try {
                setToastMessage("Identifikuji autory úředních záznamů...");
                const res = await fetch('http://localhost:8000/api/v1/evaluate/fast-scan', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                    body: formData
                });

                if (res.ok) {
                    // Refetch k syncu ID + jmen
                    await fetchEvaluations();
                    setToastMessage("Data o studentech nahrána.");
                    setTimeout(() => setToastMessage(null), 3000);
                }
            } catch (err) {
                console.error("Fast scan neprosel", err);
            }
        }
    };

    const handleBatchEvaluate = async () => {
        if (!scenarioId) {
            alert("Vyberte prosím nejprve Modelovou situaci z postranního panelu.");
            return;
        }

        if (students.length > 0 && selectedIds.length === 0) {
            alert("Prosím zaškrtněte v Seznamu studentů ty, které chcete vyhodnotit (nebo klikněte na 'Vybrat všechny').");
            return;
        }

        if (files.length === 0) {
            alert("Nebyly nalezeny žádné zdrojové soubory v paměti prohlížeče.\n\nPokud jste stránku od nahrání obnovili nebo zavřeli, paměť se (z bezpečnostních důvodů) vymazala. Klikněte znovu na tlačítko 'Nahrát ÚZ' a soubory znovu vyberte. Následně hned klikněte na 'Hromadně vyhodnotit'.");
            return;
        }

        // Setup AbortController
        abortControllerRef.current = new AbortController();
        setIsEvaluating(true);
        setIsCancelling(false);
        setEvaluationProgress(0);

        const idsToProcess = [...selectedIds];
        const filesToUpload: File[] = [];
        const studentIdsBeingProcessed: number[] = [];

        // Najdeme pouze ty studenty, kteří ještě nejsou vyhodnoceni
        for (const id of idsToProcess) {
            const student = students.find(s => s.id === id);
            if (!student || student.status === 'evaluated') continue;

            const file = files.find(f => {
                const fNFC = f.name.normalize('NFC');
                const sNFC = student.name.normalize('NFC');
                return fNFC === sNFC || f.name === student.name;
            });

            if (file) {
                filesToUpload.push(file);
                studentIdsBeingProcessed.push(id);
            }
        }

        if (filesToUpload.length === 0) {
            alert("Nebyly nalezeny žádné zdrojové soubory pro zvolené studenty.\n\nPokud jste stránku od nahrání obnovili nebo zavřeli, paměť prohlížeče se (z bezpečnostních důvodů) vymazala. Klikněte znovu na tlačítko 'Nahrát ÚZ' a soubory znovu vyberte. Následně hned klikněte na 'Hromadně vyhodnotit'.");
            setIsEvaluating(false);
            return;
        }

        // Hromadná aktualizace stavů na evaluating (aby React nespustil 20 překreslení zároveň)
        setStudents(current => current.map(s =>
            studentIdsBeingProcessed.includes(s.id) ? { ...s, status: 'evaluating' } : s
        ));


        const formData = new FormData();
        filesToUpload.forEach(f => formData.append('files', f));
        formData.append('scenario_id', scenarioId);



        try {
            // Skutečná paralelizace - posíláme všechny soubory do backendu v jednom masivním batch dotazu
            const response = await fetch('http://localhost:8000/api/v1/evaluate/batch', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                body: formData,
                signal: abortControllerRef.current.signal
            });

            if (response.ok) {
                // Po spěšném zápisu na backendu stačí jen překreslit tabulku čerstvými daty z DB
                await fetchEvaluations();

                setToastMessage(`Vyhodnocení ${filesToUpload.length} studentů bylo úspěšně dokončeno a uloženo.`);
                setTimeout(() => setToastMessage(null), 5000);
                setEvaluationProgress(100);
            } else {
                console.error(`Batch evaluation failed with status: ${response.status}`);
                throw new Error("Server error");
            }

        } catch (error: any) {
            if (error.name === 'AbortError') {

            } else {
                console.error("Batch evaluation failed", error);
                alert("Došlo k chybě při paralelním vyhodnocování. Server možná neodpovídá.");
            }
            // Vracíme na pending ty, které se nepodařilo zpracovat nebo byly zrušeny
            setStudents(current => current.map(s => studentIdsBeingProcessed.includes(s.id) && s.status !== 'evaluated' ? { ...s, status: 'pending' } : s));
        } finally {
            // Robustní obnova dat z backendu na závěr - pro jistotu
            try {
                await fetchEvaluations();
            } catch (e) {
                console.error("Failed to recover evaluation state from backend", e);
            }
            setIsEvaluating(false);
            setIsCancelling(false);
            abortControllerRef.current = null;
            setTimeout(() => setEvaluationProgress(0), 2000); // Ukážeme 100% chvíli než to zmizne
        }
    };

    const handleCancelEvaluation = () => {
        if (abortControllerRef.current) {
            setIsCancelling(true);
            abortControllerRef.current.abort();
        }
    };

    const handleDeleteStudent = async (studentId: number) => {
        const student = students.find(s => s.id === studentId);
        if (!student) return;

        if (window.confirm(`Opravdu chcete smazat záznam studenta "${student.name}"?`)) {
            try {
                // If it's a persistent record (ID < 1000000000 based on Date.now() heuristic or similar)
                // Actually, history IDs are small, Date.now() IDs are large.
                if (studentId < 1700000000000) { // Heuristic for DB vs newly uploaded
                    const res = await fetch(`http://localhost:8000/api/v1/analytics/evaluation/${studentId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                    });
                    if (!res.ok) throw new Error('Backend delete failed');
                }

                // Remove from students state
                setStudents(prev => prev.filter(s => s.id !== studentId));
                // Remove from selectedIds
                setSelectedIds(prev => prev.filter(id => id !== studentId));
                // Clear active student if it was the deleted one
                if (selectedStudent === studentId) {
                    setSelectedStudent(null);
                }
            } catch (error) {
                console.error("Chyba při mazání studenta:", error);
                alert("Nepodařilo se smazat záznam.");
            }
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;

        if (window.confirm(`Opravdu chcete smazat ${selectedIds.length} vybraných záznamů?`)) {
            const idsToDelete = [...selectedIds];
            for (const id of idsToDelete) {
                const student = students.find(s => s.id === id);
                if (!student) continue;

                try {
                    if (id < 1700000000000) {
                        await fetch(`http://localhost:8000/api/v1/analytics/evaluation/${id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                        });
                    }
                } catch (error) {
                    console.error(`Failed to delete student ${id}:`, error);
                }
            }

            setStudents(prev => prev.filter(s => !idsToDelete.includes(s.id)));
            setSelectedIds([]);
            setSelectAll(false);
            if (idsToDelete.includes(selectedStudent as number)) {
                setSelectedStudent(null);
            }
        }
    };

    // --- MAN-IN-THE-LOOP (Ruční oprava výsledků AI a optimistický UI update) ---
    const handleScoreChange = (index: number, newScore: number) => {
        setStudents(current => current.map(s => {
            if (s.id === selectedStudent && s.evaluationDetails) {
                const newDetails = [...s.evaluationDetails];
                newDetails[index] = {
                    ...newDetails[index],
                    body: newScore,
                    upraveno_lektorem: true // Flag pro vizuální odlišení
                };

                // Přepočítáme celkové skóre
                const newTotal = newDetails.reduce((sum, d) => sum + (Number(d.body) || 0), 0);

                return {
                    ...s,
                    score: newTotal,
                    evaluationDetails: newDetails,
                    isDirty: true
                };
            }
            return s;
        }));
    };

    const handleFeedbackChange = (newFeedback: string) => {
        setStudents(current => current.map(s => {
            if (s.id === selectedStudent) {
                return {
                    ...s,
                    zpetna_vazba: newFeedback,
                    isDirty: true
                };
            }
            return s;
        }));
    };

    const handleSaveChanges = async () => {
        const student = students.find(s => s.id === selectedStudent);
        if (!student || !student.isDirty) return;

        setIsSaving(true);
        try {
            const payload = {
                json_result: {
                    jmeno_studenta: student.name,
                    celkove_skore: student.score,
                    zpetna_vazba: student.zpetna_vazba,
                    vysledky: student.evaluationDetails
                }
            };
            const response = await fetch(`http://localhost:8000/api/v1/analytics/evaluation/${student.id}/score`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                setToastMessage("Změny úspěšně uloženy. Analytika bude automaticky přepočítána.");
                setTimeout(() => setToastMessage(null), 4000);
                setStudents(current => current.map(s => s.id === student.id ? { ...s, isDirty: false } : s));
            } else {
                throw new Error("Chyba ze serveru");
            }
        } catch (error) {
            console.error(error);
            alert("Uložení úprav se nezdařilo.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleRenameClick = async (student: Student) => {
        const defaultName = student.identita?.prijmeni ? `${student.identita.prijmeni.toUpperCase()} ${student.identita.jmeno}, ${student.identita.hodnost}` : student.cleanedName || student.name;
        const newName = window.prompt("Upravte jméno studenta formátem: PŘÍJMENÍ Jméno, hodnost", defaultName);
        if (!newName || newName.trim() === defaultName) return;

        let finalName = newName.trim();
        const spaceIndex = finalName.indexOf(' ');
        if (spaceIndex !== -1) {
            const surname = finalName.substring(0, spaceIndex).toUpperCase();
            finalName = surname + finalName.substring(spaceIndex);
        } else {
            finalName = finalName.toUpperCase();
        }

        try {
            const res = await fetch(`http://localhost:8000/api/v1/analytics/evaluation/${student.id}/name`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({ name: finalName })
            });

            if (res.ok) {
                setStudents(current => {
                    const updated = current.map(s => s.id === student.id ? {
                        ...s,
                        cleanedName: finalName,
                        identita: undefined // odstraníme původní AI identitu, aby se použilo cleanedName
                    } : s);

                    // Okamžité přeseřazení v lokálním stavu po úpravě
                    return updated.sort((a, b) => {
                        const nameA = a.cleanedName || a.name;
                        const nameB = b.cleanedName || b.name;
                        return nameA.localeCompare(nameB, 'cs');
                    });
                });
                setToastMessage("Jméno studenta bylo ručně upraveno.");
                setTimeout(() => setToastMessage(null), 3000);
            } else {
                throw new Error("Failed to save name");
            }
        } catch (e) {
            console.error(e);
            alert("Nepodařilo se uložit nové jméno.");
        }
    };

    //---------------------------------------------------------

    const activeStudentData = students.find(s => s.id === selectedStudent);

    return (
        <div className="h-full flex flex-col gap-6 max-w-[1400px] mx-auto relative cursor-default">
            {/* Global Success Toast Notifikace */}
            {toastMessage && (
                <div className="absolute top-0 right-1/2 translate-x-1/2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50 animate-in fade-in slide-in-from-top-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <p className="font-semibold text-sm">{toastMessage}</p>
                    <button onClick={() => setToastMessage(null)} className="p-1 hover:bg-emerald-100 rounded-md transition-colors ml-2">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}


            {/* Top Action Bar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between mt-2">
                <div className="flex items-center gap-4">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        multiple
                        accept=".docx,.rtf,.pdf"
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold"
                    >
                        <UploadCloud className="w-4 h-4" />
                        Nahrát ÚZ (.docx, .rtf, .pdf)
                    </button>
                    <button
                        onClick={handleSelectAll}
                        disabled={students.length === 0}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
                    >
                        <input
                            type="checkbox"
                            checked={selectAll && students.length > 0}
                            onChange={handleSelectAll}
                            disabled={students.length === 0}
                            className="w-4 h-4 rounded border-slate-300 text-[#002855] focus:ring-[#002855] disabled:opacity-50"
                        />
                        Vybrat všechny
                    </button>

                    {selectedIds.length > 0 && (
                        <button
                            onClick={handleBulkDelete}
                            className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium border border-red-100 shadow-sm"
                        >
                            <Trash2 className="w-4 h-4" />
                            Smazat vybrané ({selectedIds.length})
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleBatchEvaluate}
                        disabled={isEvaluating || students.length === 0}
                        className={`flex flex-col items-center justify-center px-6 py-2.5 text-white rounded-lg transition-all text-sm font-bold shadow-md relative overflow-hidden min-w-[200px] ${isEvaluating || students.length === 0
                            ? 'bg-slate-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-[#D4AF37] to-[#C5A028] hover:opacity-90'
                            }`}
                    >
                        <div className="flex items-center gap-2 relative z-10">
                            {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            <span>
                                {isEvaluating ? 'Hromadně AI...' : 'Hromadně vyhodnotit (AI)'}
                            </span>
                        </div>
                        {isEvaluating && (
                            <div className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all duration-300" style={{ width: `${evaluationProgress}%` }}></div>
                        )}
                    </button>
                    {isEvaluating && (
                        <button
                            onClick={handleCancelEvaluation}
                            disabled={isCancelling}
                            className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-lg transition-all text-sm font-bold shadow-md h-[40px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 ${isCancelling
                                ? 'bg-rose-400 cursor-wait'
                                : 'bg-rose-600 hover:bg-rose-700'
                                }`}
                        >
                            <XCircle className="w-4 h-4" />
                            {isCancelling ? 'Zastavuji...' : 'Zastavit'}
                        </button>
                    )}
                </div>
            </div>

            {/* Two-Column Layout */}
            <div className="flex-1 flex gap-6 min-h-[500px]">
                {/* Left Column: Student Roster (35%) */}
                <div className="w-[35%] bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <h3 className="font-semibold text-[#002855]">Seznam studentů</h3>
                        <span className="text-xs font-medium text-slate-400">{selectedIds.length}/{students.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {students.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 text-sm">
                                Žádné nahrané soubory. Klikněte na "Nahrát ÚZ".
                            </div>
                        ) : students.map(student => (
                            <div
                                key={student.id}
                                className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer group ${selectedStudent === student.id
                                    ? 'bg-[#002855]/10 border border-[#002855]/20'
                                    : 'hover:bg-slate-50 border border-transparent'
                                    }`}
                                onClick={() => setSelectedStudent(student.id)}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(student.id)}
                                    onChange={() => toggleStudent(student.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-4 h-4 rounded border-slate-300 text-[#002855] focus:ring-[#002855]"
                                />
                                <div className="flex-1 min-w-0 flex items-center justify-between group-inner">
                                    <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
                                        <p className={`text-sm font-medium truncate ${selectedStudent === student.id ? 'text-[#002855]' : 'text-slate-700'}`}>
                                            {(student.cleanedName || student.name).split(',')[0].replace(/^(rtn\.|stržm\.|pprap\.|prap\.|nrtm\.|por\.|npor\.|kpt\.|mjr\.|pplk\.|plk\.|genmjr\.|genpor\.|gen\.)\s+/i, '')}
                                        </p>
                                        {!student.identita && student.status === 'evaluated' && (
                                            <Tooltip content="Identita studenta byla manuálně ověřena lektorem.">
                                                <UserCheck className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                            </Tooltip>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {student.status === 'evaluated' ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                <CheckCircle2 className="w-3 h-3" /> Zpracováno
                                            </span>
                                        ) : student.status === 'evaluating' ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Vyhodnocuji
                                            </span>
                                        ) : null}

                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger asChild>
                                                <button
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="p-2 text-slate-400 hover:text-[#002855] hover:bg-slate-200 rounded-md transition-all opacity-30 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 outline-none"
                                                >
                                                    <MoreVertical className="w-3.5 h-3.5" />
                                                </button>
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Portal>
                                                <DropdownMenu.Content
                                                    className="w-44 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-[100] animate-in fade-in-80 zoom-in-95"
                                                    sideOffset={5}
                                                    align="end"
                                                >
                                                    <DropdownMenu.Item
                                                        onSelect={() => handleRenameClick(student)}
                                                        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium cursor-pointer outline-none data-[highlighted]:bg-slate-50 border-b border-slate-50"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" /> Upravit jméno
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item
                                                        onSelect={() => handleDeleteStudent(student.id)}
                                                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium cursor-pointer outline-none data-[highlighted]:bg-red-50"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" /> Smazat ÚZ
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Portal>
                                        </DropdownMenu.Root>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column: The Full-Width Evaluation Canvas (65%) */}
                <div className="w-[65%] flex flex-col gap-4">
                    {activeStudentData && activeStudentData.status === 'evaluated' ? (
                        <>
                            {/* Header */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                        <User className="w-5 h-5 text-slate-500" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-[#002855] flex items-center gap-2">
                                            Hodnocení: {activeStudentData.identita?.prijmeni ? `${activeStudentData.identita.prijmeni.toUpperCase()} ${activeStudentData.identita.jmeno}, ${activeStudentData.identita.hodnost}` : activeStudentData.cleanedName || activeStudentData.name}
                                            {(!activeStudentData.identita && activeStudentData.status === 'evaluated') && (
                                                <Tooltip content="Identita studenta byla manuálně ověřena lektorem.">
                                                    <UserCheck className="w-5 h-5 text-blue-500" />
                                                </Tooltip>
                                            )}
                                        </h2>
                                        <p className="text-sm text-slate-500">{scenarioName || 'Evaluováno dynamicky'}</p>
                                    </div>

                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Celkové skóre</span>
                                    <div className="bg-[#002855] text-white px-4 py-1.5 rounded-lg font-bold text-lg shadow-inner">
                                        {activeStudentData.score} / {activeStudentData.maxScore} b.
                                    </div>
                                </div>
                            </div>

                            {/* AI Evaluation Table */}
                            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                                <div className="p-4 border-b border-slate-100 bg-[#002855] text-white flex items-center gap-2">
                                    <Wand2 className="w-5 h-5 text-[#D4AF37]" />
                                    <h3 className="font-semibold text-base tracking-wide">Výsledky AI Evaluace Serveru</h3>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                                                <th className="px-6 py-4 font-medium w-1/4">Kritérium</th>
                                                <th className="px-6 py-4 font-medium text-center w-24">Splněno</th>
                                                <th className="px-6 py-4 font-medium">Zdůvodnění</th>
                                                <th className="px-6 py-4 font-medium text-center w-24">Body</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {activeStudentData.evaluationDetails?.map((detail, idx) => (
                                                <tr key={idx} className={`hover:bg-slate-50/50 transition-colors ${detail.upraveno_lektorem ? 'bg-blue-50/30' : ''}`}>
                                                    <td className="px-6 py-5 text-sm font-medium text-[#002855] align-top">
                                                        <div className="flex items-center gap-2">
                                                            {detail.nazev}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-center align-top relative">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            {detail.body > 0 ? (
                                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
                                                                    <CheckCircle2 className="w-5 h-5" />
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 text-rose-700 shadow-sm">
                                                                    <XCircle className="w-5 h-5" />
                                                                </span>
                                                            )}
                                                            {detail.upraveno_lektorem && (
                                                                <span title="Lektorský zásah" className="inline-flex items-center justify-center relative">
                                                                    <User className="w-5 h-5 text-blue-500 opacity-80" />
                                                                    <GraduationCap className="w-3.5 h-3.5 text-blue-700 absolute -bottom-1 -right-1 drop-shadow-sm" />
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-sm text-slate-600 align-top">
                                                        <div className="flex items-start gap-3">
                                                            <p className="leading-relaxed flex-1">{detail.oduvodneni}</p>
                                                            <Tooltip content="Zobrazit zdroj v textu studenta (AI Act Compliance)">
                                                                <button
                                                                    onClick={() => openSourceModal(detail.citace)}
                                                                    className="p-2 text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-lg transition-colors flex-shrink-0 mt-0.5 border border-[#D4AF37]/30 shadow-sm bg-white"
                                                                    aria-label="Zobrazit zdroj v textu studenta"
                                                                >
                                                                    <MessageSquareQuote className="w-4 h-4" />
                                                                </button>
                                                            </Tooltip>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-center align-top">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <input
                                                                type="number"
                                                                value={detail.body}
                                                                onChange={(e) => handleScoreChange(idx, parseInt(e.target.value, 10) || 0)}
                                                                className={`w-14 text-center border rounded-md py-1 text-sm font-medium focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] outline-none ${detail.upraveno_lektorem ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-300'}`}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Bottom Action Bar */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-[#002855] uppercase tracking-wider mb-2">
                                        Závěrečná pedagogická zpětná vazba (Editovatelné)
                                    </label>
                                    <textarea
                                        className="w-full border border-slate-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none resize-none h-24 bg-slate-50 leading-relaxed"
                                        value={activeStudentData.zpetna_vazba || ""}
                                        onChange={(e) => handleFeedbackChange(e.target.value)}
                                    />
                                </div>
                                <div className="flex justify-end gap-3">
                                    {activeStudentData.isDirty && (
                                        <button
                                            onClick={handleSaveChanges}
                                            disabled={isSaving}
                                            className="flex items-center gap-2 px-6 py-3 bg-white border border-[#D4AF37] text-[#D4AF37] rounded-xl hover:bg-[#D4AF37]/5 transition-colors text-sm font-bold shadow-sm"
                                        >
                                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                            Uložit úpravy {activeStudentData.score} / {activeStudentData.maxScore} b.
                                        </button>
                                    )}
                                    <button
                                        onClick={async () => {
                                            if (activeStudentData) {
                                                try {
                                                    const combinedSubtitle = `${className || 'Neznámá třída'} - ${scenarioName || scenarioId || 'Neznámá situace'}`;
                                                    const res = await fetch(`http://localhost:8000/api/v1/export/student/by-name/${encodeURIComponent(activeStudentData.name)}/pdf?scenario_id=${encodeURIComponent(combinedSubtitle)}`, {
                                                        headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                                                    });
                                                    if (!res.ok) throw new Error('PDF Export selhal');
                                                    const blob = await res.blob();
                                                    const url = window.URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url;
                                                    a.download = `hodnoceni_${activeStudentData.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
                                                    document.body.appendChild(a);
                                                    a.click();
                                                    window.URL.revokeObjectURL(url);
                                                    document.body.removeChild(a);

                                                    // Uložení záznamu do historie
                                                    await fetch('http://localhost:8000/api/v1/export/history', {
                                                        method: 'POST',
                                                        headers: {
                                                            'Content-Type': 'application/json',
                                                            'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                                                        },
                                                        body: JSON.stringify({
                                                            scenario_name: scenarioId || 'Neznámý scénář',
                                                            type: `PDF Hodnocení (${activeStudentData.name})`,
                                                            download_url: `/api/v1/export/evaluation/${activeStudentData.id}/pdf`
                                                        })
                                                    });
                                                } catch (e: any) {
                                                    alert(e.message);
                                                }
                                            }
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-[#002855] text-white rounded-xl hover:bg-[#002855]/90 transition-colors text-sm font-bold shadow-md"
                                    >
                                        <Download className="w-5 h-5 text-[#D4AF37]" />
                                        Uložit a Exportovat PDF
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400">
                            {activeStudentData && activeStudentData.status === 'pending' ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center space-y-4">
                                    <Hourglass className="w-16 h-16 text-slate-200" />
                                    <h3 className="text-xl font-medium text-slate-600">Čeká se na zahájení evaluace...</h3>
                                    <p className="text-sm">Vyberte studenty a klikněte na "Hromadně vyhodnotit (AI)".</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center space-y-4">
                                    <UploadCloud className="w-16 h-16 text-slate-300" />
                                    <h3 className="text-xl font-medium text-slate-600">Nahrajte úřední záznamy a vyberte ty, které chcete vyhodnotit</h3>
                                    <p className="text-sm">Klikněte na tlačítko "Nahrát práce (.docx, .pdf)" a vyberte dokumenty.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* AI Act Source Modal */}
            {isSourceModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 bg-[#002855] text-white flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Shield className="w-5 h-5 text-[#D4AF37]" />
                                <h2 className="text-lg font-semibold tracking-wide">Zdrojová pasáž dokumentu</h2>
                            </div>
                            <button
                                onClick={() => setIsSourceModalOpen(false)}
                                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 bg-[#fdfdfc]">
                            <p className="text-sm text-slate-500 mb-4">
                                Níže je zobrazen text studenta. Zvýrazněná pasáž posloužila AI k rozhodnutí.
                            </p>
                            <div className="font-serif text-sm leading-relaxed text-slate-800 whitespace-pre-wrap max-w-prose mx-auto bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                <mark className="bg-yellow-200 px-1 rounded text-slate-900 font-medium">{activeSourceQuote}</mark>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                            <button
                                onClick={() => setIsSourceModalOpen(false)}
                                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium shadow-sm"
                            >
                                Zavřít
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

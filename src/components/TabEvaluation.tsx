import React, { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import { UploadCloud, Wand2, CheckCircle2, AlertCircle, User, MessageSquareQuote, Download, Shield, X, XCircle, Loader2, MoreVertical, Trash2, Save, Pencil, GraduationCap, UserCheck, Hourglass, FileText, Upload } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Student } from '../types';
import { useDialog } from '../contexts/DialogContext';

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

/**
 * KOMPONENTA: TAB EVALUATION (VYHODNOCOVÁNÍ)
 * Tato komponenta je srdcem aplikace pro lektora. Umožňuje nahrávat soubory studentů, 
 * spouštět AI analýzu a sledovat výsledky v reálném čase.
 */
export function TabEvaluation({ selectedStudent, setSelectedStudent, scenarioId, className, scenarioName, onEvaluatedChange }: TabEvaluationProps) {
    const { showAlert, showConfirm, showPrompt } = useDialog();
    const [students, setStudents] = useState<Student[]>([]);
    const [selectAll, setSelectAll] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [activeSourceQuote, setActiveSourceQuote] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Name editing state
    const [isEditingName, setIsEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState("");

    // Real API State
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationProgress, setEvaluationProgress] = useState(0);
    const [totalToEvaluate, setTotalToEvaluate] = useState(0);
    const [evaluatedCount, setEvaluatedCount] = useState(0);
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    // MLOps/RAG State
    const [isRagEnabled, setIsRagEnabled] = useState(false);
    const [isSavingGolden, setIsSavingGolden] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/admin/settings`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const rag = data.find((s: any) => s.key === 'ENABLE_RAG_MODULE');
                    setIsRagEnabled(rag?.value === 'true');
                }
            } catch (e) {
                console.error("Failed to load settings", e);
            }
        };
        fetchSettings();
    }, []);

    // --- WEBSOCET: SLEDOVÁNÍ STAVU V REÁLNÉM ČASE ---
    useEffect(() => {
        let ws: WebSocket;
        const connectWs = () => {
            const wsUrl = API_BASE_URL.replace('http', 'ws') + '/evaluate/ws';
            ws = new WebSocket(wsUrl);
            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                // Backend posílá zprávy o startu (EVAL_START), úspěchu (EVAL_SUCCESS) nebo chybě (EVAL_ERROR).
                if (data.type === 'EVAL_START') {
                    setStudents(prev => prev.map(s => s.name === data.student_name ? { ...s, status: 'evaluating' } : s));
                } else if (data.type === 'EVAL_SUCCESS') {
                    setEvaluatedCount(prev => prev + 1);
                    await fetchEvaluations(); // Po úspěchu načteme čerstvá data z DB
                } else if (data.type === 'EVAL_ERROR') {
                    setEvaluatedCount(prev => prev + 1);
                    setToastMessage(`Chyba u studenta: ${data.error}`);
                    setTimeout(() => setToastMessage(null), 5000);
                    setStudents(prev => prev.map(s => s.name === data.student_name ? { ...s, status: 'pending' } : s));
                }
            };
            ws.onclose = () => {
                // Automatický reconnect při odpojení
                setTimeout(connectWs, 3000);
            };
        };
        connectWs();
        return () => ws?.close();
    }, [scenarioId]);
    useEffect(() => {
        const handleSyncComplete = () => {
            fetchEvaluations();
        };

        window.addEventListener('evaluz-sync-complete', handleSyncComplete);
        return () => window.removeEventListener('evaluz-sync-complete', handleSyncComplete);
    }, [scenarioId]);

    const [isSaving, setIsSaving] = useState(false);

    const fetchEvaluations = async () => {
        try {
            const url = scenarioId
                ? `${API_BASE_URL}/analytics/class/1?scenario_id=${scenarioId}`
                : `${API_BASE_URL}/analytics/class/1`;

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const data = await res.json();

                setStudents(currentList => {
                    const historyStudents: Student[] = data.map((evalRecord: any, index: number) => {
                        const existing = currentList.find(s => s.id === evalRecord.id || s.name === evalRecord.jmeno_studenta);
                        let finalStatus: 'evaluated' | 'pending' | 'evaluating' = (evalRecord.vysledky && evalRecord.vysledky.length > 0) ? 'evaluated' : 'pending';

                        // Zachovat lokálně běžící status vyhodnocování, i když server ještě hlásí 'pending'
                        if (existing?.status === 'evaluating' && finalStatus === 'pending') {
                            finalStatus = 'evaluating';
                        }

                        return {
                            id: evalRecord.id || (10000 + index),
                            name: evalRecord.jmeno_studenta,
                            cleanedName: evalRecord.cleaned_name,
                            identita: evalRecord.identita,
                            status: finalStatus,
                            score: evalRecord.celkove_skore,
                            maxScore: 25,
                            evaluationDetails: evalRecord.vysledky,
                            zpetna_vazba: evalRecord.zpetna_vazba
                        };
                    });

                    // Najít ty, co visí jen čistě lokálně a server o nich neví
                    const offline = currentList.filter(curr => !historyStudents.some(hs => hs.name === curr.name));

                    const merged = [...historyStudents, ...offline];

                    return merged.sort((a, b) => {
                        const nameA = a.cleanedName || a.name;
                        const nameB = b.cleanedName || b.name;
                        return nameA.localeCompare(nameB, 'cs');
                    });
                });

                if (data.length > 0 && !selectedStudent) {
                    setSelectedStudent(data[0].id || 10000);
                }

                if (onEvaluatedChange) {
                    onEvaluatedChange(data.some((s: any) => s.vysledky && s.vysledky.length > 0));
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

    const processFiles = async (selectedFiles: File[]) => {
        /**
         * FUNKCE: ZPRACOVÁNÍ SOUBORŮ
         * Extrahuje text, provede Fast-Scan (identifikaci) a založí záznamy v databázi.
         */

        if (!selectedFiles || selectedFiles.length === 0) return;

        // Filter only allowed extensions
        const validFiles = selectedFiles.filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'pdf' || ext === 'docx' || ext === 'rtf';
        });

        if (validFiles.length === 0) return;

        setFiles(prev => {
            const map = new Map();
            for (const f of [...prev, ...validFiles]) {
                map.set(f.name, f);
            }
            return Array.from(map.values());
        });

        // Optimistic pre-render
        const optimisticStudents: Student[] = validFiles.map((f, i) => {
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
        validFiles.forEach(f => formData.append('files', f));
        formData.append('scenario_id', scenarioId || 'default');

        try {
            setToastMessage("Identifikuji autory úředních záznamů...");
            const res = await fetch(`${API_BASE_URL}/evaluate/fast-scan`, {
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
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await processFiles(Array.from(e.target.files));
            // Resetování hodnoty inputu, aby šlo znovu nahrát stejný soubor
            e.target.value = '';
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files) {
            await processFiles(Array.from(e.dataTransfer.files));
        }
    };

    /**
     * AKCE: SPUŠTĚNÍ HROMADNÉHO VYHODNOCENÍ
     * Sebere všechny označené studenty a pošle požadavek na backend do fronty.
     */
    const handleBatchEvaluate = async () => {
        if (!scenarioId) {
            showAlert("Vyberte prosím nejprve Modelovou situaci z postranního panelu.");
            return;
        }

        if (students.length > 0 && selectedIds.length === 0) {
            showAlert("Prosím zaškrtněte v Seznamu studentů ty, které chcete vyhodnotit (nebo klikněte na 'Vybrat všechny').");
            return;
        }

        if (students.length === 0) {
            showAlert("Nejdříve nahrajte soubory nebo synchronizujte složku.");
            return;
        }

        // Setup UI for Evaluation
        setIsEvaluating(true);
        setIsCancelling(false);
        setEvaluationProgress(0);
        setEvaluatedCount(0);

        const idsToProcess = [...selectedIds];
        const filesToUpload: File[] = [];
        const studentIdsFromDB: number[] = [];
        const studentIdsBeingProcessed: number[] = [];

        for (const id of idsToProcess) {
            const student = students.find(s => s.id === id);
            if (!student || student.status === 'evaluated') continue;

            // 1. Check if we have the file in local memory
            const file = files.find(f => {
                const fNFC = f.name.normalize('NFC');
                const sNFC = student.name.normalize('NFC');
                return fNFC === sNFC || f.name === student.name;
            });

            if (file) {
                filesToUpload.push(file);
                studentIdsBeingProcessed.push(id);
            } else if (id < 1700000000000) {
                // 2. If not in memory but it's a persistent record (ID from DB), 
                // send its ID so backend can use stored source_text
                studentIdsFromDB.push(id);
                studentIdsBeingProcessed.push(id);
            }
        }

        if (filesToUpload.length === 0 && studentIdsFromDB.length === 0) {
            showAlert("Nebyly nalezeny žádné zdrojové soubory pro zvolené studenty.\n\nPokud se jedná o nově nahrané soubory a obnovili jste stránku, musíte je nahrát znovu. Pokud se jedná o synchronizované soubory, ujistěte se, že synchronizace proběhla úspěšně.");
            setIsEvaluating(false);
            return;
        }

        setTotalToEvaluate(prev => prev + studentIdsBeingProcessed.length);
        setIsEvaluating(true);

        setStudents(current => current.map(s =>
            studentIdsBeingProcessed.includes(s.id) ? { ...s, status: 'evaluating' } : s
        ));


        const formData = new FormData();
        filesToUpload.forEach(f => formData.append('files', f));
        if (studentIdsFromDB.length > 0) {
            formData.append('student_ids', studentIdsFromDB.join(','));
        }
        formData.append('scenario_id', scenarioId);



        try {
            // Frontend nečeká na zpracování AI, jen odešle do fronty s 202 Accepted
            const response = await fetch(`${API_BASE_URL}/evaluate/batch`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                body: formData
            });

            if (response.status === 202 || response.ok) {
                const totalStudentsSent = filesToUpload.length + studentIdsFromDB.length;
                setToastMessage(`Dávka odeslána. Vyhodnocování ${totalStudentsSent} studentů probíhá na pozadí.`);
                setTimeout(() => setToastMessage(null), 5000);
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Server error - Failed to enqueue tasks.");
            }
        } catch (error: any) {
            console.error('Batch evaluation error:', error);
            showAlert(error.message || "Došlo k chybě při odesílání dávky na server.");
            // On hard error during queueing, rollback the state immediately
            setStudents(current => current.map(s => studentIdsBeingProcessed.includes(s.id) && s.status !== 'evaluated' ? { ...s, status: 'pending' } : s));
            setIsEvaluating(false);
            setTotalToEvaluate(prev => prev - studentIdsBeingProcessed.length);
        }
    };

    // Effect pro aktualizaci progress baru podle Websocket událostí
    useEffect(() => {
        if (isEvaluating && totalToEvaluate > 0) {
            const prog = Math.round((evaluatedCount / totalToEvaluate) * 100);
            setEvaluationProgress(prog);
            if (evaluatedCount >= totalToEvaluate) {
                setTimeout(() => {
                    setIsEvaluating(false);
                    setEvaluationProgress(0);
                    setToastMessage("Vyhodnocování celé dávky bylo úspěšně dokončeno.");
                    setTimeout(() => setToastMessage(null), 4000);
                }, 1000);
            }
        }
    }, [evaluatedCount, totalToEvaluate, isEvaluating]);

    const handleCancelEvaluation = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setIsCancelling(true);
        try {
            const res = await fetch(`${API_BASE_URL}/evaluate/batch`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                setToastMessage("Zpracování dalších ÚZ bylo zastaveno.");
                // Note: The UI logic (isEvaluating=false) will probably be handled automatically 
                // when the queue empties out (or not if we don't get SUCCESS/ERROR for them).
                // Let's manually trigger a refresh to clear pending statuses and stop.
                setIsEvaluating(false);
                setEvaluationProgress(0);
                setTotalToEvaluate(0);
                setEvaluatedCount(0);
                // Reset all 'evaluating' students to 'pending' before reloading from DB
                setStudents(current => current.map(s => s.status === 'evaluating' ? { ...s, status: 'pending' } : s));
                setTimeout(() => setToastMessage(null), 4000);
                await fetchEvaluations(); // reload actual statuses
            } else {
                throw new Error("Server nevrátil 2xx code při mazání fronty.");
            }
        } catch (e) {
            console.error("Zastavení selhalo", e);
            showAlert("Nepodařilo se zastavit vyhodnocování. Fronta nemusí být smazána.");
        } finally {
            setIsCancelling(false);
        }
    };

    const handleDeleteStudent = async (studentId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const student = students.find(s => s.id === studentId);
        if (!student) return;

        const conf = await showConfirm(`Opravdu chcete smazat záznam studenta "${student.name}"?`);
        if (conf) {
            try {
                // If it's a persistent record (ID < 1000000000 based on Date.now() heuristic or similar)
                // Actually, history IDs are small, Date.now() IDs are large.
                if (studentId < 1700000000000) { // Heuristic for DB vs newly uploaded
                    const res = await fetch(`${API_BASE_URL}/analytics/evaluation/${studentId}`, {
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
            } catch (err) {
                console.error("Delete failed", err);
                showAlert("Nepodařilo se smazat záznam.");
            }
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return;

        const conf = await showConfirm(`Opravdu chcete smazat ${selectedIds.length} vybraných záznamů?`);
        if (conf) {
            const idsToDelete = [...selectedIds];
            for (const id of idsToDelete) {
                const student = students.find(s => s.id === id);
                if (!student) continue;

                try {
                    if (id < 1700000000000) {
                        await fetch(`${API_BASE_URL}/analytics/evaluation/${id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                        });
                    }
                } catch (error) {
                    console.error(`Failed to delete student ${id}:`, error);
                    showAlert(`Nepodařilo se smazat záznam pro studenta s ID ${id}.`);
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
            const response = await fetch(`${API_BASE_URL}/analytics/evaluation/${student.id}/score`, {
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
        } catch (err) {
            console.error(err);
            showAlert("Uložení úprav se nezdařilo.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveGoldenExample = async () => {
        const student = students.find(s => s.id === selectedStudent);
        if (!student) return;
        setIsSavingGolden(true);
        try {
            const payload = {
                scenario_id: scenarioId || 'unknown_scenario',
                source_text: "Obsah úředního záznamu.", // Budoucí rozšíření pro pure cosine similarity
                perfect_json: JSON.stringify({
                    jmeno_studenta: student.name,
                    celkove_skore: student.score,
                    zpetna_vazba: student.zpetna_vazba,
                    vysledky: student.evaluationDetails
                }, null, 2)
            };
            const response = await fetch(`${API_BASE_URL}/evaluate/golden-example`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                setToastMessage("⭐ Zlatý příklad byl úspěšně uložen do sítě.");
                setTimeout(() => setToastMessage(null), 4000);
            } else {
                const errData = await response.json();
                throw new Error(errData.detail || "Chyba ze serveru");
            }
        } catch (error: any) {
            console.error("Failed to save golden example:", error);
            showAlert("Uložení Zlatého příkladu selhalo: " + error.message);
        } finally {
            setIsSavingGolden(false);
        }
    };

    const handleRenameClick = async (student: Student) => {
        let defaultName = student.identita?.prijmeni ? `${student.identita.prijmeni} ${student.identita.jmeno}` : (student.cleanedName || student.name).split(',')[0].replace(/^(rtn\.|stržm\.|pprap\.|prap\.|nrtm\.|por\.|npor\.|kpt\.|mjr\.|pplk\.|plk\.|genmjr\.|genpor\.|gen\.)\s+/i, '');
        defaultName = defaultName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').trim();
        const newName = await showPrompt("Upravte jméno studenta formátem: Příjmení Jméno", defaultName);
        if (!newName || newName.trim() === defaultName) return;

        let finalName = newName.trim();
        finalName = finalName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        try {
            const res = await fetch(`${API_BASE_URL}/analytics/evaluation/${student.id}/name`, {
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
        } catch (err) {
            console.error(err);
            showAlert("Nepodařilo se uložit nové jméno.");
        }
    };

    //---------------------------------------------------------

    const activeStudentData = students.find(s => s.id === selectedStudent);

    const canEvaluate = selectedIds.length > 0 && selectedIds.some(id => {
        const student = students.find(s => s.id === id);
        return student && student.status !== 'evaluated' && student.status !== 'evaluating';
    });

    return (
        <div
            className={`h-full flex flex-col gap-6 max-w-[1400px] mx-auto relative transition-colors duration-200 ${isDragging ? 'bg-blue-50/50 rounded-2xl ring-4 ring-blue-500/20' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragging && (
                <div className="absolute inset-0 bg-blue-500/10 backdrop-blur-sm z-40 rounded-2xl flex flex-col items-center justify-center border-4 border-dashed border-blue-500 pointer-events-none">
                    <div className="bg-white p-6 rounded-full shadow-2xl mb-4">
                        <Upload className="w-16 h-16 text-blue-600 animate-bounce" />
                    </div>
                    <h2 className="text-3xl font-bold text-blue-800 drop-shadow-sm">Pusťte soubory zde</h2>
                    <p className="text-blue-600 mt-2 font-medium">Podporované formáty: PDF, DOCX, RTF</p>
                </div>
            )}

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
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex items-center justify-between mt-2 transition-colors duration-200">
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
                        <Upload className="w-4 h-4" />
                        Nahrát ÚZ
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
                        disabled={!canEvaluate}
                        className={`flex flex-col items-center justify-center px-6 py-2.5 text-white rounded-lg transition-all text-sm font-bold shadow-md relative overflow-hidden min-w-[200px] ${!canEvaluate
                            ? 'bg-slate-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-[#D4AF37] to-[#C5A028] hover:opacity-90'
                            }`}
                    >
                        <div className="flex items-center gap-2 relative z-10">
                            {(isEvaluating && canEvaluate) ? <Wand2 className="w-4 h-4" /> : isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            <span>
                                {(isEvaluating && canEvaluate) ? 'Přidat do fronty AI' : isEvaluating ? 'Hromadně AI...' : 'Hromadně vyhodnotit (AI)'}
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
                                            {(student.cleanedName || student.name).split(',')[0].replace(/^(rtn\.|stržm\.|pprap\.|prap\.|nrtm\.|por\.|npor\.|kpt\.|mjr\.|pplk\.|plk\.|genmjr\.|genpor\.|gen\.)\s+/i, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').trim()}
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
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-orange-50 text-orange-700 border border-orange-200 animate-pulse transition-all">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Zpracovává se
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-red-50 text-red-700 border border-red-200">
                                                <AlertCircle className="w-3 h-3" /> Nezpracováno
                                            </span>
                                        )}

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
                                                        onSelect={(e) => handleDeleteStudent(student.id, e as unknown as React.MouseEvent)}
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
                                            Hodnocení: {activeStudentData.identita?.prijmeni ? `${activeStudentData.identita.prijmeni.toUpperCase()} ${activeStudentData.identita.jmeno || ''}, ${activeStudentData.identita.hodnost || ''}` : activeStudentData.cleanedName || activeStudentData.name}
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
                                    {isRagEnabled && (
                                        <button
                                            onClick={handleSaveGoldenExample}
                                            disabled={isSavingGolden}
                                            className="flex items-center gap-2 px-6 py-3 bg-purple-100 text-purple-700 border border-purple-200 rounded-xl hover:bg-purple-200 transition-colors text-sm font-bold shadow-sm"
                                            title="Uložit toto finální skvělé hodnocení do sady etalonů RAG paměti pro budoucí AI inference."
                                        >
                                            {isSavingGolden ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="text-xl -mt-1 leading-none">⭐</span>}
                                            Uložit jako Zlatý příklad
                                        </button>
                                    )}
                                    <button
                                        onClick={async () => {
                                            if (activeStudentData) {
                                                try {
                                                    const combinedSubtitle = `${className || 'Neznámá třída'} - ${scenarioName || scenarioId || 'Neznámá situace'}`;
                                                    const res = await fetch(`${API_BASE_URL}/export/student/by-name/${encodeURIComponent(activeStudentData.name)}/pdf?scenario_id=${encodeURIComponent(combinedSubtitle)}`, {
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
                                                    await fetch(`${API_BASE_URL}/export/history`, {
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
                                                    console.error("Zápis manuálního hodnocení selhal:", e);
                                                    showAlert(e.message);
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
                                    <FileText className="w-16 h-16 text-slate-200" />
                                    <h3 className="text-xl font-medium text-slate-600">Nahrajte úřední záznamy a vyberte ty, které chcete vyhodnotit</h3>
                                    <p className="text-sm max-w-md">Klikněte na tlačítko &quot;Nahrát ÚZ&quot;, nebo soubory prostě na tlačítko přetáhněte (drag &amp; drop). Pokud chcete, můžete využít synchronizaci celého lokálního adresáře — pozor na adresářovou strukturu, viz nápověda ❓ v postranním panelu.</p>
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
        </div >
    );
}

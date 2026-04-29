import React, { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';

import {
  faCloudArrowUp, faWandMagicSparkles, faCircleCheck, faCircleExclamation,
  faUser, faCommentDots, faDownload, faShield, faXmark, faCircleXmark,
  faSpinner, faEllipsisVertical, faTrash, faFloppyDisk, faPencil,
  faGraduationCap, faUserCheck, faHourglass, faFileLines, faUpload,
  faSquareCheck, faCirclePlay, faClock, faShieldHalved, faArrowUp,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Student } from '../types';
import { useDialog } from '../contexts/DialogContext';

const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
    const [isVisible, setIsVisible] = useState(false);
    return (
        <div
            className="tooltip-container"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && <div className="tooltip-box">{content}</div>}
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
    lecturerId?: number | null;
}

/**
 * KOMPONENTA: TAB EVALUATION (VYHODNOCOVÁNÍ)
 * Tato komponenta je srdcem aplikace pro vyučujícího. Umožňuje nahrávat soubory studentů, 
 * spouštět AI analýzu a sledovat výsledky v reálném čase.
 */
export function TabEvaluation({ selectedStudent, setSelectedStudent, scenarioId, className, scenarioName, onEvaluatedChange, lecturerId }: TabEvaluationProps) {
    const { showAlert, showConfirm, showPrompt } = useDialog();
    const [students, setStudents] = useState<Student[]>([]);
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
    const [errorCount, setErrorCount] = useState(0);
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const wsConnectCountRef = useRef(0);
    const evalDetailScrollRef = useRef<HTMLDivElement>(null);
    const studentListScrollRef = useRef<HTMLDivElement>(null);
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
            if (!lecturerId) return;
            const wsToken = localStorage.getItem('upvsp_token') || '';
            const wsUrl = API_BASE_URL.replace('http', 'ws') + `/evaluate/ws?lecturer_id=${lecturerId}&token=${encodeURIComponent(wsToken)}`;
            ws = new WebSocket(wsUrl);
            ws.onopen = () => {
                wsConnectCountRef.current += 1;
                if (wsConnectCountRef.current > 1) {
                    // Backend restarted nebo spojení přerušeno — resetujeme zaseknutý stav
                    setStudents(prev => prev.map(s => s.status === 'evaluating' ? { ...s, status: 'pending' } : s));
                    setIsEvaluating(false);
                    setEvaluationProgress(0);
                    setTotalToEvaluate(0);
                    setEvaluatedCount(0);
                    fetchEvaluations();
                }
            };
            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                // Backend posílá zprávy o startu (EVAL_START), úspěchu (EVAL_SUCCESS) nebo chybě (EVAL_ERROR).
                if (data.type === 'EVAL_START') {
                    setStudents(prev => prev.map(s => {
                        const sName = (s.name || "").normalize('NFC');
                        const dataName = (data.student_name || "").normalize('NFC');
                        return sName === dataName ? { ...s, status: 'evaluating' } : s;
                    }));
                } else if (data.type === 'EVAL_SUCCESS') {
                    setEvaluatedCount(prev => prev + 1);
                    await fetchEvaluations();
                } else if (data.type === 'EVAL_ERROR') {
                    setEvaluatedCount(prev => prev + 1);
                    setErrorCount(prev => prev + 1);
                    setToastMessage(`Chyba u studenta: ${data.error}`);
                    setTimeout(() => setToastMessage(null), 5000);
                    setStudents(prev => prev.map(s => {
                        const sName = (s.name || "").normalize('NFC');
                        const dataName = (data.student_name || "").normalize('NFC');
                        return sName === dataName ? { ...s, status: 'pending' } : s;
                    }));
                }
            };
            ws.onclose = () => {
                // Automatický reconnect při odpojení
                setTimeout(connectWs, 3000);
            };
        };
        connectWs();
        return () => ws?.close();
    }, [scenarioId, lecturerId]);
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
                        const existing = currentList.find(s => 
                            s.id === evalRecord.id || 
                            (s.name && evalRecord.jmeno_studenta && s.name.normalize('NFC') === evalRecord.jmeno_studenta.normalize('NFC'))
                        );
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
                            maxScore: evalRecord.vysledky ? evalRecord.vysledky.length : 0,
                            evaluationDetails: evalRecord.vysledky,
                            zpetna_vazba: evalRecord.zpetna_vazba,
                            is_approved: evalRecord.is_approved ?? false
                        };
                    });

                    // Najít ty, co visí jen čistě lokálně a server o nich neví
                    const offline = currentList.filter(curr => !historyStudents.some(hs => 
                        hs.name && curr.name && hs.name.normalize('NFC') === curr.name.normalize('NFC')
                    ));

                    const merged = [...historyStudents, ...offline];

                    const sorted = merged.sort((a, b) => {
                        const nameA = a.cleanedName || a.name;
                        const nameB = b.cleanedName || b.name;
                        return nameA.localeCompare(nameB, 'cs');
                    });

                    // Cleanup selectedIds - remove IDs that are no longer in students list
                    setSelectedIds(prev => prev.filter(id => sorted.some(s => s.id === id)));

                    return sorted;
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

    // Průběžně synchronizujeme hasEvaluations do App.tsx — kdykoli se změní seznam studentů.
    // Tím se odemkne záložka "Analýza třídy" i bez page refresh po EVAL_SUCCESS nebo schválení.
    useEffect(() => {
        if (onEvaluatedChange) {
            onEvaluatedChange(students.some(s => s.status === 'evaluated'));
        }
    }, [students]);

    // SELF-HEALING: Pokud isEvaluating=true ale žádný student už nemá status 'evaluating',
    // znamená to, že všechna WS oznámení dorazila (nebo se ztratila) a UI zůstalo zaseklé.
    // V takovém případě resetujeme spinner — obrana proti ztrátě WS zprávy při reconnectu.
    useEffect(() => {
        if (!isEvaluating || students.length === 0 || evaluatedCount === 0) return;
        const anyStillRunning = students.some(s => s.status === 'evaluating');
        if (!anyStillRunning) {
            setIsEvaluating(false);
            setEvaluationProgress(0);
        }
    }, [students, isEvaluating, evaluatedCount]);

    const toggleStudent = (id: number) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const isAllSelected = students.length > 0 && selectedIds.length === students.length;

    const handleSelectAll = () => {
        if (isAllSelected) {
            setSelectedIds([]);
        } else {
            setSelectedIds(students.map(s => s.id));
        }
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
                maxScore: 0,
            };
        });
        setStudents(prev => [...optimisticStudents, ...prev]);

        // Posíláme na Fast-Scan
        const formData = new FormData();
        validFiles.forEach(f => formData.append('files', f));
        formData.append('scenario_id', scenarioId || 'default');
        formData.append('scenario_display_name', scenarioName || '');

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

        setTotalToEvaluate(studentIdsBeingProcessed.length);
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
        formData.append('scenario_display_name', scenarioName || '');



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
                    // Resetujeme všechny studenty kteří mohli zůstat zaseknutí ve stavu 'evaluating'
                    setStudents(prev => prev.map(s => s.status === 'evaluating' ? { ...s, status: 'pending' } : s));
                    fetchEvaluations();

                    if (errorCount > 0) {
                        setToastMessage(`Vyhodnocování dokončeno s ${errorCount} chybami. Zkontrolujte prosím seznam záznamů.`);
                    } else {
                        setToastMessage("Dávka úspěšně zpracována.");
                    }

                    setTimeout(() => {
                        setToastMessage(null);
                        setErrorCount(0);
                    }, 5000);
                }, 1000);
            }
        }
    }, [evaluatedCount, totalToEvaluate, isEvaluating, errorCount]);

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

    // Re-evaluace je povolena pro:
    //   - studenty dosud nevyhodnocené (pending)
    //   - studenty vyhodnocené ale NESCHVÁLENÉ (lektor může změnit kritéria a znovu spustit)
    // Re-evaluace je ZAKÁZÁNA pro:
    //   - záznamy právě probíhající evaluace (evaluating)
    //   - záznamy schválené lektorem (is_approved=true) — Man-in-the-Loop schválení je finální
    const canEvaluate = selectedIds.length > 0 && selectedIds.some(id => {
        const student = students.find(s => s.id === id);
        if (!student) return false;
        if (student.status === 'evaluating') return false;
        if (student.status === 'evaluated' && student.is_approved) return false;
        return true;
    });

    return (
        <div
            style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag overlay */}
            {isDragging && (
                <div className="upload-zone upload-zone--active" style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <Icon icon={faUpload} size="2x" />
                    <strong>Pusťte soubory zde</strong>
                    <span style={{ fontSize: '0.85rem' }}>Podporované formáty: PDF, DOCX, RTF</span>
                </div>
            )}

            {/* Toast */}
            {toastMessage && (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', background: 'var(--color-secondary)', color: '#fff', padding: '8px 14px', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: '0.875rem', fontWeight: 600 }}>
                    <Icon icon={faCircleCheck} />
                    <span>{toastMessage}</span>
                    <button className="btn btn--sm btn--icon-only" style={{ marginLeft: 4, background: 'transparent', border: 'none', color: '#fff' }} onClick={() => setToastMessage(null)}>
                        <Icon icon={faXmark} />
                    </button>
                </div>
            )}

            {/* Top Action Bar */}
            <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept=".docx,.rtf,.pdf" style={{ display: 'none' }} />
                    <button className="btn btn--outline btn--sm" onClick={() => fileInputRef.current?.click()}>
                        <Icon icon={faUpload} /> Nahrát ÚZ
                    </button>
                    <button className="btn btn--outline btn--sm" onClick={handleSelectAll} disabled={students.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={handleSelectAll}
                            disabled={students.length === 0}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: 'pointer' }}
                        />
                        Vybrat všechny
                    </button>
                    {selectedIds.length > 0 && (
                        <button className="btn btn--negative btn--sm" onClick={handleBulkDelete}>
                            <Icon icon={faTrash} /> Smazat vybrané ({selectedIds.length})
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                        className={`btn btn--lg${isEvaluating ? ' btn--eval-running' : (canEvaluate ? ' btn--police' : '')}`}
                        onClick={handleBatchEvaluate}
                        disabled={!canEvaluate}
                        style={{ minWidth: 200, position: 'relative', overflow: 'hidden' }}
                    >
                        {isEvaluating ? <span className="spinner spinner--sm spinner--white" /> : <Icon icon={faWandMagicSparkles} />}
                        <span>{(isEvaluating && canEvaluate) ? 'Přidat do fronty AI' : isEvaluating ? 'Vyhodnotit ÚZ' : 'Vyhodnotit označené ÚZ'}</span>
                        {isEvaluating && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, background: 'rgba(255,255,255,0.4)', width: `${evaluationProgress}%`, transition: 'width 0.3s' }} />
                        )}
                    </button>
                    {isEvaluating && (
                        <button className={`btn btn--negative btn--lg${isCancelling ? ' btn--disabled' : ''}`} onClick={handleCancelEvaluation} disabled={isCancelling}>
                            <Icon icon={faCircleXmark} /> {isCancelling ? 'Zastavuji...' : 'Zastavit'}
                        </button>
                    )}
                </div>
            </div>

            {/* Two-Column Layout */}
            <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 500, overflow: 'hidden' }}>
                {/* Left Column: Student Roster (35%) */}
                <div className="card" style={{ width: '35%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div className="card__header card__header--primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Seznam studentů</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{selectedIds.length}/{students.length}</span>
                    </div>
                    <div ref={studentListScrollRef} style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {students.length === 0 ? (
                            <div className="empty-state" style={{ padding: 16 }}>
                                Žádné nahrané soubory. Klikněte na "Nahrát ÚZ".
                            </div>
                        ) : students.map(student => (
                            <div
                                key={student.id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                                    background: selectedStudent === student.id ? 'var(--color-primary-light, rgba(15,82,125,0.08))' : 'transparent',
                                    border: `1px solid ${selectedStudent === student.id ? 'var(--color-primary)' : 'transparent'}`,
                                }}
                                onClick={() => setSelectedStudent(student.id)}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(student.id)}
                                    onChange={() => toggleStudent(student.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={student.is_approved === true}
                                    style={{ cursor: student.is_approved ? 'not-allowed' : 'pointer', opacity: student.is_approved ? 0.4 : 1 }}
                                />
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <p style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, lineHeight: 1.3, color: selectedStudent === student.id ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                            {(student.cleanedName || student.name).split(',')[0].replace(/^(rtn\.|stržm\.|pprap\.|prap\.|nrtm\.|por\.|npor\.|kpt\.|mjr\.|pplk\.|plk\.|genmjr\.|genpor\.|gen\.)\s+/i, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').trim()}
                                        </p>
                                        {!student.identita && student.status === 'evaluated' && (
                                            <Tooltip content="Identita studenta byla manuálně ověřena vyučujícím.">
                                                <Icon icon={faUserCheck} size="xs" style={{ color: 'var(--color-primary)' }} />
                                            </Tooltip>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        {student.status === 'evaluated' && !student.is_approved ? (
                                            <span className="badge badge--warning" style={{ fontSize: '0.7rem' }}>
                                                <Icon icon={faClock} size="xs" /> K revizi
                                            </span>
                                        ) : student.status === 'evaluated' && student.is_approved ? (
                                            <span className="badge badge--positive" style={{ fontSize: '0.7rem' }}>
                                                <Icon icon={faCircleCheck} size="xs" /> Schváleno
                                            </span>
                                        ) : student.status === 'evaluating' ? (
                                            <span className="badge badge--light" style={{ fontSize: '0.7rem' }}>
                                                <span className="spinner spinner--sm" /> Zpracovává se
                                            </span>
                                        ) : (
                                            <span className="badge badge--negative" style={{ fontSize: '0.7rem' }}>
                                                <Icon icon={faCircleExclamation} size="xs" /> Nezpracováno
                                            </span>
                                        )}
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger asChild>
                                                <button className="btn btn--sm btn--icon-only btn--outline" onClick={(e) => e.stopPropagation()} style={{ opacity: student.status === 'evaluating' ? 0.4 : 1 }}>
                                                    <Icon icon={faEllipsisVertical} />
                                                </button>
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Portal>
                                                <DropdownMenu.Content className="dropdown-content" sideOffset={5} align="end">
                                                    <DropdownMenu.Item className="dropdown-item" onSelect={() => handleRenameClick(student)}>
                                                        <Icon icon={faPencil} /> Upravit jméno
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item className="dropdown-item dropdown-item--danger" onSelect={(e) => handleDeleteStudent(student.id, e as unknown as React.MouseEvent)}>
                                                        <Icon icon={faTrash} /> Smazat ÚZ
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

                {/* Right Column: Evaluation Canvas (65%) */}
                <div style={{ width: '65%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
                    {activeStudentData && activeStudentData.status === 'evaluated' ? (
                        <>
                            {/* Student header */}
                            <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)' }}>
                                        <Icon icon={faUser} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            Hodnocení: {activeStudentData.identita?.prijmeni ? `${activeStudentData.identita.prijmeni.toUpperCase()} ${activeStudentData.identita.jmeno || ''}, ${activeStudentData.identita.hodnost || ''}` : activeStudentData.cleanedName || activeStudentData.name}
                                            {(!activeStudentData.identita && activeStudentData.status === 'evaluated') && (
                                                <Tooltip content="Identita studenta byla manuálně ověřena vyučujícím.">
                                                    <Icon icon={faUserCheck} size="xs" />
                                                </Tooltip>
                                            )}
                                        </h2>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>{scenarioName || 'Evaluováno dynamicky'}</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Celkové skóre</span>
                                    <div className="badge badge--primary" style={{ fontSize: '1rem', padding: '4px 12px' }}>
                                        {activeStudentData.score} / {activeStudentData.maxScore} b.
                                    </div>
                                </div>
                            </div>

                            {/* AI Evaluation Table */}
                            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div className="card__header card__header--primary" style={{ gap: 8 }}>
                                    <Icon icon={faWandMagicSparkles} />
                                    <span>Výsledky hodnocení AI aplikací EVALUZ</span>
                                </div>
                                <div ref={evalDetailScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-color)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'left', width: '25%' }}>Kritérium</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'center', width: 80 }}>Splněno</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'left' }}>Zdůvodnění</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'center', width: 80 }}>Body</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeStudentData.evaluationDetails?.map((detail, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', background: detail.upraveno_lektorem ? 'rgba(15,82,125,0.04)' : 'transparent' }}>
                                                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-primary)', verticalAlign: 'top' }}>
                                                        {detail.nazev}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'top' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                            {detail.body > 0 ? (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(23,135,84,0.12)', color: 'var(--color-positive)' }}>
                                                                    <Icon icon={faCircleCheck} size="sm" />
                                                                </span>
                                                            ) : (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(197,21,21,0.1)', color: 'var(--color-negative)' }}>
                                                                    <Icon icon={faCircleXmark} size="sm" />
                                                                </span>
                                                            )}
                                                            {detail.upraveno_lektorem && (
                                                                <Tooltip content="Zásah vyučujícího">
                                                                    <Icon icon={faGraduationCap} size="xs" style={{ color: 'var(--color-primary)' }} />
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', verticalAlign: 'top' }}>
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                                            <p style={{ lineHeight: 1.6, flex: 1, margin: 0 }}>{detail.oduvodneni}</p>
                                                            <Tooltip content="Zobrazit zdroj v textu studenta (AI Act Compliance)">
                                                                <button
                                                                    className="btn btn--sm btn--icon-only btn--outline"
                                                                    onClick={() => openSourceModal(detail.citace)}
                                                                    aria-label="Zobrazit zdroj v textu studenta"
                                                                    style={{ flexShrink: 0 }}
                                                                >
                                                                    <Icon icon={faCommentDots} />
                                                                </button>
                                                            </Tooltip>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'top' }}>
                                                        <input
                                                            type="number"
                                                            value={detail.body}
                                                            onChange={(e) => handleScoreChange(idx, parseInt(e.target.value, 10) || 0)}
                                                            disabled={!!activeStudentData.is_approved}
                                                            className="form-control"
                                                            style={{ width: 56, textAlign: 'center', padding: '4px 6px', fontSize: '0.85rem', fontWeight: 600 }}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Bottom Action Bar */}
                            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                        Zpětná vazba vyučujícího
                                    </label>
                                    <textarea
                                        className="form-control"
                                        value={activeStudentData.zpetna_vazba || ""}
                                        onChange={(e) => handleFeedbackChange(e.target.value)}
                                        disabled={!!activeStudentData.is_approved}
                                        placeholder="Zde uveďte celkové shrnutí a doporučení pro studenta..."
                                        style={{ resize: 'none', height: 120 }}
                                    />
                                </div>
                                {/* NCIKT pořadí: Negativní → Neutrální → Pozitivní */}
                                <div className="btn-group btn-group--end" style={{ alignItems: 'center' }}>
                                    {activeStudentData.isDirty && (
                                        <button className="btn btn--outline" onClick={handleSaveChanges} disabled={isSaving}>
                                            {isSaving ? <span className="spinner spinner--sm" /> : <Icon icon={faFloppyDisk} />}
                                            Uložit úpravy {activeStudentData.score} / {activeStudentData.maxScore} b.
                                        </button>
                                    )}
                                    {isRagEnabled && (
                                        <button
                                            className="btn btn--light"
                                            onClick={handleSaveGoldenExample}
                                            disabled={isSavingGolden}
                                            title="Uložit toto finální skvělé hodnocení do sady etalonů RAG paměti pro budoucí AI inference."
                                        >
                                            {isSavingGolden ? <span className="spinner spinner--sm" /> : <span>⭐</span>}
                                            Uložit jako Zlatý příklad
                                        </button>
                                    )}
                                    {!activeStudentData.is_approved ? (
                                        <button
                                            className="btn btn--secondary btn--lg"
                                            onClick={async () => {
                                                if (activeStudentData) {
                                                    try {
                                                        const approveRes = await fetch(`${API_BASE_URL}/analytics/evaluation/${activeStudentData.id}/approve`, {
                                                            method: 'PATCH',
                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                                                            body: JSON.stringify({ approved: true })
                                                        });
                                                        if (!approveRes.ok) throw new Error('Schválení selhalo');
                                                        setStudents(prev => prev.map(s => s.id === activeStudentData.id ? { ...s, is_approved: true } : s));
                                                        setToastMessage("Hodnocení schváleno.");
                                                        setTimeout(() => setToastMessage(null), 3000);
                                                        const combinedSubtitle = `${className || 'Neznámá třída'} - ${scenarioName || scenarioId || 'Neznámá situace'}`;
                                                        const res = await fetch(`${API_BASE_URL}/export/evaluation/${activeStudentData.id}/pdf?scenario_id=${encodeURIComponent(combinedSubtitle)}`, {
                                                            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                                                        });
                                                        if (!res.ok) throw new Error('PDF Export selhal');
                                                        const blob = await res.blob();
                                                        const url = window.URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = url;
                                                        a.download = `hodnoceni_${activeStudentData.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
                                                        document.body.appendChild(a); a.click();
                                                        window.URL.revokeObjectURL(url); document.body.removeChild(a);
                                                        await fetch(`${API_BASE_URL}/export/history`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
                                                            body: JSON.stringify({ scenario_name: scenarioId || 'Neznámý scénář', type: `PDF Hodnocení (${activeStudentData.name})`, download_url: `/api/v1/export/evaluation/${activeStudentData.id}/pdf` })
                                                        });
                                                    } catch (e: any) { console.error(e); showAlert(e.message); }
                                                }
                                            }}
                                        >
                                            <Icon icon={faShieldHalved} /> Schválit hodnocení ÚZ
                                        </button>
                                    ) : (
                                        <button
                                            className="btn btn--positive btn--lg"
                                            style={{ flexDirection: 'column', height: 'auto', padding: '8px 20px', gap: 2, lineHeight: 1.3 }}
                                            onClick={async () => {
                                                if (activeStudentData) {
                                                    try {
                                                        const combinedSubtitle = `${className || 'Neznámá třída'} - ${scenarioName || scenarioId || 'Neznámá situace'}`;
                                                        const res = await fetch(`${API_BASE_URL}/export/evaluation/${activeStudentData.id}/pdf?scenario_id=${encodeURIComponent(combinedSubtitle)}`, {
                                                            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                                                        });
                                                        if (!res.ok) throw new Error('PDF Export selhal');
                                                        const blob = await res.blob();
                                                        const url = window.URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = url;
                                                        a.download = `hodnoceni_${activeStudentData.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
                                                        document.body.appendChild(a); a.click();
                                                        window.URL.revokeObjectURL(url); document.body.removeChild(a);
                                                    } catch (e: any) { console.error(e); showAlert(e.message); }
                                                }
                                            }}
                                        >
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                                                <Icon icon={faCircleCheck} /> Vyhodnocení schváleno
                                            </span>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 400, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Icon icon={faDownload} size="xs" /> Znovu uložit PDF
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        title="Přejít nahoru — otevřít další hodnocení"
                                        onClick={() => studentListScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                                        style={{
                                            marginLeft: 8,
                                            width: 38, height: 38,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border-color)',
                                            background: 'var(--bg-surface-2)',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0,
                                            transition: 'background 0.15s, color 0.15s',
                                        }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-primary)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                                    >
                                        <Icon icon={faArrowUp} />
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="empty-state">
                                {activeStudentData && activeStudentData.status === 'pending' ? (
                                    <>
                                        <Icon icon={faHourglass} size="2x" />
                                        <h3>Čeká se na zahájení evaluace...</h3>
                                        <p>Vyberte studenty a klikněte na "Vyhodnotit označené ÚZ".</p>
                                    </>
                                ) : students.length === 0 ? (
                                    <>
                                        <Icon icon={faFileLines} size="2x" />
                                        <h3>Nahrajte úřední záznamy k vyhodnocení</h3>
                                        <p>Přetáhněte soubory (.docx, .pdf) do tohoto okna nebo použijte tlačítko "Nahrát ÚZ" vlevo nahoře.</p>
                                    </>
                                ) : selectedIds.length === 0 ? (
                                    <>
                                        <Icon icon={faSquareCheck} size="2x" />
                                        <h3>Záznamy nahrány. Nyní je vyberte.</h3>
                                        <p>Zaškrtněte políčka u studentů v levém sloupci, které chcete aktuálně vyhodnotit.</p>
                                    </>
                                ) : (
                                    <>
                                        <Icon icon={faCirclePlay} size="2x" />
                                        <h3>Připraveno k AI vyhodnocení</h3>
                                        <p>Klikněte na tlačítko "Vyhodnotit označené ÚZ" v horní liště.</p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* AI Act Source Modal */}
            {isSourceModalOpen && (
                <div className="modal-overlay" onClick={() => setIsSourceModalOpen(false)}>
                    <div className="modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal__header modal__header--primary">
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Icon icon={faShield} /> Zdrojová pasáž dokumentu
                            </span>
                            <button className="btn btn--sm btn--icon-only" style={{ background: 'transparent', border: 'none', color: '#fff' }} onClick={() => setIsSourceModalOpen(false)}>
                                <Icon icon={faXmark} />
                            </button>
                        </div>
                        <div className="modal__body" style={{ padding: 24 }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                                Níže je zobrazen text studenta. Zvýrazněná pasáž posloužila AI k rozhodnutí.
                            </p>
                            <div style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 6 }}>
                                <mark style={{ background: 'rgba(226,132,19,0.25)', padding: '0 3px', borderRadius: 2 }}>{activeSourceQuote}</mark>
                            </div>
                        </div>
                        <div className="modal__footer">
                            <div className="btn-group btn-group--end">
                                <button className="btn btn--outline" onClick={() => setIsSourceModalOpen(false)}>Zavřít</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

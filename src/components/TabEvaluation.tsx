import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Wand2, CheckCircle2, AlertCircle, User, MessageSquareQuote, Download, Shield, X, XCircle, Loader2 } from 'lucide-react';
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
}

export function TabEvaluation({ selectedStudent, setSelectedStudent }: TabEvaluationProps) {
    const [students, setStudents] = useState<Student[]>([]);
    const [selectAll, setSelectAll] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [activeSourceQuote, setActiveSourceQuote] = useState<string | null>(null);

    // Real API State
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationProgress, setEvaluationProgress] = useState(0);
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('http://localhost:8000/api/v1/analytics/class/1');
                if (res.ok) {
                    const data = await res.json();

                    const historyStudents: Student[] = data.map((evalRecord: any, index: number) => ({
                        id: 10000 + index,
                        name: evalRecord.jmeno_studenta,
                        status: 'evaluated',
                        score: evalRecord.celkove_skore,
                        maxScore: 25,
                        evaluationDetails: evalRecord.vysledky,
                        zpetna_vazba: evalRecord.zpetna_vazba
                    }));

                    if (historyStudents.length > 0) {
                        setStudents(historyStudents);
                        setSelectedStudent(historyStudents[0].id);
                    }
                }
            } catch (e) {
                console.error("Nepodařilo se načíst historii evaluací", e);
            }
        };
        fetchHistory();
    }, []);

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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files) as File[];
            setFiles(prev => [...prev, ...selectedFiles]);

            const newStudents: Student[] = selectedFiles.map((f, i) => {
                const cleanName = f.name.replace(/\.(docx|rtf|pdf)$/i, '');

                // Advanced parsing: Prijmeni_Jmeno_... -> Jmeno Prijmeni
                const parts = cleanName.split('_');
                let displayName = cleanName;
                if (parts.length >= 2) {
                    const surname = parts[0];
                    const firstName = parts[1];
                    // Basic heuristic: if both look like names (capitalize them)
                    displayName = `${firstName.charAt(0).toUpperCase() + firstName.slice(1)} ${surname.charAt(0).toUpperCase() + surname.slice(1)}`;
                }

                return {
                    id: Date.now() + i,
                    name: displayName,
                    status: 'pending',
                    score: 0,
                    maxScore: 25,
                };
            });
            setStudents(prev => [...newStudents, ...prev]);
            setSelectedIds(newStudents.map(s => s.id));
            if (newStudents.length > 0) setSelectedStudent(newStudents[0].id);
        }
    };

    const handleBatchEvaluate = async () => {
        if (selectedIds.length === 0 || files.length === 0) return;
        setIsEvaluating(true);
        setEvaluationProgress(0);

        const idsToProcess = [...selectedIds];
        let completedCount = 0;

        try {
            for (const id of idsToProcess) {
                const student = students.find(s => s.id === id);
                if (!student || student.status === 'evaluated') {
                    completedCount++;
                    setEvaluationProgress(Math.round((completedCount / idsToProcess.length) * 100));
                    continue;
                }

                // Update status to evaluating
                setStudents(current => current.map(s => s.id === id ? { ...s, status: 'evaluating' } : s));

                // Find corresponding file. Correlation by index is shaky, matching clean name parts
                const file = files.find(f => {
                    const cleanFileName = f.name.replace(/\.(docx|rtf|pdf)$/i, '').toLowerCase();
                    const studentNameLower = student.name.toLowerCase();
                    return cleanFileName.includes(studentNameLower) || studentNameLower.includes(cleanFileName) ||
                        (cleanFileName.split('_').length >= 2 && studentNameLower.includes(cleanFileName.split('_')[0].toLowerCase()));
                });

                if (!file) {
                    console.warn(`File for student ${student.name} not found.`);
                    setStudents(current => current.map(s => s.id === id ? { ...s, status: 'pending' } : s));
                    completedCount++;
                    setEvaluationProgress(Math.round((completedCount / idsToProcess.length) * 100));
                    continue;
                }

                const formData = new FormData();
                formData.append('files', file);

                const response = await fetch('http://localhost:8000/api/v1/evaluate/batch', {
                    method: 'POST',
                    body: formData,
                });

                if (response.ok) {
                    const data = await response.json();
                    const result = data.results[0]; // Since we send 1 file
                    if (result) {
                        setStudents(current => current.map(s => s.id === id ? {
                            ...s,
                            status: 'evaluated',
                            score: result.celkove_skore,
                            evaluationDetails: result.vysledky,
                            zpetna_vazba: result.zpetna_vazba
                        } : s));
                    }
                } else {
                    console.error(`Evaluation failed for ${student.name}`);
                    setStudents(current => current.map(s => s.id === id ? { ...s, status: 'pending' } : s));
                }

                completedCount++;
                setEvaluationProgress(Math.round((completedCount / idsToProcess.length) * 100));
            }
        } catch (error) {
            console.error("Batch evaluation failed", error);
            alert("Došlo k chybě při sekvenčním vyhodnocování.");
        } finally {
            setIsEvaluating(false);
            setEvaluationProgress(0);
        }
    };

    const activeStudentData = students.find(s => s.id === selectedStudent);

    return (
        <div className="h-full flex flex-col gap-6 max-w-[1400px] mx-auto">
            {/* Top Action Bar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
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
                </div>
                <button
                    onClick={handleBatchEvaluate}
                    disabled={isEvaluating || selectedIds.length === 0}
                    className={`flex flex-col items-center justify-center px-6 py-2.5 text-white rounded-lg transition-all text-sm font-bold shadow-md relative overflow-hidden min-w-[200px] ${isEvaluating || selectedIds.length === 0
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
            </div>

            {/* Two-Column Layout */}
            <div className="flex-1 flex gap-6 min-h-[500px]">
                {/* Left Column: Student Roster (25%) */}
                <div className="w-1/4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
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
                                className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer ${selectedStudent === student.id
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
                                <div className="flex-1 min-w-0 flex items-center justify-between">
                                    <p className={`text-sm font-medium truncate ${selectedStudent === student.id ? 'text-[#002855]' : 'text-slate-700'}`}>
                                        {student.name}
                                    </p>
                                    {student.status === 'evaluated' ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            <CheckCircle2 className="w-3 h-3" /> Zpracováno
                                        </span>
                                    ) : student.status === 'evaluating' ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                                            <Loader2 className="w-3 h-3 animate-spin" /> Vyhodnocuji
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                                            <AlertCircle className="w-3 h-3" /> Čeká
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column: The Full-Width Evaluation Canvas (75%) */}
                <div className="w-3/4 flex flex-col gap-4">
                    {activeStudentData && activeStudentData.status === 'evaluated' ? (
                        <>
                            {/* Header */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                        <User className="w-5 h-5 text-slate-500" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-[#002855]">Hodnocení: {activeStudentData.name}</h2>
                                        <p className="text-sm text-slate-500">MS2: Vstup do obydlí • Evaluováno dynamicky</p>
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
                                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-6 py-5 text-sm font-medium text-[#002855] align-top">
                                                        {detail.nazev}
                                                    </td>
                                                    <td className="px-6 py-5 text-center align-top">
                                                        {detail.splneno ? (
                                                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
                                                                <CheckCircle2 className="w-5 h-5" />
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 text-rose-700 shadow-sm">
                                                                <XCircle className="w-5 h-5" />
                                                            </span>
                                                        )}
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
                                                                defaultValue={detail.body}
                                                                className="w-14 text-center border border-slate-300 rounded-md py-1 text-sm font-medium focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] outline-none"
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
                                        defaultValue={activeStudentData.zpetna_vazba || ""}
                                    />
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => {
                                            if (activeStudentData) {
                                                window.open(`http://localhost:8000/api/v1/export/student/by-name/${encodeURIComponent(activeStudentData.name)}/pdf`, '_blank');
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
                            <AlertCircle className="w-12 h-12 mb-4 text-slate-300" />
                            {activeStudentData && activeStudentData.status === 'pending' ? (
                                <p className="text-lg font-medium text-slate-500">Čeká na zahájení evaluace...</p>
                            ) : (
                                <p className="text-lg font-medium text-slate-500">Nahrajte a vyberte .docx soubory k vyhodnocení</p>
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

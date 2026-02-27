import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Download, BarChart3, PieChart as PieChartIcon, Wand2, RefreshCw, AlertCircle, AlertTriangle, ExternalLink, X, CheckCircle2, FileText } from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts';

/**
 * Formát dat pro analytiku třídy z backendu
 */
interface AnalyticsData {
    stats: { name: string, full_name: string, success_rate: number, avg_score: number }[];
    top_errors: string[];
    ai_insight: string;
    score_distribution: { "0_50": number, "51_80": number, "81_100": number };
    average_score: number;
    max_score?: number;
    needs_help: string[];
    criterion_failures: Record<string, { id: number, name: string, oduvodneni: string }[]>;
    scenario_id?: string;
}

// Barevná paleta pro grafy (Semafor: Červená, Jantarová, Zelená)
const PIE_COLORS = ['#ef4444', '#f59e0b', '#10b981'];

interface TabAnalyticsProps {
    /** ID aktuálně vybrané modelové situace (scénáře) */
    scenarioId: string | null;
    /** Případná nacachovaná data pro okamžité zobrazení */
    cachedData?: any | null;
    /** Callback pro uložení dat do cache rodiče */
    onCacheData?: (data: any) => void;
    /** Callback pro navigaci na detail konkrétního studenta */
    onNavigateToStudent?: (studentId: number) => void;
}

/**
 * Komponenta pro zobrazení globální analýzy výsledků celé třídy.
 * Obsahuje interaktivní grafy (Recharts), AI doporučení a seznam studentů vyžadujících pomoc.
 */
export function TabAnalytics({ scenarioId, cachedData, onCacheData, onNavigateToStudent }: TabAnalyticsProps) {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCriterion, setSelectedCriterion] = useState<string | null>(null);
    const [previewStudentId, setPreviewStudentId] = useState<number | null>(null);
    const [previewStudentData, setPreviewStudentData] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    /**
     * Načte analytická data z API.
     * @param force - Pokud je true, vynutí přepočet na straně AI (ignoruje cache v DB)
     */
    const fetchAnalytics = async (force: boolean = false) => {
        setLoading(true);
        setError(null);
        try {
            let url = scenarioId
                ? `http://localhost:8000/api/v1/analytics/class/1/summary?scenario_id=${scenarioId}`
                : `http://localhost:8000/api/v1/analytics/class/1/summary`;

            if (force) {
                url += scenarioId ? '&force=true' : '?force=true';
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (!res.ok) throw new Error("Chyba při stahování analytiky");

            const json = await res.json();
            setData(json);

            // Uložení do cache pro plynulejší UX při přepínání tabů
            if (onCacheData) {
                onCacheData(json);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAnalytics();
    }, []);

    // Transformace dat pro koláčový graf rozložení skóre
    const pieData = data ? [
        { name: '0-50 %', value: data.score_distribution["0_50"] },
        { name: '51-80 %', value: data.score_distribution["51_80"] },
        { name: '81-100 %', value: data.score_distribution["81_100"] }
    ].filter(d => d.value > 0) : [];

    /**
     * Stáhne výsledky celé třídy v XLSX formátu (Excel).
     * Po stažení automaticky zaloguje akci do historie exportů.
     */
    const handleExportExcel = async () => {
        try {
            const url = scenarioId
                ? `http://localhost:8000/api/v1/export/class/1/excel?scenario_id=${scenarioId}`
                : `http://localhost:8000/api/v1/export/class/1/excel`;

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (!res.ok) throw new Error('Export selhal');
            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `vysledky_trida_1.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            document.body.removeChild(a);

            // Zápis úspěšného exportu do databáze historie
            await fetch('http://localhost:8000/api/v1/export/history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({
                    scenario_name: data?.scenario_id || scenarioId || 'Neznámý scénář',
                    type: 'Excel export (třída)',
                    download_url: `/api/v1/export/class/1/excel${scenarioId ? `?scenario_id=${scenarioId}` : ''}`
                })
            });
        } catch (e: any) {
            alert(e.message);
        }
    };

    /**
     * Otevře komplexní PDF report analýzy třídy v novém okně.
     * Zahrnuje grafy a AI texty vygenerované na backendu přes pyfpdf.
     */
    const handleExportPDF = async () => {
        const token = localStorage.getItem('upvsp_token');
        const finalScenarioId = data?.scenario_id || scenarioId || 'Neznámý_scénář';
        const url = `http://localhost:8000/api/v1/export/class-report/${finalScenarioId}?token=${token}`;
        window.open(url, '_blank');

        // Zápis exportu do historie
        try {
            await fetch('http://localhost:8000/api/v1/export/history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    scenario_name: finalScenarioId,
                    type: 'PDF analýza (třída)',
                    download_url: `/api/v1/export/class-report/${finalScenarioId}?token=${token}`
                })
            });
        } catch (e) { console.error("History log failed", e) }
    };

    /**
     * Načte a zobrazí rychlý detail výsledků studenta v modálním okně přímo v analytice.
     */
    const handlePreviewStudent = async (studentId: number) => {
        setPreviewStudentId(studentId);
        setPreviewLoading(true);
        try {
            const res = await fetch('http://localhost:8000/api/v1/analytics/class/1', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const students = await res.json();
                const targetStudent = students.find((s: any) => s.id === studentId);
                if (targetStudent) {
                    let parsedResults = [];
                    try {
                        const parsed = typeof targetStudent.json_result === 'string' ? JSON.parse(targetStudent.json_result) : targetStudent.json_result;
                        parsedResults = parsed.vysledky || [];
                    } catch (e) { }

                    setPreviewStudentData({
                        name: targetStudent.jmeno_studenta,
                        score: targetStudent.celkove_skore,
                        vysledky: parsedResults,
                        zpetna_vazba: targetStudent.zpetna_vazba
                    });
                }
            }
        } catch (e) {
            console.error("Nepodařilo se načíst detail studenta", e);
        } finally {
            setPreviewLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* HLAVIČKA A EXPORTNÍ TLAČÍTKA */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-semibold text-[#002855]">Globální analýza třídy</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        Agregovaná data a pedagogické statistiky
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => fetchAnalytics(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Aktualizovat
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={loading || !data}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm disabled:opacity-50"
                    >
                        <FileText className="w-4 h-4" />
                        Exportovat PDF report
                    </button>
                    <button
                        onClick={handleExportExcel}
                        className="flex items-center gap-2 px-4 py-2 bg-[#002855] text-white rounded-lg hover:bg-[#002855]/90 transition-colors text-sm font-medium shadow-sm disabled:opacity-50"
                        disabled={loading || !data}
                    >
                        <Download className="w-4 h-4 text-[#D4AF37]" />
                        Export do Excelu
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="w-full h-64 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-[#002855]">
                    <RefreshCw className="w-8 h-8 animate-spin mb-4" />
                    <p className="font-semibold">Generuji analýzu, AI čte výsledky třídy...</p>
                </div>
            ) : error ? (
                <div className="w-full p-6 bg-red-50 text-red-600 rounded-xl border border-red-200 flex items-center gap-3">
                    <AlertCircle className="w-6 h-6" />
                    <p className="font-medium">{error}</p>
                </div>
            ) : data && data.stats.length === 0 ? (
                <div className="w-full h-64 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400">
                    <AlertCircle className="w-12 h-12 mb-4 text-slate-300" />
                    <p className="text-lg font-medium text-slate-500">Zatím nebyly zpracovány žádné úřední záznamy</p>
                </div>
            ) : data ? (
                <>
                    {/* STATISTICKÉ KARTY (KPI) */}
                    <div className="grid grid-cols-3 gap-6">
                        {/* Průměrné skóre */}
                        <div className="col-span-1 bg-gradient-to-br from-[#002855] to-[#001a38] p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center text-white relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37] rounded-full mix-blend-multiply filter blur-2xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
                            <h4 className="font-semibold text-lg text-slate-100 mb-2 z-10">Průměrné Skóre Třídy</h4>
                            <div className="text-5xl font-bold tracking-tight z-10 text-[#D4AF37]">
                                {data.average_score} <span className="text-xl text-slate-300 font-normal">b.</span>
                            </div>
                        </div>

                        {/* Roster studentů vyžadujících pomoc */}
                        <div className="col-span-1 bg-red-50 p-6 rounded-xl border border-red-100 shadow-sm flex flex-col">
                            <div className="flex items-center gap-2 mb-4">
                                <AlertTriangle className="w-5 h-5 text-red-600" />
                                <h4 className="font-semibold text-red-700">Individuální pomoc ({data.needs_help?.length || 0})</h4>
                            </div>
                            <p className="text-sm text-red-600 mb-3">
                                Studenti s celkovým hodnocením pod 50 %, kteří mohou vyžadovat dodatečnou konzultaci.
                            </p>
                            <div className="flex-1 overflow-y-auto max-h-[160px] pr-2">
                                {data.needs_help && data.needs_help.length > 0 ? (
                                    <ul className="space-y-2">
                                        {data.needs_help.map((name, idx) => (
                                            <li key={idx} className="bg-white px-3 py-2 rounded-md shadow-sm text-sm border border-red-100 font-medium text-slate-700 flex justify-between items-center">
                                                <span>{name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-red-400/80 text-sm font-medium">
                                        Všichni studenti prospěli.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Koláčový graf rozložení ziskovosti */}
                        <div className="col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                            <div className="flex items-center gap-2 mb-4">
                                <PieChartIcon className="w-5 h-5 text-[#002855]" />
                                <h4 className="font-semibold text-[#002855]">Percentuální ziskovost (rozložení studentů)</h4>
                            </div>
                            <div className="flex-1 w-full h-full min-h-[160px] flex items-center justify-center">
                                {pieData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={160}>
                                        <PieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={45}
                                                outerRadius={65}
                                                paddingAngle={5}
                                                dataKey="value"
                                            >
                                                {pieData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip formatter={(value) => [value, 'Studentů']} />
                                            <Legend verticalAlign="middle" align="right" layout="vertical" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-slate-400 text-sm">Nedostatek dat pro graf</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {/* SLOUPCOVÝ GRAF ÚSPĚŠNOSTI DLOUHÝCH KRITÉRIÍ */}
                        <div className="col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="flex items-center gap-2 mb-6">
                                <BarChart3 className="w-5 h-5 text-[#002855]" />
                                <h4 className="font-semibold text-[#002855]">Úspěšnost jednotlivých kritérií</h4>
                            </div>
                            <div className="h-[500px] w-full relative -left-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.stats.map((s, i) => ({ ...s, shortLabel: `K${i + 1}`, fullLabel: `K${i + 1}: ${s.name}` }))} layout="vertical" margin={{ top: 5, right: 30, left: 30, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E2E8F0" />
                                        <XAxis type="number" domain={[0, 100]} unit=" %" />
                                        <YAxis dataKey="shortLabel" type="category" width={40} interval={0} tick={{ fontSize: 11, fill: '#1e293b', fontWeight: 600 }} />
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const pData = payload[0].payload;
                                                    return (
                                                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-md max-w-[250px] z-50">
                                                            <p className="font-semibold text-slate-800 text-sm mb-1 break-words">{pData.fullLabel}</p>
                                                            <p className="text-[#002855] font-medium text-sm">Splnilo: {pData.success_rate} %</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                            cursor={{ fill: '#F1F5F9' }}
                                        />
                                        <Bar
                                            dataKey="success_rate"
                                            radius={[0, 4, 4, 0]}
                                            barSize={20}
                                            onClick={(barData) => {
                                                // Filtrace "Rychlého náhledu" neúspěšných podle kliknutí na sloupec grafu
                                                const identifier = (barData as any).full_name;
                                                setSelectedCriterion(identifier === selectedCriterion ? null : identifier);
                                            }}
                                            cursor="pointer"
                                        >
                                            {data.stats.map((entry, index) => {
                                                const isActive = selectedCriterion === null || selectedCriterion === entry.full_name;
                                                const baseColor = entry.success_rate < 50 ? '#ef4444' : entry.success_rate < 80 ? '#f59e0b' : '#10b981';

                                                return <Cell key={`cell-${index}`} fill={baseColor} opacity={isActive ? 1 : 0.3} />;
                                            })}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* SEZNAM NEÚSPĚŠNÝCH VE FILTROVANÉM KRITÉRIU */}
                        {selectedCriterion && (
                            <div className="col-span-1 bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col mt-2">
                                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200">
                                    <h4 className="font-semibold text-[#002855] flex items-center gap-2">
                                        <AlertCircle className="w-5 h-5 text-[#f59e0b]" />
                                        Neúspěšní studenti v kritériu: <span className="text-slate-600 font-normal truncate max-w-sm ml-1" title={selectedCriterion}>{selectedCriterion}</span>
                                    </h4>
                                    <button onClick={() => setSelectedCriterion(null)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors" title="Zavřít filtr">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {data.criterion_failures && data.criterion_failures[selectedCriterion] && data.criterion_failures[selectedCriterion].length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2">
                                        {data.criterion_failures[selectedCriterion].map((student, idx) => (
                                            <div key={idx} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
                                                <div>
                                                    <h5 className="font-semibold text-slate-800 mb-1">{student.name}</h5>
                                                    <p className="text-sm text-slate-500 line-clamp-2 italic" title={student.oduvodneni}>
                                                        "{student.oduvodneni || 'Zdůvodnění chybí'}"
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handlePreviewStudent(student.id)}
                                                    className="mt-3 flex items-center justify-center gap-1.5 w-full py-1.5 text-sm font-medium text-[#002855] bg-blue-50 border border-blue-100 rounded-md hover:bg-[#002855] hover:text-white transition-colors"
                                                >
                                                    Rychlý náhled <ExternalLink className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                                        <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2 opacity-50" />
                                        <p>V tomto kritériu uspěli všichni studenti.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* AI PEDAGOGICKÁ DOPORUČENÍ (Analyzováno přes LLM) */}
                    <div className="bg-gradient-to-br from-[#002855] to-[#001a38] rounded-xl p-6 text-white shadow-md relative overflow-hidden mb-6">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37] rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
                        <div className="relative z-10 flex items-center gap-2 mb-2 text-[#D4AF37]">
                            <Wand2 className="w-6 h-6" />
                            <h4 className="font-semibold text-lg">Pedagogické shrnutí od AI Asistenta</h4>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {data.ai_insight.split('### ').filter(s => s.trim().length > 0).map((section, idx) => {
                            const lines = section.split('\n');
                            const title = lines[0].trim().replace(/\*\*/g, '');
                            const content = lines.slice(1).join('\n').trim();
                            return (
                                <div key={idx} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                                    <h5 className="font-bold text-slate-900 mb-4 text-lg border-b border-slate-100 pb-3">{title}</h5>
                                    <div className="text-slate-700 text-[14px] leading-relaxed flex-1 font-sans">
                                        <ReactMarkdown
                                            components={{
                                                p: ({ node, ...props }) => <p className="mb-3 last:mb-0" {...props} />,
                                                strong: ({ node, ...props }) => <strong className="font-bold text-slate-900" {...props} />,
                                                ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                                                li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                                ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />
                                            }}
                                        >
                                            {content}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : null}

            {/* RYCHLÝ NÁHLED MODÁL (Student v analytice) */}
            {previewStudentId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <div className="bg-white max-w-2xl w-full max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
                            <div>
                                <h3 className="text-lg font-bold text-[#002855]">
                                    {previewStudentData?.name || 'Načítání...'}
                                </h3>
                                {previewStudentData && (
                                    <p className="text-sm text-slate-500">
                                        Skóre: <span className="font-semibold text-slate-700">{previewStudentData.score} / {data.max_score || '?'} bodů</span>
                                    </p>
                                )}
                            </div>
                            <button onClick={() => { setPreviewStudentId(null); setPreviewStudentData(null); }} className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-white">
                            {previewLoading ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                                    <p className="text-slate-500">Načítám detail studenta...</p>
                                </div>
                            ) : previewStudentData ? (
                                <div className="space-y-6">
                                    <div>
                                        <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2">
                                            <Wand2 className="w-5 h-5 text-blue-600" />
                                            Zpětná vazba AI
                                        </h4>
                                        <div className="text-slate-700 text-sm leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100 font-sans">
                                            <ReactMarkdown
                                                components={{
                                                    strong: ({ node, ...props }) => <strong className="font-bold text-slate-900" {...props} />,
                                                }}
                                            >
                                                {previewStudentData.zpetna_vazba}
                                            </ReactMarkdown>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2">
                                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                                            Nesplněná kritéria
                                        </h4>
                                        <div className="space-y-2">
                                            {(previewStudentData.score >= (data.max_score || 0) && previewStudentData.vysledky.filter((v: any) => v.body === 0).length === 0) ? (
                                                <p className="text-emerald-600 font-medium">Student splnil všechna kritéria.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {previewStudentData.vysledky.filter((v: any) => v.body === 0).map((v: any, i: number) => (
                                                        <div key={i} className="bg-red-50 p-3 rounded-lg border border-red-100 text-sm">
                                                            <p className="font-semibold text-red-800 mb-1">{v.nazev}</p>
                                                            <p className="text-red-600">{v.oduvodneni}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12 text-slate-500">
                                    Detail se nepodařilo načíst.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

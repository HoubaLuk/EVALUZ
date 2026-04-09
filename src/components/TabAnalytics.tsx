import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { API_BASE_URL } from '../utils/api';

import {
    faDownload, faChartBar, faChartPie, faWandMagicSparkles, faRotate,
    faCircleExclamation, faTriangleExclamation, faArrowUpRightFromSquare,
    faXmark, faCircleCheck, faFileLines,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { useDialog } from '../contexts/DialogContext';
import { Doughnut, Bar } from 'react-chartjs-2';

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

// NCIKT semaforová paleta pro grafy
const PIE_COLORS = ['#c51515', '#e28413', '#178754'];

interface TabAnalyticsProps {
    /** ID aktuálně vybrané modelové situace (scénáře) */
    scenarioId: string | null;
    /** Zobrazovaný název třídy (např. "ZOP 01/2026") — pro B2 v Excelu a PDF */
    className?: string | null;
    /** Zobrazovaný název scénáře (např. "MS2: Vstup do obydlí") — pro B3 v Excelu a PDF */
    scenarioName?: string | null;
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
export function TabAnalytics({ scenarioId, className, scenarioName, cachedData, onCacheData, onNavigateToStudent }: TabAnalyticsProps) {
    const { showAlert } = useDialog();
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingApprovals, setPendingApprovals] = useState<{ count: number; total: number } | null>(null);
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
                ? `${API_BASE_URL}/analytics/class/1/summary?scenario_id=${scenarioId}`
                : `${API_BASE_URL}/analytics/class/1/summary`;

            if (force) {
                url += scenarioId ? '&force=true' : '?force=true';
            }

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (!res.ok) throw new Error("Chyba při stahování analytiky");

            const json = await res.json();

            // Man-in-the-Loop: backend vrací chybu pokud existují neschválené záznamy
            if (json.error === 'pending_approvals') {
                setData(null);
                setPendingApprovals({ count: json.pending_count, total: json.total_evaluated });
            } else {
                setData(json);
                setPendingApprovals(null);
                // Uložení do cache pro plynulejší UX při přepínání tabů
                if (onCacheData) {
                    onCacheData(json);
                }
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
            const baseUrl = `${API_BASE_URL}/export/class/1/excel`;
            const params = new URLSearchParams();
            if (scenarioId) params.set('scenario_id', scenarioId);
            if (className) params.set('class_name', className);
            if (scenarioName) params.set('scenario_display_name', scenarioName);
            const url = `${baseUrl}?${params.toString()}`;

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
            await fetch(`${API_BASE_URL}/export/history`, {
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
            showAlert(e.message);
        }
    };

    /**
     * Otevře komplexní PDF report analýzy třídy v novém okně.
     * Zahrnuje grafy a AI texty vygenerované na backendu přes pyfpdf.
     */
    const handleExportPDF = async () => {
        const token = localStorage.getItem('upvsp_token');
        const finalScenarioId = data?.scenario_id || scenarioId || 'Neznámý_scénář';
        const params = new URLSearchParams();
        if (className) params.set('class_name', className);
        if (scenarioName) params.set('scenario_display_name', scenarioName);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        const url = `${API_BASE_URL}/export/class-report/${encodeURIComponent(finalScenarioId)}${queryString}`;
        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(`Chyba při generování PDF: ${response.status}`);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `analyza_tridy_${finalScenarioId}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);
        } catch (e: any) {
            showAlert(e.message);
            return;
        }

        // Zápis exportu do historie
        try {
            await fetch(`${API_BASE_URL}/export/history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    scenario_name: finalScenarioId,
                    type: 'PDF analýza (třída)',
                    download_url: `/api/v1/export/class-report/${finalScenarioId}`
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
            const res = await fetch(`${API_BASE_URL}/analytics/class/1`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (res.ok) {
                const students = await res.json();
                const targetStudent = students.find((s: any) => s.id === studentId);
                if (targetStudent) {
                    // Přímo parsáci surového json_result pro zachování všech hodnot 'splneno'.
                    // Pydantic model može některé hodnoty změnit, proto jdeme přímo ke zdroji.
                    let parsedResults = [];
                    try {
                        const rawStr = targetStudent.json_result; // surovy string z DB
                        if (rawStr) {
                            const parsed = JSON.parse(rawStr);
                            parsedResults = parsed.vysledky || [];
                        }
                    } catch (e) {
                        // Fallback na Pydantic model pri chybě
                        parsedResults = targetStudent.vysledky || [];
                    }

                    const jmeno = targetStudent.identita?.prijmeni
                        ? `${targetStudent.identita.prijmeni} ${targetStudent.identita.jmeno || ''}`.trim()
                        : targetStudent.cleaned_name || targetStudent.jmeno_studenta;

                    setPreviewStudentData({
                        name: jmeno,
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

    // Chart.js data pro Doughnut
    const doughnutChartData = {
        labels: pieData.map(d => d.name),
        datasets: [{ data: pieData.map(d => d.value), backgroundColor: pieData.map((_, i) => PIE_COLORS[i % 3]), borderWidth: 0 }]
    };

    // Chart.js data pro horizontální Bar
    const barLabels = data?.stats.map((_, i) => `K${i + 1}`) ?? [];
    const barChartData = {
        labels: barLabels,
        datasets: [{
            data: data?.stats.map(s => s.success_rate) ?? [],
            backgroundColor: data?.stats.map(s => {
                const isActive = selectedCriterion === null || selectedCriterion === s.full_name;
                const base = s.success_rate < 50 ? '#c51515' : s.success_rate < 80 ? '#e28413' : '#178754';
                return isActive ? base : base + '4D';
            }) ?? [],
            borderWidth: 0,
            borderRadius: 3,
            barThickness: 18,
        }]
    };
    const barChartOptions = {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    title: (items: any) => {
                        const idx = items[0].dataIndex;
                        return `K${idx + 1}: ${data?.stats[idx]?.name || ''}`;
                    },
                    label: (item: any) => `Splnilo: ${item.raw} %`
                }
            }
        },
        scales: {
            x: { min: 0, max: 100, ticks: { callback: (v: any) => v + ' %' }, grid: { color: 'rgba(0,0,0,0.06)' } },
            y: { ticks: { font: { size: 11, weight: 600 as const } } }
        },
        onClick: (_: any, elements: any) => {
            if (elements.length > 0 && data) {
                const identifier = data.stats[elements[0].index].full_name;
                setSelectedCriterion(identifier === selectedCriterion ? null : identifier);
            }
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Man-in-the-Loop: Warning Banner */}
            {pendingApprovals ? (
                <div className="alert alert--warning" style={{ flexDirection: 'column', alignItems: 'center', padding: 40, textAlign: 'center', gap: 12, minHeight: 300, justifyContent: 'center' }}>
                    <Icon icon={faTriangleExclamation} size="3x" />
                    <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Analytika není dostupná</h2>
                    <p style={{ margin: 0, maxWidth: 480 }}>Analytika a exporty budou dostupné až po schválení všech záznamů ve studijní skupině.</p>
                    <div style={{ padding: '8px 24px', background: 'rgba(226,132,19,0.15)', border: '1px solid var(--color-warning)', borderRadius: 8, fontWeight: 700 }}>
                        <span style={{ fontSize: '1.5rem' }}>{pendingApprovals.count}</span> {pendingApprovals.count === 1 ? 'záznam čeká' : pendingApprovals.count < 5 ? 'záznamy čekají' : 'záznamů čeká'} na schválení
                        <span style={{ marginLeft: 4, opacity: 0.7 }}>(z {pendingApprovals.total} vyhodnocených)</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>Přejděte na kartu <strong>Vyhodnocení ÚZ</strong> a schvalte jednotlivá hodnocení.</p>
                </div>
            ) : (<>
            {/* Hlavička a exportní tlačítka */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Globální analýza třídy</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Agregovaná data a pedagogické statistiky</p>
                </div>
                <div className="btn-group">
                    <button className="btn btn--outline btn--sm" onClick={() => fetchAnalytics(true)} disabled={loading}>
                        <Icon icon={faRotate} spin={loading} /> Aktualizovat
                    </button>
                    <button className="btn btn--secondary btn--sm" onClick={handleExportPDF} disabled={loading || !data}>
                        <Icon icon={faFileLines} /> Exportovat PDF report
                    </button>
                    <button className="btn btn--primary btn--sm" onClick={handleExportExcel} disabled={loading || !data}>
                        <Icon icon={faDownload} /> Export do Excelu
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--color-primary)' }}>
                    <span className="spinner spinner--lg" />
                    <p style={{ margin: 0, fontWeight: 600 }}>Generuji analýzu, AI čte výsledky třídy...</p>
                </div>
            ) : error ? (
                <div className="alert alert--negative" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon icon={faCircleExclamation} /> <span>{error}</span>
                </div>
            ) : data && data.stats.length === 0 ? (
                <div className="card" style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="empty-state">
                        <Icon icon={faCircleExclamation} size="2x" />
                        <p>Zatím nebyly zpracovány žádné úřední záznamy</p>
                    </div>
                </div>
            ) : data ? (
                <>
                    {/* KPI karty */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                        {/* Průměrné skóre */}
                        <div className="kpi-card kpi-card--primary" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 140 }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 600, opacity: 0.8, marginBottom: 8 }}>Průměrné Skóre Třídy</span>
                            <div style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1 }}>
                                {data.average_score} <span style={{ fontSize: '1rem', fontWeight: 400, opacity: 0.7 }}>b.</span>
                            </div>
                        </div>

                        {/* Studenti vyžadující pomoc */}
                        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', borderLeft: '3px solid var(--color-negative)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                <Icon icon={faTriangleExclamation} style={{ color: 'var(--color-negative)' }} />
                                <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-negative)' }}>Individuální pomoc ({data.needs_help?.length || 0})</h4>
                            </div>
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>Studenti s celkovým hodnocením pod 50 %, kteří mohou vyžadovat konzultaci.</p>
                            <div style={{ flex: 1, overflowY: 'auto', maxHeight: 130 }}>
                                {data.needs_help && data.needs_help.length > 0 ? (
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {data.needs_help.map((name, idx) => (
                                            <li key={idx} style={{ padding: '5px 10px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', borderRadius: 5, fontSize: '0.82rem', fontWeight: 600 }}>{name}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Všichni studenti prospěli.</div>
                                )}
                            </div>
                        </div>

                        {/* Doughnut chart */}
                        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                <Icon icon={faChartPie} style={{ color: 'var(--color-primary)' }} />
                                <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary)' }}>Percentuální ziskovost</h4>
                            </div>
                            <div style={{ flex: 1, minHeight: 140 }}>
                                {pieData.length > 0 ? (
                                    <Doughnut
                                        data={doughnutChartData}
                                        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } }, cutout: '60%' }}
                                    />
                                ) : (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', marginTop: 20 }}>Nedostatek dat pro graf</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Sloupcový graf úspěšnosti kritérií */}
                    <div className="card" style={{ padding: 16, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                            <Icon icon={faChartBar} style={{ color: 'var(--color-primary)' }} />
                            <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary)' }}>Úspěšnost jednotlivých kritérií</h4>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>— kliknutím filtrujete studenty</span>
                        </div>
                        <div style={{ height: Math.max(300, data.stats.length * 28 + 40), width: '100%' }}>
                            <Bar data={barChartData} options={barChartOptions} />
                        </div>
                    </div>

                    {/* Seznam neúspěšných ve filtrovaném kritériu */}
                    {selectedCriterion && (
                        <div className="card" style={{ padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border-color)' }}>
                                <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Icon icon={faCircleExclamation} style={{ color: 'var(--color-warning)' }} />
                                    Neúspěšní v kritériu: <span style={{ fontWeight: 400, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360, marginLeft: 4 }} title={selectedCriterion}>{selectedCriterion}</span>
                                </h4>
                                <button className="btn btn--sm btn--icon-only btn--outline" onClick={() => setSelectedCriterion(null)} title="Zavřít filtr">
                                    <Icon icon={faXmark} />
                                </button>
                            </div>
                            {data.criterion_failures && data.criterion_failures[selectedCriterion]?.length > 0 ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxHeight: 280, overflowY: 'auto' }}>
                                    {data.criterion_failures[selectedCriterion].map((student, idx) => (
                                        <div key={idx} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
                                            <div>
                                                <h5 style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.85rem' }}>{student.name}</h5>
                                                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>"{student.oduvodneni || 'Zdůvodnění chybí'}"</p>
                                            </div>
                                            <button className="btn btn--outline btn--sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handlePreviewStudent(student.id)}>
                                                Rychlý náhled <Icon icon={faArrowUpRightFromSquare} size="xs" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="empty-state" style={{ padding: 20 }}>
                                    <Icon icon={faCircleCheck} style={{ color: 'var(--color-positive)' }} />
                                    <p>V tomto kritériu uspěli všichni studenti.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* AI pedagogická doporučení */}
                    <div className="card__header card__header--primary" style={{ borderRadius: 6, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon={faWandMagicSparkles} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>Pedagogické shrnutí od AI Asistenta</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                        {data.ai_insight.split('### ').filter(s => s.trim().length > 0).map((section, idx) => {
                            const lines = section.split('\n');
                            const title = lines[0].trim().replace(/\*\*/g, '');
                            const content = lines.slice(1).join('\n').trim();
                            return (
                                <div key={idx} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
                                    <h5 style={{ fontWeight: 700, fontSize: '0.95rem', margin: '0 0 10px', paddingBottom: 8, borderBottom: '1px solid var(--border-color)', color: 'var(--color-primary)' }}>{title}</h5>
                                    <div style={{ fontSize: '0.83rem', lineHeight: 1.7, color: 'var(--text-secondary)', flex: 1 }}>
                                        <ReactMarkdown
                                            components={{
                                                p: ({ node, ...props }) => <p style={{ marginBottom: 8 }} {...props} />,
                                                strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }} {...props} />,
                                                ul: ({ node, ...props }) => <ul style={{ paddingLeft: 18, marginBottom: 8 }} {...props} />,
                                                ol: ({ node, ...props }) => <ol style={{ paddingLeft: 18, marginBottom: 8 }} {...props} />,
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

            {/* Rychlý náhled modál */}
            {previewStudentId && (
                <div className="modal-overlay" onClick={() => { setPreviewStudentId(null); setPreviewStudentData(null); }}>
                    <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal__header modal__header--primary">
                            <div>
                                <span style={{ fontWeight: 700 }}>{previewStudentData?.name || 'Načítání...'}</span>
                                {previewStudentData && data && (
                                    <span style={{ fontSize: '0.8rem', opacity: 0.8, marginLeft: 8 }}>Skóre: {previewStudentData.score} / {data.max_score || '?'} bodů</span>
                                )}
                            </div>
                            <button className="btn btn--sm btn--icon-only" style={{ background: 'transparent', border: 'none', color: '#fff' }} onClick={() => { setPreviewStudentId(null); setPreviewStudentData(null); }}>
                                <Icon icon={faXmark} />
                            </button>
                        </div>
                        <div className="modal__body" style={{ padding: 20, overflowY: 'auto', maxHeight: '60vh' }}>
                            {previewLoading ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 }}>
                                    <span className="spinner spinner--lg" />
                                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>Načítám detail studenta...</p>
                                </div>
                            ) : previewStudentData ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div>
                                        <h4 style={{ fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}>
                                            <Icon icon={faWandMagicSparkles} /> Zpětná vazba AI
                                        </h4>
                                        <div style={{ fontSize: '0.85rem', lineHeight: 1.7, background: 'var(--bg-surface-2)', padding: 12, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                                            <ReactMarkdown components={{ strong: ({ node, ...props }) => <strong style={{ fontWeight: 700 }} {...props} /> }}>
                                                {previewStudentData.zpetna_vazba}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 style={{ fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Icon icon={faTriangleExclamation} style={{ color: 'var(--color-warning)' }} /> Nesplněná kritéria
                                        </h4>
                                        {(() => {
                                            const failed = previewStudentData.vysledky.filter((v: any) => v.splneno === false || (v.splneno == null && Number(v.body) === 0));
                                            if (failed.length === 0) return <p style={{ color: 'var(--color-positive)', fontWeight: 600, margin: 0 }}>Student splnil všechna kritéria.</p>;
                                            return (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {failed.map((v: any, i: number) => (
                                                        <div key={i} className="alert alert--negative" style={{ padding: '8px 12px' }}>
                                                            <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{v.nazev}</p>
                                                            <p style={{ margin: 0, fontSize: '0.82rem' }}>{v.oduvodneni || 'Bez zdůvodnění'}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Detail se nepodařilo načíst.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            </>)}
        </div>
    );
}

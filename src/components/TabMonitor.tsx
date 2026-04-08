import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';
import {
    faDownload, faPrint, faChartBar, faArrowTrendUp, faPersonChalkboard, faCircleCheck,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { Line, Bar } from 'react-chartjs-2';

interface StatisticsData {
    role: string;
    org_unit: string;
    total_evaluations: number;
    by_org_unit: { name: string, count: number }[];
    by_lecturer: { name: string, count: number }[];
    timeline: { date: string, count: number }[];
}

export function TabMonitor() {
    const [data, setData] = useState<StatisticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStatistics = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/statistics/dashboard`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (!res.ok) throw new Error("Chyba při stahování statistik nebo nedostatečná oprávnění.");
            const json = await res.json();
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatistics();
    }, []);

    const handleExportExcel = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/statistics/export/excel`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
            });
            if (!res.ok) throw new Error("Chyba při stahování Excelu.");
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `evaluz_statistiky_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="empty-state">
                <div className="spinner spinner--lg" style={{ color: 'var(--color-primary)' }} />
                <p>Načítám statistiky využití...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="empty-state">
                <div className="empty-state__icon" style={{ background: 'rgba(197,21,21,0.1)', color: 'var(--color-negative)' }}>
                    <Icon icon={faChartBar} size="2x" />
                </div>
                <h3 className="empty-state__title">Přístup odepřen</h3>
                <p className="empty-state__text">{error}</p>
            </div>
        );
    }

    if (!data) return null;

    // Chart.js — Timeline Line chart
    const lineChartData = {
        labels: data.timeline.map(d => d.date),
        datasets: [{
            label: 'Vyhodnoceno',
            data: data.timeline.map(d => d.count),
            borderColor: '#0f527d',
            backgroundColor: 'rgba(15,82,125,0.08)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBorderWidth: 2,
            tension: 0.3,
            fill: true,
        }]
    };
    const lineChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { font: { size: 12 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 12 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
        },
    };

    // Chart.js — Org unit horizontal Bar chart
    const orgBarData = {
        labels: data.by_org_unit.map(d => d.name),
        datasets: [{
            label: 'Počet ÚZ',
            data: data.by_org_unit.map(d => d.count),
            backgroundColor: '#13689f',
            borderWidth: 0,
            borderRadius: 3,
            barThickness: 20,
        }]
    };

    // Chart.js — Lecturer horizontal Bar chart
    const lecBarData = {
        labels: data.by_lecturer.slice(0, 10).map(d => d.name),
        datasets: [{
            label: 'Počet ÚZ',
            data: data.by_lecturer.slice(0, 10).map(d => d.count),
            backgroundColor: '#0f527d',
            borderWidth: 0,
            borderRadius: 3,
            barThickness: 20,
        }]
    };

    const hBarOptions = {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { beginAtZero: true, ticks: { precision: 0, font: { size: 12 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
            y: { ticks: { font: { size: 11 } } },
        },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', padding: '1rem 0' }}>
            {/* Header Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>
                        <Icon icon={faPersonChalkboard} />
                        Statistiky evaluací EVALUZ
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Metriky využití pro: <strong style={{ color: 'var(--text-primary)' }}>{data.org_unit}</strong> ({data.role.toUpperCase()})
                    </p>
                </div>
                <div className="btn-group">
                    <button onClick={handlePrint} className="btn btn--outline btn--sm">
                        <Icon icon={faPrint} /> Tisk do PDF
                    </button>
                    <button onClick={handleExportExcel} className="btn btn--primary btn--sm">
                        <Icon icon={faDownload} /> Exportovat do Excelu
                    </button>
                </div>
            </div>

            {/* Print Header */}
            <div className="print-only" style={{ textAlign: 'center', display: 'none' }}>
                <h1>Statistiky využití EVALUZ</h1>
                <p>Rozsah: {data.org_unit} | Vygenerováno: {new Date().toLocaleDateString('cs-CZ')}</p>
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
                <div className="kpi-card kpi-card--primary">
                    <div className="kpi-card__label">Celkem vyhodnocených ÚZ</div>
                    <div className="kpi-card__value">{data.total_evaluations}</div>
                    <div className="kpi-card__sub">
                        <span className="badge badge--positive">
                            <Icon icon={faArrowTrendUp} /> Historický úhrn
                        </span>
                    </div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-card__label">Aktivních vyučujících</div>
                    <div className="kpi-card__value">{data.by_lecturer.length}</div>
                </div>

                <div className="kpi-card">
                    <div className="kpi-card__label">Nejaktivnější org. článek</div>
                    <div className="kpi-card__value" style={{ fontSize: '1.4rem' }}>
                        {data.by_org_unit.length > 0 ? data.by_org_unit[0].name : 'Žádná data'}
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem' }}>
                {/* Timeline Line Chart */}
                <div className="card">
                    <div className="card__header">
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Icon icon={faArrowTrendUp} style={{ color: 'var(--color-warning)' }} />
                            Aktivita v čase (Počet ÚZ za den)
                        </span>
                    </div>
                    <div className="card__body">
                        {data.timeline.length > 0 ? (
                            <div style={{ height: '260px' }}>
                                <Line data={lineChartData} options={lineChartOptions} />
                            </div>
                        ) : (
                            <div className="empty-state" style={{ minHeight: '160px' }}>
                                <p className="empty-state__text">Zatím žádná data na časové ose.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* By Org Unit Bar Chart — superadmin only */}
                {data.role === 'superadmin' && (
                    <div className="card">
                        <div className="card__header">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Icon icon={faChartBar} style={{ color: 'var(--color-warning)' }} />
                                Zátěž podle organizačních článků
                            </span>
                        </div>
                        <div className="card__body">
                            {data.by_org_unit.length > 0 ? (
                                <div style={{ height: Math.max(200, data.by_org_unit.length * 32 + 40) + 'px' }}>
                                    <Bar data={orgBarData} options={hBarOptions} />
                                </div>
                            ) : (
                                <div className="empty-state" style={{ minHeight: '160px' }}>
                                    <p className="empty-state__text">Žádná data pro organizační články.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* By Lecturer Bar Chart — admin only */}
                {data.role === 'admin' && (
                    <div className="card">
                        <div className="card__header">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Icon icon={faChartBar} style={{ color: 'var(--color-warning)' }} />
                                Aktivita garantů (Počet ÚZ)
                            </span>
                        </div>
                        <div className="card__body">
                            {data.by_lecturer.length > 0 ? (
                                <div style={{ height: Math.max(200, Math.min(data.by_lecturer.length, 10) * 32 + 40) + 'px' }}>
                                    <Bar data={lecBarData} options={hBarOptions} />
                                </div>
                            ) : (
                                <div className="empty-state" style={{ minHeight: '160px' }}>
                                    <p className="empty-state__text">Zatím žádní vyhodnocující lektoři.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Lecturer Table */}
            <div className="card">
                <div className="card__header card__header--primary">
                    <Icon icon={faCircleCheck} />
                    Vyučující (Garanti)
                </div>
                <div className="card__body" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface-2)' }}>
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                                    Jméno vyučujícího
                                </th>
                                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                                    Vyhodnocených ÚZ
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.by_lecturer.map((lec, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{lec.name}</td>
                                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{lec.count}</td>
                                </tr>
                            ))}
                            {data.by_lecturer.length === 0 && (
                                <tr>
                                    <td colSpan={2} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        Žádná data pro zobrazení
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <style>{`
                @media print {
                    @page { margin: 1cm; size: landscape; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .print-only { display: block !important; }
                }
            `}</style>
        </div>
    );
}

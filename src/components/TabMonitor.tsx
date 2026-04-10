import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';
import {
    faDownload, faPrint, faChartBar, faArrowTrendUp, faPersonChalkboard, faCircleCheck,
    faFilter, faRotate,
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

interface FilterOptions {
    facilities: string[];
    classes: { id: number; name: string }[];
    scenarios: { id: string; name: string }[];
}

export function TabMonitor() {
    const [data, setData] = useState<StatisticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filtrační stav
    const [filterOptions, setFilterOptions] = useState<FilterOptions>({ facilities: [], classes: [], scenarios: [] });
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [facility, setFacility] = useState('');
    const [classId, setClassId] = useState('');
    const [scenarioName, setScenarioName] = useState('');

    // Načti dostupné volby pro dropdowny (třídy, scénáře, VZ)
    useEffect(() => {
        const fetchFilterOptions = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/statistics/filter-options`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
                });
                if (res.ok) setFilterOptions(await res.json());
            } catch { /* tichá chyba — filtry jen nebudou nabídnuty */ }
        };
        fetchFilterOptions();
    }, []);

    const fetchStatistics = async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (startDate)    params.set('start_date', startDate);
            if (endDate)      params.set('end_date', endDate);
            if (facility)     params.set('facility', facility);
            if (classId)      params.set('class_id', classId);
            if (scenarioName) params.set('scenario_name', scenarioName);
            const query = params.toString() ? `?${params.toString()}` : '';

            const res = await fetch(`${API_BASE_URL}/statistics/dashboard${query}`, {
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

    const handleResetFilters = () => {
        setStartDate('');
        setEndDate('');
        setFacility('');
        setClassId('');
        setScenarioName('');
        // Reload bez filtrů — fetchStatistics bude mít stará state values, proto fetch přímo
        setLoading(true);
        setError(null);
        fetch(`${API_BASE_URL}/statistics/dashboard`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
        }).then(r => r.ok ? r.json() : Promise.reject()).then(json => setData(json))
          .catch(() => setError("Chyba při stahování statistik."))
          .finally(() => setLoading(false));
    };

    const handleExportExcel = async () => {
        try {
            const params = new URLSearchParams();
            if (startDate)    params.set('start_date', startDate);
            if (endDate)      params.set('end_date', endDate);
            if (facility)     params.set('facility', facility);
            if (classId)      params.set('class_id', classId);
            if (scenarioName) params.set('scenario_name', scenarioName);
            const query = params.toString() ? `?${params.toString()}` : '';
            const res = await fetch(`${API_BASE_URL}/statistics/export/excel${query}`, {
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

    // Inline loading/error — filtry zůstanou viditelné (vykreslí se níže v hlavním returnu)
    const contentArea = loading ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
            <div className="spinner spinner--lg" style={{ color: 'var(--color-primary)' }} />
            <p>Načítám statistiky...</p>
        </div>
    ) : error ? (
        <div className="empty-state" style={{ minHeight: 200 }}>
            <div className="empty-state__icon" style={{ background: 'rgba(197,21,21,0.1)', color: 'var(--color-negative)' }}>
                <Icon icon={faChartBar} size="2x" />
            </div>
            <h3 className="empty-state__title">Přístup odepřen</h3>
            <p className="empty-state__text">{error}</p>
        </div>
    ) : null;

    // Chart.js — Timeline Line chart (pouze pokud máme data)
    const lineChartData = data ? {
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
    } : null;
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
    const orgBarData = data ? {
        labels: data.by_org_unit.map(d => d.name),
        datasets: [{
            label: 'Počet ÚZ',
            data: data.by_org_unit.map(d => d.count),
            backgroundColor: '#13689f',
            borderWidth: 0,
            borderRadius: 3,
            barThickness: 20,
        }]
    } : null;

    // Chart.js — Lecturer horizontal Bar chart
    const lecBarData = data ? {
        labels: data.by_lecturer.slice(0, 10).map(d => d.name),
        datasets: [{
            label: 'Počet ÚZ',
            data: data.by_lecturer.slice(0, 10).map(d => d.count),
            backgroundColor: '#0f527d',
            borderWidth: 0,
            borderRadius: 3,
            barThickness: 20,
        }]
    } : null;

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
                    {data && (
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            Metriky využití pro: <strong style={{ color: 'var(--text-primary)' }}>{data.org_unit}</strong> ({data.role.toUpperCase()})
                        </p>
                    )}
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

            {/* Filter Panel */}
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                    <Icon icon={faFilter} style={{ color: 'var(--color-warning)', fontSize: '0.85rem' }} />
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filtry</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    {/* Datum od */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Datum od</label>
                        <input type="date" className="form-control form-control--sm"
                            value={startDate} onChange={e => setStartDate(e.target.value)}
                            style={{ width: '100%' }} />
                    </div>
                    {/* Datum do */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Datum do</label>
                        <input type="date" className="form-control form-control--sm"
                            value={endDate} onChange={e => setEndDate(e.target.value)}
                            style={{ width: '100%' }} />
                    </div>
                    {/* Vzdělávací zařízení — pouze superadmin */}
                    {filterOptions.facilities.length > 0 && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Vzdělávací zařízení</label>
                            <select className="form-control form-control--sm" value={facility}
                                onChange={e => setFacility(e.target.value)} style={{ width: '100%' }}>
                                <option value="">Všechna zařízení</option>
                                {filterOptions.facilities.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                    )}
                    {/* Třída */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Třída</label>
                        <select className="form-control form-control--sm" value={classId}
                            onChange={e => setClassId(e.target.value)} style={{ width: '100%' }}>
                            <option value="">Všechny třídy</option>
                            {filterOptions.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    {/* Modelová situace */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Modelová situace</label>
                        <select className="form-control form-control--sm" value={scenarioName}
                            onChange={e => setScenarioName(e.target.value)} style={{ width: '100%' }}>
                            <option value="">Všechny MS</option>
                            {filterOptions.scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    {/* Tlačítka */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn--primary btn--sm" style={{ flex: 1 }} onClick={fetchStatistics} disabled={loading}>
                            <Icon icon={faFilter} /> Filtrovat
                        </button>
                        <button className="btn btn--outline btn--sm" onClick={handleResetFilters} disabled={loading} title="Resetovat filtry">
                            <Icon icon={faRotate} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Print Header */}
            <div className="print-only" style={{ textAlign: 'center', display: 'none' }}>
                <h1>Statistiky využití EVALUZ</h1>
                <p>Rozsah: {data?.org_unit} | Vygenerováno: {new Date().toLocaleDateString('cs-CZ')}</p>
            </div>

            {/* Loading / Error inline — filtry zůstávají viditelné */}
            {contentArea}

            {/* KPI Cards */}
            {!loading && !error && data && (<>
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
                                <Line data={lineChartData!} options={lineChartOptions} />
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
                                    <Bar data={orgBarData!} options={hBarOptions} />
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
                                    <Bar data={lecBarData!} options={hBarOptions} />
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
            </>)}
        </div>
    );
}

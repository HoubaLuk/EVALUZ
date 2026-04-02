import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../utils/api';
import { ClassData } from '../types';
import { Download, Printer, BarChart3, TrendingUp, Presentation, CheckCircle2, AlertTriangle, Filter } from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    LineChart,
    Line,
} from 'recharts';

/* ── Types ──────────────────────────────────────────────── */

interface AvgScoreGroup {
    name: string;
    avg_pct: number;
}

interface TopFailure {
    nazev: string;
    failure_rate: number;
    failure_count: number;
    total: number;
}

interface StatisticsData {
    role: string;
    org_unit: string;
    total_evaluations: number;
    by_org_unit: { name: string; count: number }[];
    by_lecturer: { name: string; count: number }[];
    timeline: { date: string; count: number }[];
    avg_score_by_group: AvgScoreGroup[];
    top_failures: TopFailure[];
}

interface FilterOptions {
    facilities: string[];
    classes: { id: number; name: string }[];
    scenarios: { id: string; name: string }[];
}

interface DashboardFilters {
    start_date: string;
    end_date: string;
    facility: string;
    class_id: string;
    scenario_name: string;
}

/* ── Component ──────────────────────────────────────────── */

interface TabMonitorProps {
    classes?: ClassData[];
}

export function TabMonitor({ classes = [] }: TabMonitorProps) {
    const [data, setData] = useState<StatisticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filters, setFilters] = useState<DashboardFilters>({
        start_date: '', end_date: '', facility: '', class_id: '', scenario_name: ''
    });
    const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

    const authHeaders = { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` };

    // Build scenarioId → display name map from localStorage classes
    const localScenarioMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const cls of classes) {
            for (const scen of cls.scenarios ?? []) {
                if (scen.id && scen.name) map[scen.id] = scen.name;
            }
        }
        return map;
    }, [classes]);

    // Friendly fallback for IDs that have no known display name
    const formatScenarioId = (id: string): string => {
        // Timestamp-based IDs like "scen-1772714710955-0.248..." → label as archival
        if (/^scen-\d{10,}/.test(id)) return `Archivní MS`;
        return id;
    };

    const buildQueryString = useCallback((f: DashboardFilters): string => {
        const params = new URLSearchParams();
        if (f.start_date) params.set('start_date', f.start_date);
        if (f.end_date) params.set('end_date', f.end_date);
        if (f.facility) params.set('facility', f.facility);
        if (f.class_id) params.set('class_id', f.class_id);
        if (f.scenario_name) params.set('scenario_name', f.scenario_name);
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }, []);

    // Raw filter options from backend (scenarios with IDs only)
    const [rawFilterOptions, setRawFilterOptions] = useState<{ facilities: string[]; classes: { id: number; name: string }[]; scenarios: { id: string; name: string }[] } | null>(null);

    // Sync all localStorage classes to DB, then fetch filter-options
    // Re-runs when classes change (e.g. new class created while stats tab is open)
    useEffect(() => {
        const token = localStorage.getItem('upvsp_token');
        const doFetch = () => {
            fetch(`${API_BASE_URL}/statistics/filter-options`, { headers: authHeaders })
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(data => setRawFilterOptions(data))
                .catch(() => {});
        };

        if (!token || classes.length === 0) {
            doFetch();
            return;
        }

        // Ensure all localStorage classes exist in DB, then refresh filter options
        Promise.all(
            classes.map(cls =>
                fetch(`${API_BASE_URL}/evaluate/classes/ensure`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ name: cls.name })
                }).catch(() => {})
            )
        ).then(doFetch);
    }, [classes]);

    // Re-enrich whenever raw options or localScenarioMap changes
    useEffect(() => {
        if (!rawFilterOptions) return;

        // Enrich backend scenarios with display names
        const enrichedScenarios = rawFilterOptions.scenarios.map(s => {
            // s.name may equal s.id when backend has no display name (its own fallback)
            const backendName = s.name && s.name !== s.id ? s.name : '';
            return {
                id: s.id,
                name: localScenarioMap[s.id] || backendName || formatScenarioId(s.id),
            };
        });

        // Add localStorage scenarios that aren't in the backend response yet (no evaluations yet)
        const backendIds = new Set(rawFilterOptions.scenarios.map(s => s.id));
        const localOnlyScenarios: { id: string; name: string }[] = [];
        for (const cls of classes) {
            for (const scen of cls.scenarios ?? []) {
                if (scen.id && scen.name && !backendIds.has(scen.id)) {
                    localOnlyScenarios.push({ id: scen.id, name: scen.name });
                }
            }
        }

        setFilterOptions({
            ...rawFilterOptions,
            scenarios: [...enrichedScenarios, ...localOnlyScenarios],
        });
    }, [rawFilterOptions, localScenarioMap, classes]);

    // Fetch dashboard data whenever filters change
    const fetchStatistics = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const qs = buildQueryString(filters);
            const res = await fetch(`${API_BASE_URL}/statistics/dashboard${qs}`, { headers: authHeaders });
            if (!res.ok) throw new Error("Chyba při stahování statistik nebo nedostatečná oprávnění.");
            const json = await res.json();
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [filters, buildQueryString]);

    useEffect(() => {
        fetchStatistics();
    }, [fetchStatistics]);

    const handleExportExcel = async () => {
        try {
            const qs = buildQueryString(filters);
            const res = await fetch(`${API_BASE_URL}/statistics/export/excel${qs}`, { headers: authHeaders });
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

    const updateFilter = (key: keyof DashboardFilters, value: string) => {
        setFilters(f => ({ ...f, [key]: value }));
    };

    /* ── Select styling ───────────────────────────────────── */
    const selectClass = "w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#002855] outline-none bg-white dark:bg-slate-800 text-slate-800 dark:text-white";
    const labelClass = "block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1";

    /* ── Loading / Error states ────────────────────────────── */

    if (loading && !data) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center h-full text-slate-500">
                <BarChart3 className="w-8 h-8 animate-pulse mb-4 text-[#002855]" />
                <p>Načítám statistiky využití...</p>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 shadow-sm border border-red-200">
                    <BarChart3 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Přístup odepřen</h3>
                <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="flex flex-col h-full overflow-y-auto print:bg-white print:text-black">
            {/* Header Actions */}
            <div className="flex justify-between items-center mb-6 print:hidden">
                <div>
                    <h2 className="text-2xl font-bold text-[#002855] dark:text-white flex items-center gap-2">
                        <Presentation className="w-6 h-6 text-[#D4AF37]" />
                        Statistiky evaluací EVALUZ
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Metriky využití pro: <strong className="text-slate-700 dark:text-slate-300">{data.org_unit}</strong> ({data.role.toUpperCase()})
                    </p>
                </div>
                <div className="flex gap-3">
                    <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm text-sm font-medium">
                        <Printer className="w-4 h-4" />
                        Tisk do PDF
                    </button>
                    <button onClick={handleExportExcel} className="flex items-center gap-2 px-4 py-2 bg-[#002855] text-white rounded-lg hover:bg-[#001f44] transition shadow-sm text-sm font-medium">
                        <Download className="w-4 h-4" />
                        Exportovat do Excelu
                    </button>
                </div>
            </div>

            {/* ── Filter Panel ─────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-6 shadow-sm print:hidden">
                <div className="flex items-center gap-2 mb-3">
                    <Filter className="w-4 h-4 text-[#D4AF37]" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Filtry</span>
                    {(filters.start_date || filters.end_date || filters.facility || filters.class_id || filters.scenario_name) && (
                        <button
                            onClick={() => setFilters({ start_date: '', end_date: '', facility: '', class_id: '', scenario_name: '' })}
                            className="ml-auto text-xs text-[#002855] dark:text-blue-400 hover:underline font-medium"
                        >
                            Zrušit filtry
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    {/* Date from */}
                    <div>
                        <label className={labelClass}>Datum od</label>
                        <input
                            type="date"
                            value={filters.start_date}
                            onChange={e => updateFilter('start_date', e.target.value)}
                            className={selectClass}
                        />
                    </div>
                    {/* Date to */}
                    <div>
                        <label className={labelClass}>Datum do</label>
                        <input
                            type="date"
                            value={filters.end_date}
                            onChange={e => updateFilter('end_date', e.target.value)}
                            className={selectClass}
                        />
                    </div>
                    {/* Facility — superadmin only */}
                    {filterOptions && filterOptions.facilities.length > 0 && (
                        <div>
                            <label className={labelClass}>Vzdělávací zařízení</label>
                            <select
                                value={filters.facility}
                                onChange={e => updateFilter('facility', e.target.value)}
                                className={selectClass}
                            >
                                <option value="">Všechna zařízení</option>
                                {filterOptions.facilities.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {/* Class */}
                    <div>
                        <label className={labelClass}>Třída</label>
                        <select
                            value={filters.class_id}
                            onChange={e => updateFilter('class_id', e.target.value)}
                            className={selectClass}
                        >
                            <option value="">Všechny třídy</option>
                            {filterOptions?.classes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    {/* Scenario */}
                    <div>
                        <label className={labelClass}>Modelová situace</label>
                        <select
                            value={filters.scenario_name}
                            onChange={e => updateFilter('scenario_name', e.target.value)}
                            className={selectClass}
                        >
                            <option value="">Všechny MS</option>
                            {filterOptions?.scenarios.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Print Header */}
            <div className="hidden print:block mb-8 text-center">
                <h1 className="text-3xl font-bold text-[#002855]">Statistiky využití EVALUZ</h1>
                <p className="text-gray-600">Rozsah: {data.org_unit} | Vygenerováno: {new Date().toLocaleDateString('cs-CZ')}</p>
            </div>

            {/* Loading overlay when refetching with existing data */}
            {loading && (
                <div className="flex items-center gap-2 mb-4 text-sm text-slate-500 dark:text-slate-400">
                    <BarChart3 className="w-4 h-4 animate-pulse" />
                    Přepočítávám...
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col print:border-gray-300">
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Celkem vyhodnocených ÚZ</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-[#002855] dark:text-white">{data.total_evaluations}</span>
                        <span className="text-sm text-emerald-600 font-medium flex items-center bg-emerald-50 px-2 py-0.5 rounded-full">
                            <TrendingUp className="w-3 h-3 mr-1" />
                            Historický úhrn
                        </span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col print:border-gray-300">
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Aktivních vyučujících</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-[#002855] dark:text-white">{data.by_lecturer.length}</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col print:border-gray-300">
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Nejaktivnější org. článek</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-[#002855] dark:text-[#facc15] truncate">
                            {data.by_org_unit.length > 0 ? data.by_org_unit[0].name : "Žádná data"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Timeline Line Chart */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm print:break-inside-avoid">
                    <h3 className="font-semibold text-lg text-[#002855] dark:text-white mb-6 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-[#D4AF37]" />
                        Aktivita v čase (Počet ÚZ za den)
                    </h3>
                    <div className="h-64">
                        {data.timeline.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data.timeline}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tick={{fontSize: 12}} tickMargin={10} stroke="#94a3b8" />
                                    <YAxis allowDecimals={false} tick={{fontSize: 12}} stroke="#94a3b8" />
                                    <RechartsTooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Line type="monotone" dataKey="count" name="Vyhodnoceno" stroke="#002855" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6, fill: '#D4AF37'}} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400 text-sm">Zatím žádná data na časové ose.</div>
                        )}
                    </div>
                </div>

                {/* By Org Unit Bar Chart */}
                {data.role === 'superadmin' && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm print:break-inside-avoid">
                        <h3 className="font-semibold text-lg text-[#002855] dark:text-white mb-6 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
                            Zátěž podle organizačních článků
                        </h3>
                        <div className="h-64">
                            {data.by_org_unit.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.by_org_unit} layout="vertical" margin={{ left: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" allowDecimals={false} stroke="#94a3b8" />
                                        <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} stroke="#94a3b8" />
                                        <RechartsTooltip
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                        <Bar dataKey="count" name="Počet ÚZ" fill="#D4AF37" radius={[0, 4, 4, 0]} barSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-slate-400 text-sm">Žádná data pro organizační články.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* By Lecturer Bar Chart (For Admin view) */}
                {data.role === 'admin' && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm print:break-inside-avoid">
                        <h3 className="font-semibold text-lg text-[#002855] dark:text-white mb-6 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
                            Aktivita garantů (Počet ÚZ)
                        </h3>
                        <div className="h-64">
                            {data.by_lecturer.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.by_lecturer.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                        <XAxis type="number" allowDecimals={false} stroke="#94a3b8" />
                                        <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} stroke="#94a3b8" />
                                        <RechartsTooltip
                                            cursor={{fill: 'transparent'}}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                        <Bar dataKey="count" name="Počet ÚZ" fill="#002855" radius={[0, 4, 4, 0]} barSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-slate-400 text-sm">Zatím žádní vyhodnocující lektoři.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Comparative Avg Score Bar Chart ────────────── */}
                {data.avg_score_by_group && data.avg_score_by_group.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm print:break-inside-avoid">
                        <h3 className="font-semibold text-lg text-[#002855] dark:text-white mb-6 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
                            Průměrné skóre podle {data.role === 'superadmin' && !filters.class_id ? 'zařízení' : 'tříd'} (%)
                        </h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.avg_score_by_group} layout="vertical" margin={{ left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                    <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" tickFormatter={v => `${v}%`} />
                                    <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 12}} stroke="#94a3b8" />
                                    <RechartsTooltip
                                        cursor={{fill: 'transparent'}}
                                        formatter={(value: number) => [`${value.toFixed(1)} %`, 'Průměr']}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Bar dataKey="avg_pct" name="Průměr %" fill="#002855" radius={[0, 4, 4, 0]} barSize={24} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* ── Top 5 Failures ────────────────────────────── */}
                {data.top_failures && data.top_failures.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm print:break-inside-avoid">
                        <h3 className="font-semibold text-lg text-[#002855] dark:text-white mb-6 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                            Top 5 nejčastěji nesplněných kritérií
                        </h3>
                        <div className="space-y-4">
                            {data.top_failures.map((f, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-lg font-bold text-red-500 w-7 text-right shrink-0">{i + 1}.</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-800 dark:text-white truncate" title={f.nazev}>{f.nazev}</p>
                                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-1.5">
                                            <div
                                                className="bg-red-500 h-2.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.round(f.failure_rate * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                                        {Math.round(f.failure_rate * 100)} % ({f.failure_count}/{f.total})
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Lecturer Table List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden print:break-inside-avoid">
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        Vyučující (Garanti)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                <th className="p-4">Jméno vyučujícího</th>
                                <th className="p-4 text-right">Vyhodnocených ÚZ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                            {data.by_lecturer.map((lec, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="p-4 font-medium text-slate-900 dark:text-white">{lec.name}</td>
                                    <td className="p-4 text-right font-bold text-[#002855] dark:text-[#facc15]">{lec.count}</td>
                                </tr>
                            ))}
                            {data.by_lecturer.length === 0 && (
                                <tr>
                                    <td colSpan={2} className="p-8 text-center text-slate-400">Žádná data pro zobrazení</td>
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
                }
            `}</style>
        </div>
    );
}

import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';
import { Download, Printer, BarChart3, TrendingUp, Presentation, CheckCircle2 } from 'lucide-react';
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
            <div className="flex-1 flex flex-col items-center justify-center h-full text-slate-500">
                <BarChart3 className="w-8 h-8 animate-pulse mb-4 text-[#002855]" />
                <p>Načítám statistiky využití...</p>
            </div>
        );
    }

    if (error) {
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

            {/* Print Header */}
            <div className="hidden print:block mb-8 text-center">
                <h1 className="text-3xl font-bold text-[#002855]">Statistiky využití EVALUZ</h1>
                <p className="text-gray-600">Rozsah: {data.org_unit} | Vygenerováno: {new Date().toLocaleDateString('cs-CZ')}</p>
            </div>

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
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Aktivních lektorů</span>
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

                {/* By Lecturer Bar Chart (For Admin view, replacing org unit chart) */}
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
            </div>

            {/* Lecturer Table List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden print:break-inside-avoid">
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        Tabulka Lektorů (Garantů)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                <th className="p-4">Jméno lektora</th>
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

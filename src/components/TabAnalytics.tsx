import React, { useState, useEffect } from 'react';
import { Download, BarChart3, PieChart as PieChartIcon, Wand2, RefreshCw, AlertCircle } from 'lucide-react';
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

interface AnalyticsData {
    stats: { name: string, full_name: string, success_rate: number, avg_score: number }[];
    top_errors: string[];
    ai_insight: string;
    score_distribution: { "0_50": number, "51_80": number, "81_100": number };
}

const PIE_COLORS = ['#ef4444', '#f59e0b', '#10b981']; // Red, Amber, Emerald

export function TabAnalytics() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchAnalytics = async (force: boolean = false) => {
        setLoading(true);
        setError(null);
        try {
            // Force parameter could be implemented on backend to bypass cache.
            // For now we just re-fetch the latest db evaluations.
            const res = await fetch('http://localhost:8000/api/v1/analytics/class/1/summary');
            if (!res.ok) throw new Error("Chyba při stahování analytiky");

            const json = await res.json();
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const pieData = data ? [
        { name: '0-50 %', value: data.score_distribution["0_50"] },
        { name: '51-80 %', value: data.score_distribution["51_80"] },
        { name: '81-100 %', value: data.score_distribution["81_100"] }
    ].filter(d => d.value > 0) : []; // filter out empty bands

    return (
        <div className="max-w-6xl mx-auto space-y-6">
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
                        onClick={() => window.open('http://localhost:8000/api/v1/export/class/1/csv', '_blank')}
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
                    <div className="grid grid-cols-3 gap-6">
                        {/* Bar Chart - Success rates */}
                        <div className="col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
                            <div className="flex items-center gap-2 mb-6">
                                <BarChart3 className="w-5 h-5 text-[#002855]" />
                                <h4 className="font-semibold text-[#002855]">Úspěšnost jednotlivých kritérií</h4>
                            </div>
                            <div className="h-80 w-full relative -left-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.stats} layout="vertical" margin={{ top: 5, right: 30, left: 30, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E2E8F0" />
                                        <XAxis type="number" domain={[0, 100]} unit=" %" />
                                        <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11, fill: '#475569' }} />
                                        <RechartsTooltip
                                            formatter={(value) => [`${value} %`, 'Splnilo']}
                                            cursor={{ fill: '#F1F5F9' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '13px' }}
                                        />
                                        <Bar dataKey="success_rate" fill="#002855" radius={[0, 4, 4, 0]} barSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Pie Chart - Score distribution */}
                        <div className="col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                            <div className="flex items-center gap-2 mb-4">
                                <PieChartIcon className="w-5 h-5 text-[#002855]" />
                                <h4 className="font-semibold text-[#002855]">Rozložení ziskovosti (%)</h4>
                            </div>
                            <div className="flex-1 w-full h-full min-h-[250px] flex items-center justify-center">
                                {pieData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                            >
                                                {pieData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <RechartsTooltip formatter={(value) => [value, 'Studentů']} />
                                            <Legend verticalAlign="bottom" height={36} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-slate-400 text-sm">Nedostatek dat pro graf</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* AI Recommendations */}
                    <div className="bg-gradient-to-br from-[#002855] to-[#001a38] rounded-xl p-6 text-white shadow-md relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37] rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-4 text-[#D4AF37]">
                                <Wand2 className="w-6 h-6" />
                                <h4 className="font-semibold text-lg">Pedagogické shrnutí od AI Asistenta</h4>
                            </div>

                            <div className="space-y-4 text-slate-200 text-sm leading-relaxed max-w-4xl bg-white/5 p-5 rounded-lg border border-white/10 whitespace-pre-wrap font-serif">
                                {data.ai_insight}
                            </div>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
}

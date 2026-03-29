// src/pages/Reports.js
import React, { useState, useEffect, useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { getReportOrders } from '../db';

const formatCurrency = (n) => Math.round(n || 0).toLocaleString('en-US');

// ── GMT+8 日期工具 ────────────────────────────────────────────────────────────
const TW_OFFSET = 8 * 3600 * 1000; // +8h in ms

// timestamp → 'YYYY-MM-DD' in GMT+8
const tsToDayTW = (ts) => new Date(ts + TW_OFFSET).toISOString().split('T')[0];

// timestamp → hour (0-23) in GMT+8
const tsToHourTW = (ts) => Math.floor((ts + TW_OFFSET) / 3600000) % 24;

// timestamp → minute-of-day (0-1439) in GMT+8
const tsToMinOfDayTW = (ts) => Math.floor((ts + TW_OFFSET) / 60000) % 1440;
// ─────────────────────────────────────────────────────────────────────────────

const formatDateTime = (ts) => {
    if (!ts) return '--';
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const hh   = String(d.getHours()).padStart(2, '0');
    const mi   = String(d.getMinutes()).padStart(2, '0');
    const ss   = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
};

// display dailyOrderNo if available, else zero-padded id
const displayOrderId = (o) =>
    o.dailyOrderNo ? String(o.dailyOrderNo).padStart(3, '0') : String(o.orderId || o.id || 0).padStart(3, '0');

const today = () => tsToDayTW(Date.now());

const addDays = (dateStr, n) => {
    const d = new Date(dateStr || today());
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
};

// compute KPI totals from an array of orders
const calcKpi = (orders) => {
    let total = 0, dineIn = 0, frozen = 0;
    let day = 0, night = 0, dayCust = 0, nightCust = 0, customers = 0;
    orders.forEach(o => {
        total += o.total;
        const cnt = o.adjustedCustomerCount || 0;
        customers += cnt;
        let orderFrozen = 0;
        (o.items || []).forEach(item => {
            if (item.category === '冷凍包') orderFrozen += item.price * item.quantity;
        });
        frozen += orderFrozen;
        const orderDineIn = o.total - orderFrozen;
        dineIn += orderDineIn;
        const min = tsToMinOfDayTW(o.timestamp);
        if (min >= 11 * 60 && min <= 16 * 60)      { day += orderDineIn;   dayCust += cnt; }
        else if (min > 16 * 60 && min <= 22 * 60)  { night += orderDineIn; nightCust += cnt; }
    });
    return {
        total, dineIn, frozen, day, night, customers,
        avgSpend:      customers  > 0 ? Math.round(dineIn / customers)  : 0,
        dayAvgSpend:   dayCust    > 0 ? Math.round(day / dayCust)       : 0,
        nightAvgSpend: nightCust  > 0 ? Math.round(night / nightCust)   : 0,
    };
};

// delta badge — pill style, consistent position across all cards
const Delta = ({ curr, prev, isCurrency = false }) => {
    if (prev === 0 && curr === 0) {
        return (
            <div className="mt-auto pt-2">
                <span className="text-xs text-gray-300">較上期 —</span>
            </div>
        );
    }
    const delta = curr - prev;
    const up = delta >= 0;
    const pct = prev > 0 ? Math.abs(Math.round((delta / prev) * 100)) : null;
    const valStr = isCurrency ? `$${formatCurrency(Math.abs(delta))}` : Math.abs(delta).toLocaleString('en-US');
    return (
        <div className="mt-auto pt-2">
            <p className="text-[10px] text-gray-400 mb-0.5">較上期</p>
            <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold
                ${up ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                {up ? '▲' : '▼'} {valStr}{pct !== null ? ` (${pct}%)` : ''}
            </span>
        </div>
    );
};

// ----------------------------------------------------------------------
// Date-range bar
// ----------------------------------------------------------------------
const DateRangeBar = ({ startDate, endDate, onStart, onEnd }) => {
    const t = today();
    const shortcuts = [
        { label: '今天',     action: () => { onStart(t); onEnd(t); } },
        { label: '前三天',   action: () => { onStart(addDays(t, -2)); onEnd(t); } },
        { label: '最近七天', action: () => { onStart(addDays(t, -6)); onEnd(t); } },
        { label: '近30天',   action: () => { onStart(addDays(t, -29)); onEnd(t); } },
        { label: '本月',     action: () => { const d = new Date(Date.now() + TW_OFFSET); onStart(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`); onEnd(t); } },
        { label: '今年',     action: () => { const d = new Date(Date.now() + TW_OFFSET); onStart(`${d.getUTCFullYear()}-01-01`); onEnd(t); } },
        { label: '全部',     action: () => { onStart(''); onEnd(''); } },
    ];
    return (
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm flex-wrap">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2"/>
                <path d="M16 2v4M8 2v4M3 10h18" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input type="date" value={startDate} onChange={e => onStart(e.target.value)}
                className="text-sm font-bold border-none outline-none bg-transparent text-gray-700" />
            <span className="text-gray-400 font-bold">—</span>
            <input type="date" value={endDate} onChange={e => onEnd(e.target.value)}
                className="text-sm font-bold border-none outline-none bg-transparent text-gray-700" />
            <div className="flex gap-1 ml-2">
                {shortcuts.map(s => (
                    <button key={s.label} onClick={s.action}
                        className="text-xs font-bold text-[#2FB8B8] hover:bg-[#2FB8B8]/10 px-2 py-0.5 rounded whitespace-nowrap transition-colors"
                    >{s.label}</button>
                ))}
            </div>
        </div>
    );
};

// shared sort-toggle button
const SortBtn = ({ label, k, current, setFn }) => (
    <button onClick={() => setFn(k)}
        className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors
            ${current === k ? 'bg-[#2FB8B8] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
        {label}{current === k && <span className="text-[10px]">▼</span>}
    </button>
);

// shared breakdown table
const BreakdownTable = ({ rows, labelHeader }) => (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-4 py-2 text-left   text-xs font-bold text-gray-500 w-28">{labelHeader}</th>
                    <th className="px-4 py-2 text-right  text-xs font-bold text-gray-500 w-32">營業額</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 w-20">來客數</th>
                    <th className="px-4 py-2 text-right  text-xs font-bold text-gray-500 w-24">客單價</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">此日期區間無紀錄</td></tr>
                ) : rows.map((row, i) => (
                    <tr key={i} className={`hover:bg-gray-50 ${row.total > 0 ? '' : 'opacity-40'}`}>
                        <td className="px-4 py-2 font-bold text-gray-700">{row.label}</td>
                        <td className={`px-4 py-2 text-right font-bold ${row.total > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                            ${formatCurrency(row.total)}
                        </td>
                        <td className={`px-4 py-2 text-center ${row.customers > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                            {row.customers > 0 ? row.customers : '—'}
                        </td>
                        <td className={`px-4 py-2 text-right ${row.avgSpend > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                            {row.avgSpend > 0 ? `$${formatCurrency(row.avgSpend)}` : '—'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// ----------------------------------------------------------------------
// Trend Chart — uses filtered orders + auto granularity
// ----------------------------------------------------------------------
const CHART_METRICS = [
    { key: 'revenue',   label: '營業額', color: '#2FB8B8', isCurrency: true },
    { key: 'customers', label: '來客量', color: '#8B5CF6', isCurrency: false },
    { key: 'avgSpend',  label: '客單價', color: '#F59E0B', isCurrency: true },
];

const TrendChart = ({ filteredOrders, isSingleDay }) => {
    const [activeMetric, setActiveMetric] = useState('revenue');

    const chartData = useMemo(() => {
        if (isSingleDay) {
            // hourly 11–21
            const HOUR_START = 11, HOUR_END = 22;
            const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => ({
                label: `${String(HOUR_START + i).padStart(2, '0')}:00`,
                revenue: 0, customers: 0,
            }));
            filteredOrders.forEach(o => {
                const h = tsToHourTW(o.timestamp);
                if (h < HOUR_START || h > HOUR_END) return;
                let orderFrozen = 0;
                (o.items || []).forEach(item => {
                    if (item.category === '冷凍包') orderFrozen += item.price * item.quantity;
                });
                hours[h - HOUR_START].revenue   += o.total - orderFrozen;
                hours[h - HOUR_START].customers += o.adjustedCustomerCount || 0;
            });
            return hours.map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.revenue / r.customers) : 0 }));
        } else {
            // daily
            const map = new Map();
            filteredOrders.forEach(o => {
                const key = tsToDayTW(o.timestamp);
                const ex = map.get(key) || { label: key, revenue: 0, customers: 0 };
                let orderFrozen = 0;
                (o.items || []).forEach(item => {
                    if (item.category === '冷凍包') orderFrozen += item.price * item.quantity;
                });
                ex.revenue   += o.total - orderFrozen;
                ex.customers += o.adjustedCustomerCount || 0;
                map.set(key, ex);
            });
            return Array.from(map.values())
                .sort((a, b) => a.label.localeCompare(b.label))
                .map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.revenue / r.customers) : 0 }));
        }
    }, [filteredOrders, isSingleDay]);

    const metric = CHART_METRICS.find(m => m.key === activeMetric);
    const fmtTick = (v) => metric.isCurrency ? (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`) : String(v);
    const fmtTooltip = (v) => metric.isCurrency ? [`$${formatCurrency(v)}`, metric.label] : [v, metric.label];

    return (
        <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-black text-gray-800">
                    趨勢圖
                    <span className="ml-2 text-xs font-normal text-gray-400">{isSingleDay ? '每小時' : '每日'}</span>
                </h3>
                <div className="flex gap-1">
                    {CHART_METRICS.map(m => (
                        <button key={m.key} onClick={() => setActiveMetric(m.key)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors
                                ${activeMetric === m.key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            style={activeMetric === m.key ? { backgroundColor: m.color } : {}}>
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="p-4" style={{ height: 240 }}>
                {chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 font-bold">無資料</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                                tickLine={false}
                                axisLine={{ stroke: '#E5E7EB' }}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tickFormatter={fmtTick}
                                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                                tickLine={false}
                                axisLine={false}
                                width={52}
                            />
                            <Tooltip
                                formatter={fmtTooltip}
                                contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                cursor={{ stroke: metric.color, strokeWidth: 1, strokeDasharray: '4 2' }}
                            />
                            <Line
                                type="monotone"
                                dataKey={activeMetric}
                                stroke={metric.color}
                                strokeWidth={2.5}
                                dot={chartData.length <= 24 ? { r: 3.5, fill: '#fff', stroke: metric.color, strokeWidth: 2 } : false}
                                activeDot={{ r: 5, fill: metric.color }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// 業績概況 Tab
// ----------------------------------------------------------------------
const SummaryTab = ({ filteredOrders, compOrders, startDate, endDate }) => {
    const [dailySortKey, setDailySortKey] = useState('date');

    const kpi     = useMemo(() => calcKpi(filteredOrders), [filteredOrders]);
    const prevKpi = useMemo(() => calcKpi(compOrders),     [compOrders]);

    const isSingleDay = startDate && endDate && startDate === endDate;

    // Hourly rows (11–21)
    const hourlyRows = useMemo(() => {
        const HOUR_START = 11, HOUR_END = 22;
        const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => ({
            label: `${String(HOUR_START + i).padStart(2, '0')}:00`, total: 0, customers: 0,
        }));
        filteredOrders.forEach(o => {
            const h = tsToHourTW(o.timestamp);
            if (h < HOUR_START || h > HOUR_END) return;
            let orderFrozen = 0;
            (o.items || []).forEach(item => {
                if (item.category === '冷凍包') orderFrozen += item.price * item.quantity;
            });
            hours[h - HOUR_START].total     += o.total - orderFrozen;
            hours[h - HOUR_START].customers += o.adjustedCustomerCount || 0;
        });
        return hours.map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.total / r.customers) : 0 }));
    }, [filteredOrders]);

    // Daily rows
    const dailyRows = useMemo(() => {
        const dayMap = new Map();
        filteredOrders.forEach(o => {
            const d = tsToDayTW(o.timestamp);
            const ex = dayMap.get(d) || { label: d, total: 0, customers: 0 };
            let orderFrozen = 0;
            (o.items || []).forEach(item => {
                if (item.category === '冷凍包') orderFrozen += item.price * item.quantity;
            });
            ex.total     += o.total - orderFrozen;
            ex.customers += o.adjustedCustomerCount || 0;
            dayMap.set(d, ex);
        });
        if (startDate && endDate) {
            let cur = startDate;
            while (cur <= endDate) {
                if (!dayMap.has(cur)) dayMap.set(cur, { label: cur, total: 0, customers: 0 });
                cur = addDays(cur, 1);
            }
        }
        const rows = Array.from(dayMap.values()).map(r => ({
            ...r, avgSpend: r.customers > 0 ? Math.round(r.total / r.customers) : 0,
        }));
        if (dailySortKey === 'revenue') return rows.sort((a, b) => b.total - a.total);
        return rows.sort((a, b) => a.label.localeCompare(b.label));
    }, [filteredOrders, startDate, endDate, dailySortKey]);

    // KPI card definitions — all use flex-col so Delta always sits at the bottom
    const kpiCards = [
        {
            label: '總營收',     value: `$${formatCurrency(kpi.total)}`,
            color: 'border-[#2FB8B8]',  textColor: 'text-[#2FB8B8]',
            sub: `白天 $${formatCurrency(kpi.day)} ／ 晚上 $${formatCurrency(kpi.night)}`,
            delta: <Delta curr={kpi.total}     prev={prevKpi.total}     isCurrency />,
        },
        {
            label: '餐點營收',   value: `$${formatCurrency(kpi.dineIn)}`,
            color: 'border-green-500',  textColor: 'text-green-700',
            sub: `白天 $${formatCurrency(kpi.day)} ／ 晚上 $${formatCurrency(kpi.night)}`,
            delta: <Delta curr={kpi.dineIn}    prev={prevKpi.dineIn}    isCurrency />,
        },
        {
            label: '冷凍包銷售', value: `$${formatCurrency(kpi.frozen)}`,
            color: 'border-cyan-500',   textColor: 'text-cyan-700',
            sub: null,
            delta: <Delta curr={kpi.frozen}    prev={prevKpi.frozen}    isCurrency />,
        },
        {
            label: '來客數',     value: `${kpi.customers} 人`,
            color: 'border-purple-500', textColor: 'text-purple-700',
            sub: null,
            delta: <Delta curr={kpi.customers} prev={prevKpi.customers} />,
        },
        {
            label: '客單價',     value: `$${formatCurrency(kpi.avgSpend)}`,
            color: 'border-orange-500', textColor: 'text-orange-700',
            sub: `白天 $${formatCurrency(kpi.dayAvgSpend)} ／ 晚上 $${formatCurrency(kpi.nightAvgSpend)}`,
            delta: <Delta curr={kpi.avgSpend}  prev={prevKpi.avgSpend}  isCurrency />,
        },
    ];

    return (
        <div className="space-y-5">
            {/* KPI cards — flex-col + min-h ensures uniform layout */}
            <div className="grid grid-cols-5 gap-3">
                {kpiCards.map(c => (
                    <div key={c.label}
                        className={`bg-white rounded-xl shadow p-4 border-l-4 ${c.color} flex flex-col`}
                        style={{ minHeight: 130 }}>
                        <p className="text-xs font-bold text-gray-500 mb-1">{c.label}</p>
                        <p className={`text-2xl font-black ${c.textColor}`}>{c.value}</p>
                        {/* sub: always occupies space even when null */}
                        <p className="text-xs text-gray-400 mt-0.5 min-h-[16px]">{c.sub || ''}</p>
                        {c.delta}
                    </div>
                ))}
            </div>

            {/* Trend chart */}
            <TrendChart filteredOrders={filteredOrders} isSingleDay={isSingleDay} />

            {/* Breakdown table */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-black text-gray-800">{isSingleDay ? '每小時業績' : '每日業績'}</h3>
                    {!isSingleDay && (
                        <div className="flex gap-1.5">
                            <SortBtn label="日期"   k="date"    current={dailySortKey} setFn={setDailySortKey} />
                            <SortBtn label="營業額" k="revenue" current={dailySortKey} setFn={setDailySortKey} />
                        </div>
                    )}
                </div>
                <BreakdownTable rows={isSingleDay ? hourlyRows : dailyRows} labelHeader={isSingleDay ? '小時' : '日期'} />
            </div>

            {/* Receipt detail */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="font-black text-gray-800">歷史單據明細</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-left   text-xs font-bold text-gray-500 whitespace-nowrap w-16">單號</th>
                                <th className="px-3 py-2 text-left   text-xs font-bold text-gray-500 whitespace-nowrap">結帳時間</th>
                                <th className="px-3 py-2 text-center text-xs font-bold text-gray-500 whitespace-nowrap w-16">桌號</th>
                                <th className="px-3 py-2 text-center text-xs font-bold text-gray-500 whitespace-nowrap w-12">人數</th>
                                <th className="px-3 py-2 text-left   text-xs font-bold text-gray-500">結帳項目</th>
                                <th className="px-3 py-2 text-right  text-xs font-bold text-gray-500 whitespace-nowrap w-24">金額</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredOrders.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">此日期區間無紀錄</td></tr>
                            ) : filteredOrders.map((o, i) => (
                                <tr key={`${o.invoiceNumber}-${i}`} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400 font-mono align-top pt-3">
                                        #{displayOrderId(o)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs align-top pt-3">
                                        {formatDateTime(o.timestamp)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-center font-bold text-gray-800 align-top pt-3">
                                        {o.table}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-center text-gray-600 align-top pt-3">
                                        {(o.adjustedCustomerCount || 0) > 0 ? o.adjustedCustomerCount : ''}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 align-top">
                                        <ul className="list-disc list-inside space-y-0.5 pt-1">
                                            {(o.items || []).map((item, j) => (
                                                <li key={j} className="text-sm leading-snug">
                                                    {item.name} × {item.quantity}（${formatCurrency(item.price)}）
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right font-black text-gray-800 align-top pt-3">
                                        ${formatCurrency(o.total)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// 銷售排行 Tab
// ----------------------------------------------------------------------
const RankingTab = ({ filteredOrders }) => {
    const [itemSortKey,   setItemSortKey]   = useState('revenue');
    const [catSortKey,    setCatSortKey]    = useState('revenue');
    const [frozenSortKey, setFrozenSortKey] = useState('revenue');

    const { itemRank, catRank, frozenRank } = useMemo(() => {
        const itemMap   = new Map();
        const catMap    = new Map();
        const frozenMap = new Map();
        filteredOrders.forEach(o => {
            (o.items || []).forEach(item => {
                const rev = item.price * item.quantity;
                const cat = item.category || '未分類';
                const ex = itemMap.get(item.name) || { name: item.name, category: cat, quantity: 0, revenue: 0 };
                ex.quantity += item.quantity; ex.revenue += rev;
                itemMap.set(item.name, ex);

                const ce = catMap.get(cat) || { name: cat, quantity: 0, revenue: 0 };
                ce.quantity += item.quantity; ce.revenue += rev;
                catMap.set(cat, ce);

                if (cat === '冷凍包') {
                    const fe = frozenMap.get(item.name) || { name: item.name, quantity: 0, revenue: 0 };
                    fe.quantity += item.quantity; fe.revenue += rev;
                    frozenMap.set(item.name, fe);
                }
            });
        });
        return {
            itemRank:   Array.from(itemMap.values()),
            catRank:    Array.from(catMap.values()),
            frozenRank: Array.from(frozenMap.values()),
        };
    }, [filteredOrders]);

    const sorted = (arr, key) => [...arr].sort((a, b) => b[key] - a[key]);

    const RankTable = ({ data, sortKey, setSort, title, emptyMsg }) => (
        <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-black text-gray-800">{title}</h3>
                <div className="flex gap-1.5">
                    <SortBtn label="銷售額" k="revenue"  current={sortKey} setFn={setSort} />
                    <SortBtn label="銷售量" k="quantity" current={sortKey} setFn={setSort} />
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 w-10">#</th>
                            <th className="px-4 py-2 text-left   text-xs font-bold text-gray-500">名稱</th>
                            <th className="px-4 py-2 text-right  text-xs font-bold text-gray-500 w-24">銷售量</th>
                            <th className="px-4 py-2 text-right  text-xs font-bold text-gray-500 w-28">銷售額</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">{emptyMsg || '此日期區間無資料'}</td></tr>
                        ) : data.map((item, i) => (
                            <tr key={item.name} className={`hover:bg-gray-50 ${i === 0 ? 'bg-yellow-50/60' : ''}`}>
                                <td className="px-4 py-2.5 text-center">
                                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-xs text-gray-400">{i + 1}</span>}
                                </td>
                                <td className="px-4 py-2.5 font-bold text-gray-800">{item.name}</td>
                                <td className="px-4 py-2.5 text-right text-gray-600">{item.quantity} 份</td>
                                <td className="px-4 py-2.5 text-right font-black text-gray-800">${formatCurrency(item.revenue)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
                <RankTable data={sorted(itemRank,   itemSortKey)}   sortKey={itemSortKey}   setSort={setItemSortKey}   title="🏆 商品銷售排行" />
                <RankTable data={sorted(catRank,    catSortKey)}    sortKey={catSortKey}    setSort={setCatSortKey}    title="🔖 類別銷售排行" />
            </div>
            <RankTable
                data={sorted(frozenRank, frozenSortKey)}
                sortKey={frozenSortKey} setSort={setFrozenSortKey}
                title="🧊 冷凍包銷售排行"
                emptyMsg="此日期區間無冷凍包銷售紀錄"
            />
        </div>
    );
};

// ----------------------------------------------------------------------
// Main Report Page
// ----------------------------------------------------------------------
const ReportPage = () => {
    const [orders, setOrders]       = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab]             = useState('summary');
    const [startDate, setStartDate] = useState(today());
    const [endDate,   setEndDate]   = useState(today());

    useEffect(() => { loadOrders(); }, []);

    const loadOrders = async () => {
        setIsLoading(true);
        try {
            const raw = await getReportOrders();
            const chronological = [...raw].sort((a, b) => a.timestamp - b.timestamp);
            const seen = new Map();
            const processed = chronological.map(order => {
                const isFirst = !seen.has(order.orderId);
                if (isFirst) seen.set(order.orderId, true);
                return {
                    ...order,
                    adjustedCustomerCount: isFirst
                        ? (order.currentOrderCustomerCount ?? order.customerCount)
                        : 0,
                };
            });
            setOrders(processed.sort((a, b) => b.timestamp - a.timestamp));
        } finally {
            setIsLoading(false);
        }
    };

    // Current range
    const filteredOrders = useMemo(() => orders.filter(o => {
        const d = tsToDayTW(o.timestamp);
        if (startDate && d < startDate) return false;
        if (endDate   && d > endDate)   return false;
        return true;
    }), [orders, startDate, endDate]);

    // Comparison period:
    //   1 day  → same weekday last week (-7 days)
    //   month  → same month last year (startDate begins on 1st)
    //   other  → same-length period immediately before
    const compOrders = useMemo(() => {
        if (!startDate || !endDate) return [];
        const nDays = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
        let cStart, cEnd;
        if (nDays === 1) {
            // 當日 → 上週同日
            cStart = addDays(startDate, -7);
            cEnd   = cStart;
        } else if (startDate.endsWith('-01')) {
            // 月份區間 → 去年同月
            const prevYear = (y) => `${parseInt(y.slice(0, 4)) - 1}${y.slice(4)}`;
            cStart = prevYear(startDate);
            cEnd   = prevYear(endDate);
        } else {
            // 其他 → 前 N 天
            cEnd   = addDays(startDate, -1);
            cStart = addDays(startDate, -nDays);
        }
        return orders.filter(o => {
            const d = tsToDayTW(o.timestamp);
            return d >= cStart && d <= cEnd;
        });
    }, [orders, startDate, endDate]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#2FB8B8]"></div>
            </div>
        );
    }

    return (
        <div className="p-5 font-sans bg-gray-50 min-h-full">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h1 className="text-2xl font-black text-gray-900">營業報表</h1>
                <DateRangeBar startDate={startDate} endDate={endDate} onStart={setStartDate} onEnd={setEndDate} />
            </div>

            <div className="flex gap-1 bg-gray-200 p-1 rounded-xl mb-5 w-fit">
                {[
                    { key: 'summary', label: '業績概況' },
                    { key: 'ranking', label: '銷售排行' },
                ].map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`px-5 py-2 rounded-lg font-black text-sm transition-all
                            ${tab === t.key ? 'bg-white text-[#2FB8B8] shadow' : 'text-gray-500 hover:text-gray-700'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'summary'
                ? <SummaryTab
                    filteredOrders={filteredOrders}
                    compOrders={compOrders}
                    startDate={startDate}
                    endDate={endDate}
                  />
                : <RankingTab filteredOrders={filteredOrders} />
            }
        </div>
    );
};

export default ReportPage;

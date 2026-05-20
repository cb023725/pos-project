// src/pages/Reports.js
import React, { useState, useEffect, useMemo } from 'react';
import {
    ComposedChart, Line, Area, Bar,
    XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { getReportOrders, getCategorySettings } from '../db';

const formatCurrency = (n) => Math.round(n || 0).toLocaleString('en-US');

const DAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const getDayOfWeek = (dateStr) => DAY_ZH[new Date(dateStr + 'T12:00:00+08:00').getDay()];

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
    o.dailyOrderNo ? String(o.dailyOrderNo).padStart(3, '0') : String(o.orderId || o.id || 0).slice(-3).padStart(3, '0');

const today = () => tsToDayTW(Date.now());

const addDays = (dateStr, n) => {
    const d = new Date(dateStr || today());
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
};

// compute KPI totals from an array of orders
// catSettings: array of { name, reportGroup, includeInTotal, ... }
const calcKpi = (orders, catSettings = []) => {
    // Build lookup maps
    const catGroupMap = {};     // categoryName -> reportGroup
    const groupInclude = {};    // reportGroup -> includeInTotal (bool)
    const groupShowKpi = {};    // reportGroup -> showInKpi (bool)
    catSettings.forEach(c => {
        catGroupMap[c.name] = c.reportGroup || '營業額';
        if (c.reportGroup && c.reportGroup !== '營業額') {
            groupInclude[c.reportGroup] = c.includeInTotal !== false;
            // showInKpi: true by default; false only if explicitly set false
            if (groupShowKpi[c.reportGroup] !== false) {
                groupShowKpi[c.reportGroup] = c.showInKpi !== false;
            }
        }
    });
    const nonRevenueCats = catSettings.length > 0
        ? new Set(catSettings.filter(c => c.reportGroup !== '營業額').map(c => c.name))
        : new Set(['冷凍包']);

    let total = 0, dineIn = 0;
    let day = 0, night = 0, dayCust = 0, nightCust = 0, customers = 0;
    const groupSalesMap = new Map(); // reportGroup -> amount

    orders.forEach(o => {
        total += o.total;
        const cnt = o.adjustedCustomerCount || 0;
        customers += cnt;
        let orderNonRevenue = 0;
        (o.items || []).forEach(item => {
            if (nonRevenueCats.has(item.category)) {
                const rev = item.price * item.quantity;
                orderNonRevenue += rev;
                const grp = catGroupMap[item.category] || item.category;
                groupSalesMap.set(grp, (groupSalesMap.get(grp) || 0) + rev);
            }
        });
        const orderDineIn = o.total - orderNonRevenue;
        dineIn += orderDineIn;
        const min = tsToMinOfDayTW(o.timestamp);
        if (min >= 11 * 60 && min <= 16 * 60)      { day += orderDineIn;   dayCust += cnt; }
        else if (min > 16 * 60 && min <= 22 * 60)  { night += orderDineIn; nightCust += cnt; }
    });

    // adjustedTotal = total minus groups where includeInTotal === false
    let excluded = 0;
    groupSalesMap.forEach((amount, grp) => {
        if (groupInclude[grp] === false) excluded += amount;
    });
    const adjustedTotal = total - excluded;
    const frozen = groupSalesMap.get('冷凍包') || 0;

    return {
        total, adjustedTotal, dineIn, frozen, day, night, customers,
        groupSalesMap, groupInclude, groupShowKpi,
        avgSpend:      customers > 0 ? Math.round(dineIn / customers)  : 0,
        dayAvgSpend:   dayCust   > 0 ? Math.round(day / dayCust)       : 0,
        nightAvgSpend: nightCust > 0 ? Math.round(night / nightCust)   : 0,
    };
};

// delta badge — pill style, consistent position across all cards
const Delta = ({ curr, prev, isCurrency = false, enabled = true }) => {
    if (!enabled) {
        return <div className="mt-auto pt-2"><span className="text-xs text-gray-300">—</span></div>;
    }
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
                ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-400'}`}>
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
                        className="text-xs font-bold text-[#4A9A7A] hover:bg-[#4A9A7A]/10 px-2 py-0.5 rounded whitespace-nowrap transition-colors"
                    >{s.label}</button>
                ))}
            </div>
        </div>
    );
};

// sort-toggle button — supports { key, dir } state
const SortBtn = ({ label, k, currentSort, setSort }) => {
    const isActive = currentSort.key === k;
    return (
        <button
            onClick={() => setSort(prev =>
                prev.key === k
                    ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                    : { key: k, dir: 'desc' }
            )}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors
                ${isActive ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
            {isActive && <span className="text-[10px]">{currentSort.dir === 'asc' ? '▲' : '▼'}</span>}
        </button>
    );
};

// shared breakdown table — column headers clickable for sort when showDay=true
const BreakdownTable = ({ rows, labelHeader, showDay = false }) => {
    const [sort, setSort] = useState({ key: 'label', dir: 'asc' });

    const sortedRows = useMemo(() => {
        if (!showDay) return rows;
        return [...rows].sort((a, b) => {
            let cmp = 0;
            if      (sort.key === 'label')     cmp = a.label.localeCompare(b.label);
            else if (sort.key === 'total')     cmp = a.total - b.total;
            else if (sort.key === 'customers') cmp = a.customers - b.customers;
            else if (sort.key === 'avgSpend')  cmp = a.avgSpend - b.avgSpend;
            return sort.dir === 'asc' ? cmp : -cmp;
        });
    }, [rows, sort, showDay]);

    const toggle = (key) => setSort(prev =>
        prev.key === key
            ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'label' ? 'asc' : 'desc' }
    );
    const icon = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    const thCls = (key, align = 'left') =>
        `px-4 py-2 text-${align} text-xs font-bold text-gray-500 cursor-pointer select-none hover:text-[#4A9A7A] transition-colors`;

    // week separators only when sorted by date asc
    const useWeekSep = showDay && sort.key === 'label' && sort.dir === 'asc';
    const colSpan = showDay ? 5 : 4;

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                    <tr>
                        <th onClick={() => showDay && toggle('label')} className={showDay ? thCls('label') + ' w-28' : 'px-4 py-2 text-left text-xs font-bold text-gray-500 w-28'}>
                            {labelHeader}{showDay && icon('label')}
                        </th>
                        {showDay && <th className="px-3 py-2 text-center text-xs font-bold text-gray-500 w-14">星期</th>}
                        <th onClick={() => showDay && toggle('total')}     className={showDay ? thCls('total', 'right') + ' w-32' : 'px-4 py-2 text-right text-xs font-bold text-gray-500 w-32'}>營業額{showDay && icon('total')}</th>
                        <th onClick={() => showDay && toggle('customers')} className={showDay ? thCls('customers', 'center') + ' w-20' : 'px-4 py-2 text-center text-xs font-bold text-gray-500 w-20'}>來客數{showDay && icon('customers')}</th>
                        <th onClick={() => showDay && toggle('avgSpend')}  className={showDay ? thCls('avgSpend', 'right') + ' w-24' : 'px-4 py-2 text-right text-xs font-bold text-gray-500 w-24'}>客單價{showDay && icon('avgSpend')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedRows.length === 0 ? (
                        <tr><td colSpan={colSpan} className="px-4 py-8 text-center text-gray-400">此日期區間無紀錄</td></tr>
                    ) : sortedRows.flatMap((row, i) => {
                        const isWeekend  = showDay && (row.dayOfWeek === '六' || row.dayOfWeek === '日');
                        const isWeekStart = useWeekSep && row.dayOfWeek === '四' && i > 0;
                        const prevRow = sortedRows[i - 1];
                        const isHourGap = !showDay && i > 0 && prevRow &&
                            parseInt(row.label) - parseInt(prevRow.label) > 1;
                        const rowEl = (
                            <tr key={`r${i}`} className={`hover:bg-gray-50 ${row.total > 0 ? '' : 'opacity-40'} ${isWeekend ? 'bg-orange-50/50' : ''}`}>
                                <td className="px-4 py-2 font-bold text-gray-700">{row.label}</td>
                                {showDay && (
                                    <td className={`px-3 py-2 text-center text-xs font-bold ${isWeekend ? 'text-orange-400' : 'text-gray-400'}`}>週{row.dayOfWeek}</td>
                                )}
                                <td className={`px-4 py-2 text-right font-bold ${row.total > 0 ? 'text-gray-800' : 'text-gray-400'}`}>${formatCurrency(row.total)}</td>
                                <td className={`px-4 py-2 text-center ${row.customers > 0 ? 'text-gray-700' : 'text-gray-400'}`}>{row.customers > 0 ? row.customers : '—'}</td>
                                <td className={`px-4 py-2 text-right ${row.avgSpend > 0 ? 'text-gray-700' : 'text-gray-400'}`}>{row.avgSpend > 0 ? `$${formatCurrency(row.avgSpend)}` : '—'}</td>
                            </tr>
                        );
                        if (isWeekStart) return [<tr key={`sep${i}`}><td colSpan={5} className="p-0 bg-gray-300 h-px" /></tr>, rowEl];
                        if (isHourGap)  return [<tr key={`gap${i}`}><td colSpan={colSpan} className="p-0 bg-gray-200 h-px" /></tr>, rowEl];
                        return [rowEl];
                    })}
                </tbody>
            </table>
        </div>
    );
};

// ----------------------------------------------------------------------
// Trend Chart — dual-axis combined view + single metric toggle
// ----------------------------------------------------------------------
const CHART_METRICS = [
    { key: 'combined', label: '合併',  color: '#4A9A7A', isCurrency: false },
    { key: 'revenue',  label: '營業額', color: '#4A9A7A', isCurrency: true },
    { key: 'customers',label: '來客量', color: '#D0A830', isCurrency: false },
    { key: 'avgSpend', label: '客單價', color: '#6888A8', isCurrency: true },
];

const TrendChart = ({ filteredOrders, isSingleDay, nonRevenueCats }) => {
    const [activeMetric, setActiveMetric] = useState('combined');

    const chartData = useMemo(() => {
        if (isSingleDay) {
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
                    if (nonRevenueCats.has(item.category)) orderFrozen += item.price * item.quantity;
                });
                hours[h - HOUR_START].revenue   += o.total - orderFrozen;
                hours[h - HOUR_START].customers += o.adjustedCustomerCount || 0;
            });
            return hours.map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.revenue / r.customers) : 0 }));
        } else {
            const map = new Map();
            filteredOrders.forEach(o => {
                const key = tsToDayTW(o.timestamp);
                const ex = map.get(key) || { label: key, revenue: 0, customers: 0 };
                let orderFrozen = 0;
                (o.items || []).forEach(item => {
                    if (nonRevenueCats.has(item.category)) orderFrozen += item.price * item.quantity;
                });
                ex.revenue   += o.total - orderFrozen;
                ex.customers += o.adjustedCustomerCount || 0;
                map.set(key, ex);
            });
            return Array.from(map.values())
                .sort((a, b) => a.label.localeCompare(b.label))
                .map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.revenue / r.customers) : 0 }));
        }
    }, [filteredOrders, isSingleDay, nonRevenueCats]);

    const isCombined = activeMetric === 'combined';
    const metric = CHART_METRICS.find(m => m.key === activeMetric);
    const fmtRevTick = v => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`;
    const fmtSingleTick = v => metric.isCurrency ? fmtRevTick(v) : String(v);

    const combinedTooltip = ({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        return (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                <p style={{ color: '#6B7280', marginBottom: 4, fontWeight: 700 }}>{label}</p>
                {payload.map(p => (
                    <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>
                        {p.name}：{(p.dataKey === 'revenue' || p.dataKey === 'avgSpend') ? `$${formatCurrency(p.value)}` : p.value}
                    </p>
                ))}
            </div>
        );
    };

    const showDots = chartData.length <= 24;

    return (
        <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <h3 className="font-black text-gray-800">
                        趨勢圖
                        <span className="ml-2 text-xs font-normal text-gray-400">{isSingleDay ? '每小時' : '每日'}</span>
                    </h3>
                    {isCombined && (
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#4A9A7A', opacity: 0.8 }} />營業額</span>
                            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#D0A830', opacity: 0.8 }} />來客量</span>
                            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#6888A8', opacity: 0.8 }} />客單價</span>
                        </div>
                    )}
                </div>
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
            <div className="p-4" style={{ height: 260 }}>
                {chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 font-bold">無資料</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 8, right: isCombined ? 40 : 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} tickLine={false}
                                axisLine={{ stroke: '#E5E7EB' }} interval="preserveStartEnd" />
                            {isCombined ? <>
                                <YAxis yAxisId="rev" tickFormatter={fmtRevTick}
                                    tick={{ fontSize: 11, fill: '#4A9A7A' }} tickLine={false} axisLine={false} width={52} />
                                <YAxis yAxisId="cust" orientation="right"
                                    tick={{ fontSize: 11, fill: '#D0A830' }} tickLine={false} axisLine={false} width={32} />
                                <Tooltip content={combinedTooltip} cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }} />
                                <defs>
                                    <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%"  stopColor="#4A9A7A" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#4A9A7A" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <Area yAxisId="rev" type="monotone" dataKey="revenue" name="營業額"
                                    stroke="#4A9A7A" strokeWidth={2} fill="url(#revAreaGrad)" fillOpacity={1}
                                    dot={false} activeDot={{ r: 4, fill: '#4A9A7A' }} />
                                <Bar yAxisId="cust" dataKey="customers" name="來客量"
                                    fill="#D0A830" opacity={0.65} radius={[3, 3, 0, 0]}
                                    maxBarSize={24} />
                                <YAxis yAxisId="avg" hide={true} domain={['auto', 'auto']} />
                                <Line yAxisId="avg" type="monotone" dataKey="avgSpend" name="客單價"
                                    stroke="#6888A8" strokeWidth={2} dot={false}
                                    activeDot={{ r: 4, fill: '#6888A8' }} />
                            </> : <>
                                <YAxis tickFormatter={fmtSingleTick} tick={{ fontSize: 11, fill: '#9CA3AF' }}
                                    tickLine={false} axisLine={false} width={52} />
                                <Tooltip
                                    formatter={v => metric.isCurrency ? [`$${formatCurrency(v)}`, metric.label] : [v, metric.label]}
                                    contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                    cursor={{ stroke: metric.color, strokeWidth: 1, strokeDasharray: '4 2' }}
                                />
                                <Line type="monotone" dataKey={activeMetric} stroke={metric.color} strokeWidth={2.5}
                                    dot={showDots ? { r: 3.5, fill: '#fff', stroke: metric.color, strokeWidth: 2 } : false}
                                    activeDot={{ r: 5, fill: metric.color }} />
                            </>}
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

// ----------------------------------------------------------------------
// 業績概況 Tab
// ----------------------------------------------------------------------
const SUMMARY_SLOTS = [
    { key: 'all',    label: '全天' },
    { key: 'lunch',  label: '中午' },
    { key: 'dinner', label: '晚上' },
];
const applyTimeSlot = (orders, slot) => {
    if (slot === 'all') return orders;
    return orders.filter(o => {
        const min = tsToMinOfDayTW(o.timestamp);
        if (slot === 'lunch')  return min >= 11 * 60 && min <= 16 * 60;
        if (slot === 'dinner') return min >  16 * 60 && min <= 22 * 60;
        return true;
    });
};

const fmtMD = (dateStr) => dateStr ? dateStr.slice(5).replace('-', '/') : '';

const SummaryTab = ({ filteredOrders, compOrders, compPeriod, startDate, endDate, nonRevenueCats, catSettings, adjustments = [] }) => {
    const [summarySlot, setSummarySlot] = useState('all');
    const [historyPage, setHistoryPage] = useState(1);

    const slotOrders     = useMemo(() => {
        setHistoryPage(1);
        return applyTimeSlot(filteredOrders, summarySlot);
    }, [filteredOrders, summarySlot]);
    const slotCompOrders = useMemo(() => applyTimeSlot(compOrders,     summarySlot), [compOrders,     summarySlot]);

    const kpi     = useMemo(() => calcKpi(slotOrders,     catSettings), [slotOrders,     catSettings]);
    const prevKpi = useMemo(() => calcKpi(slotCompOrders, catSettings), [slotCompOrders, catSettings]);

    // 期間內的折扣/退款（以 createdAt 日期篩選）
    const periodAdj = useMemo(() => {
        return adjustments.filter(a => {
            const d = tsToDayTW(new Date(a.createdAt).getTime());
            if (startDate && d < startDate) return false;
            if (endDate   && d > endDate)   return false;
            return true;
        });
    }, [adjustments, startDate, endDate]);
    const periodAdjTotal = useMemo(() => periodAdj.reduce((s, a) => s + (a.amount || 0), 0), [periodAdj]);

    // 平日 vs 假日日均統計
    const wwKpi = useMemo(() => {
        const dayMap = new Map();
        slotOrders.forEach(o => {
            const d = tsToDayTW(o.timestamp);
            const ex = dayMap.get(d) || { date: d, revenue: 0, customers: 0 };
            let orderNonRevenue = 0;
            (o.items || []).forEach(item => {
                if (nonRevenueCats.has(item.category)) orderNonRevenue += item.price * item.quantity;
            });
            ex.revenue += o.total - orderNonRevenue;
            ex.customers += o.adjustedCustomerCount || 0;
            dayMap.set(d, ex);
        });
        const weekdays = [], weekends = [];
        dayMap.forEach(day => {
            const dow = new Date(day.date + 'T12:00:00+08:00').getDay();
            (dow === 0 || dow === 6 ? weekends : weekdays).push(day);
        });
        const calc = (arr) => {
            if (arr.length === 0) return { days: 0, avgRevenue: 0, avgCustomers: 0, avgSpend: 0 };
            const totalRev = arr.reduce((s, d) => s + d.revenue, 0);
            const totalCust = arr.reduce((s, d) => s + d.customers, 0);
            return {
                days: arr.length,
                avgRevenue:   Math.round(totalRev / arr.length),
                avgCustomers: Math.round(totalCust / arr.length),
                avgSpend:     totalCust > 0 ? Math.round(totalRev / totalCust) : 0,
            };
        };
        return { weekday: calc(weekdays), weekend: calc(weekends) };
    }, [slotOrders, nonRevenueCats]);

    const isSingleDay = startDate && endDate && startDate === endDate;

    // Hourly rows (11–21)
    const hourlyRows = useMemo(() => {
        const HOUR_START = 11, HOUR_END = 22;
        const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => ({
            label: `${String(HOUR_START + i).padStart(2, '0')}:00`, total: 0, customers: 0,
        }));
        slotOrders.forEach(o => {
            const h = tsToHourTW(o.timestamp);
            if (h < HOUR_START || h > HOUR_END) return;
            let orderFrozen = 0;
            (o.items || []).forEach(item => {
                if (nonRevenueCats.has(item.category)) orderFrozen += item.price * item.quantity;
            });
            hours[h - HOUR_START].total     += o.total - orderFrozen;
            hours[h - HOUR_START].customers += o.adjustedCustomerCount || 0;
        });
        const CORE_HOURS = new Set(
            summarySlot === 'lunch'  ? [12, 13, 14] :
            summarySlot === 'dinner' ? [16, 17, 18, 19] :
                                       [12, 13, 14, 16, 17, 18, 19]
        );
        return hours
            .map(r => ({ ...r, avgSpend: r.customers > 0 ? Math.round(r.total / r.customers) : 0 }))
            .filter(r => CORE_HOURS.has(parseInt(r.label)) || r.total > 0);
    }, [slotOrders, nonRevenueCats, summarySlot]);

    // Daily rows
    const dailyRows = useMemo(() => {
        const dayMap = new Map();
        slotOrders.forEach(o => {
            const d = tsToDayTW(o.timestamp);
            const ex = dayMap.get(d) || { label: d, total: 0, customers: 0 };
            let orderFrozen = 0;
            (o.items || []).forEach(item => {
                if (nonRevenueCats.has(item.category)) orderFrozen += item.price * item.quantity;
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
            ...r,
            avgSpend: r.customers > 0 ? Math.round(r.total / r.customers) : 0,
            dayOfWeek: getDayOfWeek(r.label),
        }));
        return rows.sort((a, b) => a.label.localeCompare(b.label));
    }, [slotOrders, startDate, endDate, nonRevenueCats]);

    // Dynamic group KPI cards (one per non-'营業額' reportGroup)
    const GROUP_CARD_COLORS = [
        { gradFrom: '#C87848', gradTo: '#DFA07A', textColor: 'text-[#7A3A18]' },
        { gradFrom: '#5A9870', gradTo: '#88B898', textColor: 'text-[#1A5838]' },
        { gradFrom: '#C09830', gradTo: '#DBC060', textColor: 'text-[#6A5010]' },
        { gradFrom: '#6890B0', gradTo: '#92AEC8', textColor: 'text-[#284868]' },
    ];
    const groupCards = Array.from(kpi.groupSalesMap.entries())
        .filter(([grp]) => kpi.groupShowKpi[grp] !== false)
        .map(([grp, amt], idx) => {
            const gc = GROUP_CARD_COLORS[idx % GROUP_CARD_COLORS.length];
            const include = kpi.groupInclude[grp] !== false;
            const prevAmt = prevKpi.groupSalesMap?.get(grp) || 0;
            return {
                label: `${grp}收益`,
                value: `$${formatCurrency(amt)}`,
                ...gc,
                sub: include ? '計入總營收' : '不計入總營收',
                delta: <Delta curr={amt} prev={prevAmt} isCurrency enabled={!!compPeriod} />,
            };
        });

    // KPI card definitions — all use flex-col so Delta always sits at the bottom
    const kpiCards = [
        {
            label: '總營收',   value: `$${formatCurrency(kpi.adjustedTotal + periodAdjTotal)}`,
            gradFrom: '#4A9A7A', gradTo: '#78BBAA', textColor: 'text-[#1A5A45]',
            sub: <>
                    {`白天 $${formatCurrency(kpi.day)}`}<br />{`晚上 $${formatCurrency(kpi.night)}`}
                    {periodAdjTotal !== 0 && <><br /><span className="text-gray-400">含折扣調整 {periodAdjTotal > 0 ? '+' : '−'}${formatCurrency(Math.abs(periodAdjTotal))}</span></>}
                  </>,
            delta: <Delta curr={kpi.adjustedTotal + periodAdjTotal} prev={prevKpi.adjustedTotal} isCurrency enabled={!!compPeriod} />,
        },
        {
            label: '餐點營收', value: `$${formatCurrency(kpi.dineIn)}`,
            gradFrom: '#D47856', gradTo: '#EAA07C', textColor: 'text-[#8A3A18]',
            sub: <>
                    {`白天 $${formatCurrency(kpi.day)}`}<br />{`晚上 $${formatCurrency(kpi.night)}`}
                    {periodAdjTotal !== 0 && <><br /><span className="text-orange-400">折扣 {periodAdjTotal > 0 ? '+' : '−'}${formatCurrency(Math.abs(periodAdjTotal))}</span></>}
                  </>,
            delta: <Delta curr={kpi.dineIn} prev={prevKpi.dineIn} isCurrency enabled={!!compPeriod} />,
        },
        ...groupCards,
        {
            label: '來客數',   value: `${kpi.customers} 人`,
            gradFrom: '#D0A830', gradTo: '#EAC860', textColor: 'text-[#7A5800]',
            sub: null,
            delta: <Delta curr={kpi.customers} prev={prevKpi.customers} enabled={!!compPeriod} />,
        },
        {
            label: '客單價',   value: `$${formatCurrency(kpi.avgSpend)}`,
            gradFrom: '#6888A8', gradTo: '#96AACC', textColor: 'text-[#2A4868]',
            sub: <>{`白天 $${formatCurrency(kpi.dayAvgSpend)}`}<br />{`晚上 $${formatCurrency(kpi.nightAvgSpend)}`}</>,
            delta: <Delta curr={kpi.avgSpend} prev={prevKpi.avgSpend} isCurrency enabled={!!compPeriod} />,
        },
    ];

    return (
        <div className="space-y-5">
            {/* 時段篩選 */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400">時段</span>
                <div className="flex gap-1">
                    {SUMMARY_SLOTS.map(s => (
                        <button key={s.key} onClick={() => setSummarySlot(s.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                                ${summarySlot === s.key ? 'bg-[#4A9A7A] text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI cards — flex-col + min-h ensures uniform layout */}
            {compPeriod && (
                <p className="text-xs text-gray-400">
                    ▲▼ 較上期（{compPeriod.hint}）：
                    <span className="font-semibold text-gray-500 ml-1">
                        {compPeriod.start === compPeriod.end
                            ? compPeriod.start
                            : `${compPeriod.start} ～ ${compPeriod.end}`}
                    </span>
                </p>
            )}
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(kpiCards.length, 6)}, minmax(0, 1fr))` }}>
                {kpiCards.map(c => (
                    <div key={c.label}
                        className="bg-white rounded-xl shadow flex flex-col relative overflow-hidden"
                        style={{ minHeight: 130 }}>
                        <div className="absolute left-0 top-0 bottom-0 w-1"
                            style={{ background: `linear-gradient(to bottom, ${c.gradFrom}, ${c.gradTo})` }} />
                        <div className="p-4 pl-5 flex flex-col flex-1">
                            <p className="text-xs font-bold text-gray-500 mb-1">{c.label}</p>
                            <p className={`text-2xl font-black ${c.textColor}`}>{c.value}</p>
                            {/* sub: always occupies space even when null */}
                            <p className="text-xs text-gray-400 mt-0.5 min-h-[16px]">{c.sub || ''}</p>
                            {c.delta}
                        </div>
                    </div>
                ))}
            </div>

            {/* 平日 vs 假日 */}
            {!isSingleDay && (wwKpi.weekday.days > 0 || wwKpi.weekend.days > 0) && (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-black text-gray-800">平日 vs 假日</h3>
                        <span className="text-xs text-gray-400">日平均</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="pl-5 pr-3 py-3 text-left text-xs font-bold text-gray-400 w-28"></th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600">
                                    平日
                                    <span className="ml-1 font-normal text-gray-400">一～五</span>
                                    <span className="ml-1.5 font-normal text-gray-400">({wwKpi.weekday.days} 天)</span>
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-[#D47856]">
                                    假日
                                    <span className="ml-1 font-normal text-gray-400">六、日</span>
                                    <span className="ml-1.5 font-normal text-gray-400">({wwKpi.weekend.days} 天)</span>
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-gray-400 w-20">差異</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {[
                                { label: '日均營收', wd: wwKpi.weekday.avgRevenue,   we: wwKpi.weekend.avgRevenue,   fmt: v => `$${formatCurrency(v)}` },
                                { label: '日均來客', wd: wwKpi.weekday.avgCustomers, we: wwKpi.weekend.avgCustomers, fmt: v => `${v} 人` },
                                { label: '客單價',   wd: wwKpi.weekday.avgSpend,     we: wwKpi.weekend.avgSpend,     fmt: v => `$${formatCurrency(v)}` },
                            ].map(r => {
                                const diff = r.wd > 0 && r.we > 0 ? Math.round((r.we - r.wd) / r.wd * 100) : null;
                                return (
                                    <tr key={r.label} className="hover:bg-gray-50">
                                        <td className="pl-5 pr-3 py-3.5 text-xs font-bold text-gray-500">{r.label}</td>
                                        <td className="px-4 py-3.5 text-center font-black text-gray-800">{r.wd > 0 ? r.fmt(r.wd) : '—'}</td>
                                        <td className="px-4 py-3.5 text-center font-black text-[#D47856] bg-[#D47856]/5">{r.we > 0 ? r.fmt(r.we) : '—'}</td>
                                        <td className="px-4 py-3.5 text-center text-xs font-bold">
                                            {diff !== null ? (
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${diff >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                                    {diff >= 0 ? '+' : ''}{diff}%
                                                </span>
                                            ) : <span className="text-gray-300">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Trend chart */}
            <TrendChart filteredOrders={slotOrders} isSingleDay={isSingleDay} nonRevenueCats={nonRevenueCats} />

            {/* Breakdown table */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="font-black text-gray-800">{isSingleDay ? '每小時業績' : '每日業績'}
                        {!isSingleDay && <span className="ml-2 text-xs font-normal text-gray-400">點擊欄位標題排序</span>}
                    </h3>
                </div>
                <BreakdownTable rows={isSingleDay ? hourlyRows : dailyRows} labelHeader={isSingleDay ? '小時' : '日期'} showDay={!isSingleDay} />
            </div>

            {/* Adjustment detail */}
            {periodAdj.length > 0 && (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-black text-gray-800">折扣 / 退款明細</h3>
                        <span className={`text-sm font-black ${periodAdjTotal < 0 ? 'text-orange-500' : 'text-green-600'}`}>
                            合計 {periodAdjTotal > 0 ? '+' : '−'}${formatCurrency(Math.abs(periodAdjTotal))}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">時間</th>
                                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">原因</th>
                                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500">受影響品項</th>
                                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 w-24">金額</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {periodAdj.map(a => (
                                    <tr key={a.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-400">
                                            {formatDateTime(new Date(a.createdAt).getTime())}
                                        </td>
                                        <td className="px-4 py-2 whitespace-nowrap">
                                            <span className={`font-bold ${a.amount < 0 ? 'text-orange-600' : 'text-green-700'}`}>{a.reasonPreset}</span>
                                            {a.reasonNote && <span className="text-gray-400 text-xs ml-1">（{a.reasonNote}）</span>}
                                        </td>
                                        <td className="px-4 py-2 text-gray-600 text-xs">
                                            {(a.affectedItems || []).map(i => i.name).join('、')}
                                        </td>
                                        <td className={`px-4 py-2 text-right font-black whitespace-nowrap ${a.amount < 0 ? 'text-orange-500' : 'text-green-600'}`}>
                                            {a.amount > 0 ? '+' : '−'}${formatCurrency(Math.abs(a.amount))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Receipt detail */}
            {(() => {
                const PAGE_SIZE = 30;
                // slotOrders is already newest-first (sorted by loadOrders b.timestamp - a.timestamp)
                const totalPages = Math.max(1, Math.ceil(slotOrders.length / PAGE_SIZE));
                const safePage = Math.min(historyPage, totalPages);
                const pageOrders = slotOrders.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
                return (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-black text-gray-800">
                            歷史單據明細
                            <span className="ml-2 text-xs font-normal text-gray-400">{slotOrders.length} 筆</span>
                        </h3>
                        {totalPages > 1 && (
                            <div className="flex items-center gap-1 text-xs font-bold">
                                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    ‹
                                </button>
                                <span className="px-2 text-gray-600">{safePage} / {totalPages}</span>
                                <button onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    ›
                                </button>
                            </div>
                        )}
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
                                {slotOrders.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">此日期區間無紀錄</td></tr>
                                ) : pageOrders.map((o, i) => (
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
                    {totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 font-bold">
                            <span>第 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, slotOrders.length)} 筆，共 {slotOrders.length} 筆</span>
                            <div className="flex items-center gap-1">
                                <button onClick={() => setHistoryPage(1)} disabled={safePage <= 1}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    «
                                </button>
                                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    ‹
                                </button>
                                <span className="px-2">{safePage} / {totalPages}</span>
                                <button onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    ›
                                </button>
                                <button onClick={() => setHistoryPage(totalPages)} disabled={safePage >= totalPages}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30 hover:bg-gray-50 transition-colors">
                                    »
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                );
            })()}
        </div>
    );
};

// ----------------------------------------------------------------------
// 銷售排行 Tab
// ----------------------------------------------------------------------
const TIME_SLOTS = [
    { key: 'all',    label: '全天' },
    { key: 'lunch',  label: '中午' },
    { key: 'dinner', label: '晚上' },
];

const RankingTab = ({ filteredOrders, nonRevenueCats }) => {
    const [itemSort,  setItemSort]  = useState({ key: 'revenue', dir: 'desc' });
    const [catSort,   setCatSort]   = useState({ key: 'revenue', dir: 'desc' });
    const [groupSort, setGroupSort] = useState({ key: 'revenue', dir: 'desc' });
    const [timeSlot,  setTimeSlot]  = useState('all');
    const [catFilter, setCatFilter] = useState('全部');

    const slotOrders = useMemo(() => {
        if (timeSlot === 'all') return filteredOrders;
        return filteredOrders.filter(o => {
            const min = tsToMinOfDayTW(o.timestamp);
            if (timeSlot === 'lunch')  return min >= 11 * 60 && min <= 16 * 60;
            if (timeSlot === 'dinner') return min >  16 * 60 && min <= 22 * 60;
            return true;
        });
    }, [filteredOrders, timeSlot]);

    const { itemRank, catRank, groupRank } = useMemo(() => {
        const itemMap  = new Map();
        const catMap   = new Map();
        const groupMap = new Map(); // { groupName -> Map<itemName, {name,qty,rev}> }
        slotOrders.forEach(o => {
            (o.items || []).forEach(item => {
                const rev = item.price * item.quantity;
                const cat = item.category || '未分類';
                const ex = itemMap.get(item.name) || { name: item.name, category: cat, quantity: 0, revenue: 0 };
                ex.quantity += item.quantity; ex.revenue += rev;
                itemMap.set(item.name, ex);

                const ce = catMap.get(cat) || { name: cat, quantity: 0, revenue: 0 };
                ce.quantity += item.quantity; ce.revenue += rev;
                catMap.set(cat, ce);

                if (nonRevenueCats.has(cat)) {
                    if (!groupMap.has(cat)) groupMap.set(cat, new Map());
                    const gm = groupMap.get(cat);
                    const ge = gm.get(item.name) || { name: item.name, quantity: 0, revenue: 0 };
                    ge.quantity += item.quantity; ge.revenue += rev;
                    gm.set(item.name, ge);
                }
            });
        });
        return {
            itemRank:  Array.from(itemMap.values()),
            catRank:   Array.from(catMap.values()),
            groupRank: Array.from(groupMap.entries()).map(([groupName, gm]) => ({
                groupName,
                items: Array.from(gm.values()),
            })),
        };
    }, [slotOrders, nonRevenueCats]);

    // 商品排行可用類別清單
    const itemCategories = useMemo(() => {
        const cats = new Set(itemRank.map(i => i.category).filter(Boolean));
        return ['全部', ...Array.from(cats).sort()];
    }, [itemRank]);

    // 篩選後商品排行
    const filteredItemRank = useMemo(() =>
        catFilter === '全部' ? itemRank : itemRank.filter(i => i.category === catFilter),
    [itemRank, catFilter]);

    const [selectedItem, setSelectedItem] = useState(null);
    const [trendMetric, setTrendMetric]   = useState('quantity');

    // 品項每日趨勢資料（依 slotOrders 計算，與時段切換連動）
    const trendData = useMemo(() => {
        if (!selectedItem) return [];
        const dayMap = new Map();
        slotOrders.forEach(o => {
            const d = tsToDayTW(o.timestamp);
            (o.items || []).forEach(item => {
                if (item.name !== selectedItem) return;
                const ex = dayMap.get(d) || { label: d, quantity: 0, revenue: 0 };
                ex.quantity += item.quantity;
                ex.revenue  += item.price * item.quantity;
                dayMap.set(d, ex);
            });
        });
        return Array.from(dayMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [selectedItem, slotOrders]);

    const sortBy = (arr, { key, dir }) => {
        const s = [...arr].sort((a, b) =>
            typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]
        );
        return dir === 'asc' ? s : s.reverse();
    };

    const handleSelectItem = (name) => setSelectedItem(prev => prev === name ? null : name);

    const RankTable = ({ data, sort, setSort, title, emptyMsg, showTrend = false }) => (
        <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-black text-gray-800">{title}</h3>
                <div className="flex gap-1.5">
                    <SortBtn label="銷售額" k="revenue"  currentSort={sort} setSort={setSort} />
                    <SortBtn label="銷售量" k="quantity" currentSort={sort} setSort={setSort} />
                    <SortBtn label="名稱"   k="name"     currentSort={sort} setSort={setSort} />
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
                        ) : data.map((item, i) => {
                            const isSelected = showTrend && selectedItem === item.name;
                            return (
                                <tr key={item.name}
                                    onClick={() => showTrend && handleSelectItem(item.name)}
                                    className={`${showTrend ? 'cursor-pointer' : ''} ${isSelected ? 'bg-[#4A9A7A]/10' : i === 0 && sort.key !== 'name' ? 'bg-yellow-50/60' : ''} hover:bg-[#4A9A7A]/5`}>
                                    <td className="px-4 py-2.5 text-center text-xs text-gray-400">{i + 1}</td>
                                    <td className={`px-4 py-2.5 font-bold ${isSelected ? 'text-[#4A9A7A]' : 'text-gray-800'}`}>
                                        {item.name}
                                        {showTrend && <span className="ml-1 text-[10px] font-normal text-gray-400">點擊趨勢</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-gray-600">{item.quantity} 份</td>
                                    <td className="px-4 py-2.5 text-right font-black text-gray-800">${formatCurrency(item.revenue)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const fmtTrend = trendMetric === 'revenue'
        ? v => (v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`)
        : v => String(v);

    return (
        <div className="space-y-5">
            {/* 時段切換 */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400">時段</span>
                <div className="flex gap-1">
                    {TIME_SLOTS.map(s => (
                        <button key={s.key} onClick={() => setTimeSlot(s.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                                ${timeSlot === s.key ? 'bg-[#4A9A7A] text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 品項銷售趨勢 */}
            {selectedItem && (
                <div className="bg-white rounded-xl shadow overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div>
                            <h3 className="font-black text-gray-800">{selectedItem} — 每日趨勢</h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                                {TIME_SLOTS.find(s => s.key === timeSlot)?.label}・共 {trendData.reduce((s, d) => s + d.quantity, 0)} 份
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                                {[{ k: 'quantity', label: '銷售量' }, { k: 'revenue', label: '銷售額' }].map(m => (
                                    <button key={m.k} onClick={() => setTrendMetric(m.k)}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors
                                            ${trendMetric === m.k ? 'bg-[#4A9A7A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => setSelectedItem(null)}
                                className="ml-1 text-gray-400 hover:text-gray-600 text-lg font-bold leading-none">×</button>
                        </div>
                    </div>
                    <div className="p-4" style={{ height: 220 }}>
                        {trendData.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400">此時段無資料</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} tickLine={false}
                                        axisLine={{ stroke: '#E5E7EB' }} interval="preserveStartEnd" />
                                    <YAxis tickFormatter={fmtTrend} tick={{ fontSize: 11, fill: '#9CA3AF' }}
                                        tickLine={false} axisLine={false} width={48} />
                                    <Tooltip
                                        formatter={v => trendMetric === 'revenue' ? [`$${formatCurrency(v)}`, '銷售額'] : [`${v} 份`, '銷售量']}
                                        contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12 }}
                                        cursor={{ stroke: '#4A9A7A', strokeWidth: 1, strokeDasharray: '4 2' }}
                                    />
                                    <Line type="monotone" dataKey={trendMetric} stroke="#4A9A7A" strokeWidth={2.5}
                                        dot={{ r: 4, fill: '#fff', stroke: '#4A9A7A', strokeWidth: 2 }}
                                        activeDot={{ r: 5, fill: '#4A9A7A' }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            )}

            {/* 商品類別篩選 */}
            {itemCategories.length > 2 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-400">類別</span>
                    <div className="flex gap-1 flex-wrap">
                        {itemCategories.map(cat => (
                            <button key={cat} onClick={() => { setCatFilter(cat); setSelectedItem(null); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors
                                    ${catFilter === cat ? 'bg-[#4A9A7A] text-white' : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50'}`}>
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-5">
                <RankTable data={sortBy(filteredItemRank, itemSort)} sort={itemSort} setSort={setItemSort} title="🏆 商品銷售排行" showTrend />
                <RankTable data={sortBy(catRank,          catSort)}  sort={catSort}  setSort={setCatSort}  title="🔖 類別銷售排行" />
            </div>
            {groupRank.map(({ groupName, items }) => (
                <RankTable
                    key={groupName}
                    data={sortBy(items, groupSort)}
                    sort={groupSort} setSort={setGroupSort}
                    title={`🧊 ${groupName} 銷售排行`}
                    emptyMsg={`此日期區間無${groupName}銷售紀錄`}
                />
            ))}
        </div>
    );
};

// ----------------------------------------------------------------------
// Main Report Page
// ----------------------------------------------------------------------
const ReportPage = () => {
    const [orders, setOrders]           = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [isLoading, setIsLoading]     = useState(true);
    const [tab, setTab]                 = useState('summary');
    const [startDate, setStartDate]     = useState(today());
    const [endDate,   setEndDate]       = useState(today());
    const [catSettings, setCatSettings] = useState([]);

    useEffect(() => { loadOrders(); }, []);

    // 非營業額類別 Set（動態，預設含冷凍包）
    const nonRevenueCats = useMemo(() => {
        if (catSettings.length === 0) return new Set(['冷凍包']);
        return new Set(catSettings.filter(c => c.reportGroup !== '營業額').map(c => c.name));
    }, [catSettings]);

    const loadOrders = async () => {
        setIsLoading(true);
        try {
            const [raw, cats, adjData] = await Promise.all([
                getReportOrders(),
                getCategorySettings(),
                fetch('/api/adjustments').then(r => r.json()).catch(() => []),
            ]);
            setAdjustments(Array.isArray(adjData) ? adjData : []);
            setCatSettings(cats);
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
    const compPeriod = useMemo(() => {
        if (!startDate || !endDate) return null;
        const nDays = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
        let cStart, cEnd, hint;
        if (nDays === 1) {
            // 往前掃最近有業績的同一星期幾（最多 8 週）
            const orderDays = new Set(orders.map(o => tsToDayTW(o.timestamp)));
            let found = null;
            for (let w = 1; w <= 8; w++) {
                const candidate = addDays(startDate, -7 * w);
                if (orderDays.has(candidate)) { found = { candidate, w }; break; }
            }
            if (!found) return null;
            cStart = found.candidate;
            cEnd   = found.candidate;
            hint   = found.w === 1
                ? '上週同日'
                : `最近同${DAY_ZH[new Date(cStart + 'T12:00:00+08:00').getDay()]}（${cStart}）`;
        } else if (startDate.endsWith('-01')) {
            const prevYear = (y) => `${parseInt(y.slice(0, 4)) - 1}${y.slice(4)}`;
            cStart = prevYear(startDate);
            cEnd   = prevYear(endDate);
            hint   = '去年同期';
        } else {
            cEnd   = addDays(startDate, -1);
            cStart = addDays(startDate, -nDays);
            hint   = `前 ${nDays} 天`;
        }
        return { start: cStart, end: cEnd, hint };
    }, [startDate, endDate, orders]);

    const compOrders = useMemo(() => {
        if (!compPeriod) return [];
        return orders.filter(o => {
            const d = tsToDayTW(o.timestamp);
            return d >= compPeriod.start && d <= compPeriod.end;
        });
    }, [orders, compPeriod]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#4A9A7A]"></div>
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
                            ${tab === t.key ? 'bg-white text-[#4A9A7A] shadow' : 'text-gray-500 hover:text-gray-700'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'summary'
                ? <SummaryTab
                    filteredOrders={filteredOrders}
                    compOrders={compOrders}
                    compPeriod={compPeriod}
                    startDate={startDate}
                    endDate={endDate}
                    nonRevenueCats={nonRevenueCats}
                    catSettings={catSettings}
                    adjustments={adjustments}
                  />
                : <RankingTab filteredOrders={filteredOrders} nonRevenueCats={nonRevenueCats} />
            }
        </div>
    );
};

export default ReportPage;

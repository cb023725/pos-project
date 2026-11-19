// src/pages/Settings.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getStoreCalendar, saveStoreCalendarDay, deleteStoreCalendarDay, getExternalEvents, saveExternalEvents } from '../db';

const pad2 = (n) => String(n).padStart(2, '0');
const toDateKey = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayKey = () => { const d = new Date(); return toDateKey(d.getFullYear(), d.getMonth(), d.getDate()); };
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

// 當月 6x7 日曆格（含上下月補齊的日期）
const buildMonthGrid = (year, month) => {
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        days.push({
            key: toDateKey(d.getFullYear(), d.getMonth(), d.getDate()),
            day: d.getDate(),
            inMonth: d.getMonth() === month,
        });
    }
    return days;
};

const entryStatus = (e) => {
    if (!e) return null;
    if (!e.lunchOpen && !e.dinnerOpen) return { text: '休', cls: 'bg-red-100 text-red-600' };
    if (!e.lunchOpen) return { text: '午休', cls: 'bg-amber-100 text-amber-600' };
    if (!e.dinnerOpen) return { text: '晚休', cls: 'bg-amber-100 text-amber-600' };
    return { text: '備註', cls: 'bg-blue-100 text-blue-600' };
};

const StoreCalendarCard = () => {
    const today = new Date();
    const [viewYear, setViewYear] = useState(today.getFullYear());
    const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
    const [entries, setEntries] = useState(new Map()); // date -> {lunchOpen,dinnerOpen,note}
    const [selected, setSelected] = useState(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [bulkForm, setBulkForm] = useState({ lunchOpen: false, dinnerOpen: false, note: '' });

    const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
    const rangeStart = grid[0].key;
    const rangeEnd = grid[41].key;

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const rows = await getStoreCalendar(rangeStart, rangeEnd);
            const m = new Map();
            rows.forEach(r => m.set(r.date, { lunchOpen: r.lunchOpen, dinnerOpen: r.dinnerOpen, note: r.note || '' }));
            setEntries(m);
        } finally {
            setIsLoading(false);
        }
    }, [rangeStart, rangeEnd]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setSelected(new Set()); }, [viewYear, viewMonth]);

    const changeMonth = (delta) => {
        let y = viewYear, m = viewMonth + delta;
        if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
        setViewYear(y); setViewMonth(m);
    };
    const goToday = () => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); };

    const toggleDay = (dateKey) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
            return next;
        });
    };

    const toggleBulkField = (field) => setBulkForm(f => ({ ...f, [field]: !f[field] }));

    const handleApply = async () => {
        if (selected.size === 0) return;
        setSaving(true);
        try {
            await Promise.all([...selected].map(date =>
                saveStoreCalendarDay(date, { lunchOpen: bulkForm.lunchOpen, dinnerOpen: bulkForm.dinnerOpen, note: bulkForm.note })
            ));
            setSelected(new Set());
            await load();
        } catch (e) {
            alert('儲存失敗：' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleClearSelected = async () => {
        if (selected.size === 0) return;
        if (!window.confirm(`確定移除已選取 ${selected.size} 天的店休標記？（恢復為正常營業日）`)) return;
        setSaving(true);
        try {
            await Promise.all([...selected].map(date => deleteStoreCalendarDay(date)));
            setSelected(new Set());
            await load();
        } catch (e) {
            alert('移除失敗：' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const selectWeekends = () => {
        setSelected(prev => {
            const next = new Set(prev);
            grid.filter(d => d.inMonth).forEach(d => {
                const dow = new Date(d.key + 'T12:00:00').getDay();
                if (dow === 0 || dow === 6) next.add(d.key);
            });
            return next;
        });
    };

    const tdKey = todayKey();

    return (
        <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-black text-gray-800 mb-1">店休日曆</h2>
            <p className="text-sm text-gray-400 mb-5">在日曆上點選多天，一次標記全天店休、只休午餐或只休晚餐。沒有標記的日子一律視為正常營業。</p>

            {/* 月份導覽 */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <button onClick={() => changeMonth(-1)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">‹</button>
                    <span className="text-lg font-black text-gray-800 w-28 text-center">{viewYear}年{viewMonth + 1}月</span>
                    <button onClick={() => changeMonth(1)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">›</button>
                    <button onClick={goToday} className="ml-1 text-xs font-bold text-[#4A9A7A] hover:underline">回到今天</button>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" />全天店休</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 inline-block" />只休半天</span>
                    <button onClick={selectWeekends} className="font-bold text-[#4A9A7A] hover:underline ml-2">選取本月週末</button>
                </div>
            </div>

            {/* 日曆格 */}
            <div className="grid grid-cols-7 gap-1 mb-5">
                {WEEKDAY_ZH.map(w => (
                    <div key={w} className="text-center text-xs font-bold text-gray-400 py-1">{w}</div>
                ))}
                {grid.map(({ key, day, inMonth }) => {
                    const entry = entries.get(key);
                    const status = entryStatus(entry);
                    const isSelected = selected.has(key);
                    const isToday = key === tdKey;
                    return (
                        <button
                            key={key}
                            onClick={() => toggleDay(key)}
                            disabled={isLoading}
                            className={`relative h-16 rounded-lg border p-1.5 text-left transition-colors
                                ${inMonth ? 'bg-white' : 'bg-gray-50'}
                                ${isSelected ? 'border-[#4A9A7A] border-2 ring-2 ring-[#4A9A7A]/30' : 'border-gray-100'}
                                hover:border-[#4A9A7A] disabled:opacity-50`}
                        >
                            <span className={`text-sm font-bold ${inMonth ? (isToday ? 'text-[#4A9A7A]' : 'text-gray-700') : 'text-gray-300'}`}>
                                {day}
                            </span>
                            {isToday && <span className="ml-1 text-[9px] text-[#4A9A7A] font-bold">今天</span>}
                            {status && (
                                <span className={`absolute bottom-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${status.cls}`}>
                                    {status.text}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* 批次操作列 */}
            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                <div className="flex flex-wrap items-end gap-4">
                    <div className="text-sm font-bold text-gray-600">
                        已選 <span className="text-[#4A9A7A] text-base">{selected.size}</span> 天
                    </div>
                    {[
                        { field: 'lunchOpen', label: '午餐營業' },
                        { field: 'dinnerOpen', label: '晚餐營業' },
                    ].map(({ field, label }) => (
                        <label key={field} className="flex items-center gap-2 cursor-pointer">
                            <div
                                onClick={() => toggleBulkField(field)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${bulkForm[field] ? 'bg-[#4A9A7A]' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${bulkForm[field] ? 'translate-x-7' : 'translate-x-1'}`} />
                            </div>
                            <span className="text-sm font-bold text-gray-600">{label}</span>
                        </label>
                    ))}
                    <div className="flex-1 min-w-[160px]">
                        <input
                            type="text"
                            value={bulkForm.note}
                            onChange={e => setBulkForm(f => ({ ...f, note: e.target.value }))}
                            placeholder="備註，例如：過年、公休"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                        />
                    </div>
                    <button
                        onClick={handleApply}
                        disabled={saving || selected.size === 0}
                        className="bg-[#4A9A7A] text-white font-bold px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40"
                    >
                        {saving ? '儲存中…' : '套用到已選日期'}
                    </button>
                    <button
                        onClick={handleClearSelected}
                        disabled={saving || selected.size === 0}
                        className="text-red-500 font-bold px-3 py-2.5 rounded-lg hover:bg-red-50 disabled:opacity-40"
                    >
                        移除標記
                    </button>
                    {selected.size > 0 && (
                        <button onClick={() => setSelected(new Set())} className="text-gray-400 font-bold px-2 py-2.5 hover:text-gray-600">
                            取消選取
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// 外部事件紀錄：廣告設定變更、菜單調價、營業時間變動…讓 AI 分析時知道業績變化的外部原因
const ExternalEventsCard = () => {
    const [events, setEvents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ date: todayKey(), change: '', note: '' });

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const rows = await getExternalEvents();
            setEvents(rows.sort((a, b) => b.date.localeCompare(a.date)));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async () => {
        if (!form.date || !form.change.trim()) { alert('日期與變動內容為必填'); return; }
        setSaving(true);
        try {
            const next = [...events, { ...form, change: form.change.trim() }];
            await saveExternalEvents(next);
            setForm({ date: todayKey(), change: '', note: '' });
            await load();
        } catch (e) {
            alert('儲存失敗：' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (idx) => {
        const target = events[idx];
        if (!window.confirm(`確定刪除「${target.date} ${target.change}」這筆紀錄？`)) return;
        try {
            const next = events.filter((_, i) => i !== idx);
            await saveExternalEvents(next);
            await load();
        } catch (e) {
            alert('刪除失敗：' + e.message);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-black text-gray-800 mb-1">外部事件紀錄</h2>
            <p className="text-sm text-gray-400 mb-5">記錄廣告設定變更、菜單調價、營業時間變動等，讓 AI 分析業績變化時能對照外部原因。</p>

            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">日期</label>
                        <input
                            type="date"
                            value={form.date}
                            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-base"
                        />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                        <label className="block text-xs font-bold text-gray-500 mb-1">變動內容</label>
                        <input
                            type="text"
                            value={form.change}
                            onChange={e => setForm(f => ({ ...f, change: e.target.value }))}
                            placeholder="例如：廣告設定變更、菜單調價"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                        />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                        <label className="block text-xs font-bold text-gray-500 mb-1">備註（選填）</label>
                        <input
                            type="text"
                            value={form.note}
                            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                        />
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={saving}
                        className="bg-[#4A9A7A] text-white font-bold px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                        {saving ? '儲存中…' : '新增'}
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="text-center text-gray-400 py-8">載入中…</div>
            ) : events.length === 0 ? (
                <p className="text-gray-400 text-sm py-4">尚未記錄任何事件</p>
            ) : (
                <div className="divide-y divide-gray-100">
                    {events.map((e, idx) => (
                        <div key={`${e.date}-${idx}`} className="flex items-center justify-between py-3">
                            <div>
                                <span className="font-bold text-gray-700">{e.date}</span>
                                <span className="ml-2 text-gray-700">{e.change}</span>
                                {e.note && <span className="ml-2 text-sm text-gray-400">{e.note}</span>}
                            </div>
                            <button onClick={() => handleDelete(idx)} className="text-sm font-bold text-red-500 hover:underline">刪除</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const SettingsPage = () => (
    <div className="p-5 font-sans bg-gray-50 min-h-full">
        <h1 className="text-2xl font-black text-gray-900 mb-5">設定</h1>
        <div className="max-w-3xl space-y-5">
            <StoreCalendarCard />
            <ExternalEventsCard />
        </div>
    </div>
);

export default SettingsPage;

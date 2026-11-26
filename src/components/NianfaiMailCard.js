// src/components/NianfaiMailCard.js — 年菜管理頁「寄信」
// 一打開就看到三種信的進度（可寄／已寄／客人已確認／不寄），點一種信列出每位客人的狀態：
//   可寄、已寄出、已開信（僅供參考）、客人已確認、寄送失敗、不寄（原因）
// 篩選「已寄未確認」就是需要電話提醒的名單。勾選可寄的客人 → 寄出。
// 寄信狀態與試算表「📧 年菜寄信」選單共用，兩邊寄過的不會重寄。
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getNianfaiMailOverview, sendNianfaiMail, setNianfaiReminder, setNianfaiDeliveryReminder } from '../db';
import { formatPickupDate } from '../utils/nianfai';

const TYPES = [
    { key: 'preShip', label: '寄出前確認', who: '宅配', desc: '請客人確認收件資訊（寄出前幾天寄）' },
    { key: 'shipped', label: '出貨通知', who: '宅配', desc: '附託運單號；要先在 Sheet「宅配」填出貨日與託運單號' },
    { key: 'pickupReminder', label: '取貨提醒', who: '自取', desc: '提醒取貨日與時段' },
];
const STATUS = {
    ready: { text: '可寄', cls: 'bg-blue-50 text-blue-700' },
    failed: { text: '寄送失敗', cls: 'bg-red-100 text-red-700' },
    sent: { text: '已寄出', cls: 'bg-sky-100 text-sky-800' },
    opened: { text: '已開信', cls: 'bg-violet-100 text-violet-800' },
    acked: { text: '客人已確認', cls: 'bg-green-100 text-green-800' },
    skip: { text: '不寄', cls: 'bg-gray-100 text-gray-500' },
};
const FILTERS = [
    { key: 'ready', label: '可寄', match: r => r.status === 'ready' || r.status === 'failed' },
    { key: 'waiting', label: '已寄未確認', match: r => r.status === 'sent' || r.status === 'opened' },
    { key: 'acked', label: '客人已確認', match: r => r.status === 'acked' },
    { key: 'skip', label: '不寄', match: r => r.status === 'skip' },
    { key: 'all', label: '全部', match: () => true },
];
const short = (t) => String(t || '').slice(5, 16); // MM/dd HH:mm
// 「2027/01/20 20:00」⇄ <input type="datetime-local"> 的「2027-01-20T20:00」
const toInputDt = (t) => (t ? String(t).replace(/\//g, '-').replace(' ', 'T') : '');
const fromInputDt = (v) => (v ? String(v).replace(/-/g, '/').replace('T', ' ') : '');

const Switch = ({ on, disabled, onClick }) => (
    <button onClick={onClick} disabled={disabled} role="switch" aria-checked={!!on}
        className={`relative flex-shrink-0 w-14 h-8 rounded-full transition disabled:opacity-50 ${on ? 'bg-[#4A9A7A]' : 'bg-gray-300'}`}>
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
    </button>
);
const tomorrowIso = () => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function NianfaiMailCard({ year, number, gas, showAlert, showConfirm, onChanged }) {
    const [data, setData] = useState(null); // { quota, types: { preShip: { rows } } }
    const [loadError, setLoadError] = useState('');
    const [type, setType] = useState('preShip');
    const [filter, setFilter] = useState('ready');
    const [date, setDate] = useState('');
    const [checked, setChecked] = useState(new Set());
    const [busy, setBusy] = useState('');
    const rem = gas?.reminders;
    const [deliveryAt, setDeliveryAt] = useState('');
    useEffect(() => { setDeliveryAt(toInputDt(rem?.delivery?.at)); }, [rem?.delivery?.at]);

    const load = useCallback(async () => {
        setLoadError('');
        try { setData(await getNianfaiMailOverview(year)); }
        catch (e) { setLoadError(e.message); }
    }, [year]);
    useEffect(() => { load(); }, [load]);

    const allRows = useMemo(() => (data?.types?.[type]?.rows) || [], [data, type]);
    // 取貨提醒：依取貨日分組（預設明天，沒有就第一個還有人可寄的日子）
    const dates = useMemo(() => {
        if (type !== 'pickupReminder') return [];
        const m = new Map();
        allRows.forEach(r => { if (r.pickupDate) { const x = m.get(r.pickupDate) || { total: 0, ready: 0 }; x.total++; if (r.status === 'ready' || r.status === 'failed') x.ready++; m.set(r.pickupDate, x); } });
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, x]) => ({ date: d, ...x }));
    }, [allRows, type]);
    useEffect(() => {
        if (type !== 'pickupReminder' || !dates.length) return;
        if (dates.some(d => d.date === date)) return;
        const t = dates.find(d => d.date === tomorrowIso()) || dates.find(d => d.ready > 0) || dates[0];
        setDate(t.date);
    }, [type, dates, date]);
    const rows = useMemo(() => type === 'pickupReminder' ? allRows.filter(r => r.pickupDate === date) : allRows, [allRows, type, date]);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.key, rows.filter(f.match).length])), [rows]);
    const shown = useMemo(() => rows.filter(FILTERS.find(f => f.key === filter).match), [rows, filter]);
    const sendable = useMemo(() => rows.filter(r => r.status === 'ready' || r.status === 'failed'), [rows]);

    // 換信件種類／日期：預設勾選全部可寄
    useEffect(() => { setChecked(new Set(sendable.filter(r => r.status === 'ready').map(r => r.id))); }, [sendable]);
    useEffect(() => { setFilter('ready'); }, [type]);

    const toggle = (id) => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const current = TYPES.find(t => t.key === type);
    const selectedIds = sendable.filter(r => checked.has(r.id)).map(r => r.id);

    const handleSend = async () => {
        if (!selectedIds.length) return;
        if (!await showConfirm(`寄出 ${selectedIds.length} 封「${current.label}」`, {
            title: '確認寄信', icon: 'info', confirmText: '寄出',
            note: data?.quota != null && selectedIds.length > data.quota ? `今天只剩 ${data.quota} 封可寄，超過的明天再寄` : '寄過的不會重寄',
        })) return;
        setBusy('send');
        try {
            const r = (await sendNianfaiMail(year, type, selectedIds, type === 'pickupReminder' ? date : null)).result;
            const notes = [];
            if (r.failed.length) notes.push('寄送失敗：\n' + r.failed.map(x => `・${x.name}：${x.error}`).join('\n'));
            if (r.overQuota.length) notes.push('今天額度用完，明天再寄：' + r.overQuota.map(x => x.name).join('、'));
            await showAlert(`已寄出 ${r.sent.length} 封`, { title: r.failed.length ? '部分寄送失敗' : '寄信完成', icon: r.failed.length ? 'warning' : 'success', note: notes.join('\n\n') || undefined });
        } catch (e) {
            await showAlert(e.message, { title: '寄信失敗', icon: 'warning' });
        } finally {
            setBusy('');
            load();
        }
    };

    const handleReminder = async () => {
        const on = !gas?.reminderOn;
        if (!await showConfirm(on ? '每天 08:00 自動寄取貨提醒給「明天」取貨的客人' : '停止自動寄取貨提醒', {
            title: on ? '開啟自動取貨提醒' : '關閉自動取貨提醒', icon: 'info', confirmText: on ? '開啟' : '關閉',
            note: on ? '寄完會把名單寄到店家信箱；失敗的會重試一次' : undefined,
        })) return;
        setBusy('reminder');
        try { await setNianfaiReminder(year, on); onChanged?.(); }
        catch (e) { await showAlert(e.message, { title: '設定失敗', icon: 'warning' }); }
        finally { setBusy(''); }
    };

    const handleDeliveryReminder = async ({ on, at }) => {
        if (on !== undefined && !await showConfirm(on ? '到設定的時間自動寄「寄出前確認」給所有宅配客' : '停止自動寄宅配提醒', {
            title: on ? '開啟自動宅配提醒' : '關閉自動宅配提醒', icon: 'info', confirmText: on ? '開啟' : '關閉',
        })) return;
        setBusy('delivery');
        try { await setNianfaiDeliveryReminder(year, { on, at: at === undefined ? undefined : fromInputDt(at) }); onChanged?.(); }
        catch (e) { await showAlert(e.message, { title: '設定失敗', icon: 'warning' }); }
        finally { setBusy(''); }
    };

    const typeSummary = (k) => {
        let rs = (data?.types?.[k]?.rows) || [];
        const c = (f) => rs.filter(FILTERS.find(x => x.key === f).match).length;
        return { ready: c('ready'), waiting: c('waiting'), acked: c('acked'), skip: c('skip'), failed: rs.filter(r => r.status === 'failed').length };
    };

    return (
        <div className="bg-white rounded-xl shadow p-6 mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h3 className="text-xl font-bold text-gray-700">{number}. 寄信</h3>
                <div className="flex items-center gap-3 text-sm">
                    {data?.quota != null && <span className="text-gray-500">今天 Gmail 還能寄 <b className="text-gray-800">{data.quota}</b> 封</span>}
                    <button onClick={load} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-bold hover:bg-gray-200 disabled:opacity-50">重新整理</button>
                </div>
            </div>
            <p className="text-sm text-gray-500 mb-4">和試算表「📧 年菜寄信」選單共用寄信狀態，兩邊寄過的都不會重寄。「已寄未確認」的客人可以電話提醒。</p>

            {/* 自動提醒：宅配（寄出前確認）／自取（取貨提醒），條件不符就不寄並提醒 */}
            {rem && (
                <div className="mb-4 rounded-xl border border-gray-200 divide-y divide-gray-100">
                    <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm">
                                <span className="font-bold text-gray-800">自動宅配提醒</span>
                                <span className="text-gray-500 ml-2">到設定時間自動寄「寄出前確認」給所有宅配客（附加熱說明小卡）</span>
                            </div>
                            <Switch on={rem.delivery.on} disabled={!!busy || !gas?.ok} onClick={() => handleDeliveryReminder({ on: !rem.delivery.on })} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-gray-600">寄出時間</span>
                            <input type="datetime-local" value={deliveryAt} onChange={e => setDeliveryAt(e.target.value)}
                                className="border border-gray-300 rounded-lg px-2 py-1.5" />
                            <button onClick={() => handleDeliveryReminder({ at: deliveryAt })} disabled={!!busy || toInputDt(rem.delivery.at) === deliveryAt}
                                className="px-3 py-1.5 rounded-lg font-bold text-white bg-gray-700 disabled:opacity-40">{busy === 'delivery' ? '儲存中...' : '儲存時間'}</button>
                        </div>
                        {rem.delivery.on && (rem.delivery.problem
                            ? <p className="text-sm font-bold text-red-600">⚠️ {rem.delivery.problem}</p>
                            : rem.delivery.sentAt
                                ? <p className="text-sm text-green-700 font-bold">✓ 已在 {rem.delivery.sentAt} 自動寄出（之後新增的宅配客請手動寄）</p>
                                : <p className="text-sm text-gray-600">將在 <b>{rem.delivery.at}</b> 自動寄出（時間到後 10 分鐘內）{!rem.live && '，正式上線後才會自動寄'}</p>)}
                        {rem.delivery.on && !rem.delivery.sentAt && rem.pickup.problem && <p className="text-sm font-bold text-red-600">⚠️ {rem.pickup.problem}：寄出前確認也要附小卡，時間到也不會寄出（會寄信通知店家）</p>}
                    </div>
                    <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm">
                                <span className="font-bold text-gray-800">自動取貨提醒</span>
                                <span className="text-gray-500 ml-2">每天 08:00 寄給明天取貨的客人（附加熱說明小卡）</span>
                            </div>
                            <Switch on={rem.pickup.on} disabled={!!busy || !gas?.ok} onClick={handleReminder} />
                        </div>
                        {rem.pickup.on && (rem.pickup.problem
                            ? <p className="text-sm font-bold text-red-600">⚠️ {rem.pickup.problem}：自動取貨提醒不會寄出（到時會寄信通知店家）。請到試算表「設定」填「加熱說明小卡ID」</p>
                            : <p className="text-sm text-gray-600">加熱說明小卡正常{!rem.live && '，正式上線後才會自動寄'}</p>)}
                    </div>
                </div>
            )}

            {/* 三種信的進度 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {TYPES.map(t => {
                    const s = typeSummary(t.key);
                    const on = type === t.key;
                    return (
                        <button key={t.key} onClick={() => setType(t.key)}
                            className={`text-left rounded-xl border-2 p-4 transition ${on ? 'border-[#C1032F] bg-red-50/40' : 'border-gray-200 hover:border-gray-300'}`}>
                            <div className="flex items-baseline justify-between">
                                <span className="font-bold text-gray-800 text-lg">{t.label}</span>
                                <span className="text-xs text-gray-400">{t.who}</span>
                            </div>
                            {data ? (
                                <>
                                    <div className="mt-1"><span className="text-3xl font-black text-[#C1032F]">{s.ready}</span><span className="text-sm text-gray-500 ml-1">封可寄</span></div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        已寄未確認 <b className="text-gray-700">{s.waiting}</b>｜已確認 <b className="text-green-700">{s.acked}</b>｜不寄 {s.skip}
                                        {s.failed > 0 && <span className="text-red-600 font-bold">｜失敗 {s.failed}</span>}
                                    </div>
                                </>
                            ) : <div className="text-sm text-gray-400 mt-2">{loadError ? '讀取失敗' : '讀取中...'}</div>}
                        </button>
                    );
                })}
            </div>

            {/* 取貨提醒：自動寄送＋取貨日 */}
            {type === 'pickupReminder' && (
                <div className="mb-3 space-y-3">
                    {dates.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {dates.map(d => (
                                <button key={d.date} onClick={() => setDate(d.date)}
                                    className={`px-3 py-2 rounded-lg text-sm font-bold border ${date === d.date ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}>
                                    {formatPickupDate(d.date)}{d.date === tomorrowIso() ? '・明天' : ''}
                                    <span className={`ml-2 ${date === d.date ? 'text-white/80' : 'text-gray-400'}`}>{d.total} 人</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <p className="text-sm text-gray-500 mb-2">{current.desc}</p>

            {/* 篩選 */}
            <div className="flex flex-wrap gap-2 mb-2">
                {FILTERS.map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                        className={`px-3 py-1.5 rounded-full text-sm font-bold ${filter === f.key ? 'bg-[#C1032F] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {f.label} {counts[f.key] ?? 0}
                    </button>
                ))}
            </div>

            {/* 名單 */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
                    {!data && <p className="text-center text-gray-400 py-8">{loadError ? `讀取失敗：${loadError}` : '讀取中...'}</p>}
                    {data && shown.length === 0 && <p className="text-center text-gray-400 py-8">沒有符合的客人</p>}
                    {shown.map(r => {
                        const st = STATUS[r.status];
                        const canSend = r.status === 'ready' || r.status === 'failed';
                        return (
                            <label key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${canSend ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
                                <input type="checkbox" className="w-5 h-5 flex-shrink-0" disabled={!canSend} checked={canSend && checked.has(r.id)} onChange={() => toggle(r.id)} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-800 truncate">{r.name || '（未填姓名）'}</span>
                                        {r.onsite && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">現場單</span>}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">{r.phone}{r.email ? `　${r.email}` : ''}</div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <span className={`inline-block text-xs font-bold px-2 py-1 rounded-full ${st.cls}`}>{st.text}{r.at && r.status !== 'skip' ? ` ${short(r.at)}` : ''}</span>
                                    {r.reason && <div className={`text-xs mt-1 ${r.status === 'failed' || /託運單號|出貨日/.test(r.reason) ? 'text-red-600 font-bold' : 'text-gray-400'}`}>{r.reason}</div>}
                                </div>
                            </label>
                        );
                    })}
                </div>
                {/* 寄出列 */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 bg-gray-50 border-t border-gray-200">
                    <div className="text-sm text-gray-600">
                        已選 <b className="text-gray-800">{selectedIds.length}</b> / {sendable.length} 位
                        {sendable.length > 0 && (
                            <>
                                <button onClick={() => setChecked(new Set(sendable.map(r => r.id)))} className="ml-3 text-[#4A9A7A] font-bold">全選</button>
                                <button onClick={() => setChecked(new Set())} className="ml-3 text-gray-500 font-bold">全不選</button>
                            </>
                        )}
                    </div>
                    <button onClick={handleSend} disabled={!!busy || selectedIds.length === 0}
                        className="px-6 py-2.5 rounded-lg font-bold text-white bg-[#C1032F] hover:bg-[#A0022A] disabled:opacity-40">
                        {busy === 'send' ? '寄送中...' : `寄出 ${selectedIds.length} 封${current.label}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

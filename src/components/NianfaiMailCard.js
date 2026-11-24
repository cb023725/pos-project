// src/components/NianfaiMailCard.js — 年菜管理頁「寄信」
// 寄出前確認、出貨通知（宅配）、取貨提醒（自取）：先預覽名單（含跳過原因、今天剩餘可寄封數），勾選確認後才寄。
// 取貨提醒另有每天 08:00 自動寄給明天取貨客人的開關（Google 端「設定」的「取貨提醒開關」）。
// 寄信狀態與時間會寫回 Sheet「宅配」「自取」，寄過的不會重寄、現場單不寄。
import React, { useState, useEffect } from 'react';
import { previewNianfaiMail, sendNianfaiMail, setNianfaiReminder, getSettingValue } from '../db';
import { formatPickupDate } from '../utils/nianfai';

const TYPES = [
    { key: 'preShip', label: '寄出前確認', desc: '宅配單：請客人確認收件資訊（寄出前幾天寄）' },
    { key: 'shipped', label: '出貨通知', desc: '宅配單：附託運單號與加熱說明小卡。要先在 Sheet「宅配」填出貨日與託運單號' },
    { key: 'pickupReminder', label: '取貨提醒', desc: '自取單：提醒取貨日與時段，附加熱說明小卡' },
];

const tomorrowIso = () => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function NianfaiMailCard({ year, number, gas, showAlert, showConfirm, onChanged }) {
    const [type, setType] = useState('preShip');
    const [date, setDate] = useState(tomorrowIso());
    const [pickupDates, setPickupDates] = useState([]);
    const [preview, setPreview] = useState(null);
    const [checked, setChecked] = useState(new Set());
    const [busy, setBusy] = useState('');

    useEffect(() => {
        getSettingValue(`nianfai_${year}_pickup_dates`).then(v => {
            try { setPickupDates(JSON.parse(v || '[]')); } catch { setPickupDates([]); }
        });
    }, [year]);

    useEffect(() => { setPreview(null); }, [type, date]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { await showAlert(e.message, { title: '操作失敗', icon: 'warning' }); } finally { setBusy(''); }
    };

    const handlePreview = () => run('preview', async () => {
        const r = await previewNianfaiMail(year, type, type === 'pickupReminder' ? date : null);
        setPreview(r.result);
        setChecked(new Set(r.result.eligible.map(x => x.id)));
    });

    const handleSend = () => run('send', async () => {
        const ids = preview.eligible.filter(x => checked.has(x.id)).map(x => x.id);
        if (!ids.length) return;
        const label = TYPES.find(t => t.key === type).label;
        if (!await showConfirm(`寄出 ${ids.length} 封「${label}」`, {
            title: '確認寄信', icon: 'info', confirmText: '寄出',
            note: preview.quota !== null && ids.length > preview.quota ? `今天只剩 ${preview.quota} 封可寄，超過的明天再寄` : '寄過的不會重寄',
        })) return;
        const r = (await sendNianfaiMail(year, type, ids, type === 'pickupReminder' ? date : null)).result;
        const notes = [];
        if (r.failed.length) notes.push('寄送失敗：\n' + r.failed.map(x => `・${x.name}：${x.error}`).join('\n'));
        if (r.overQuota.length) notes.push('今天額度用完，明天再寄：' + r.overQuota.map(x => x.name).join('、'));
        await showAlert(`已寄出 ${r.sent.length} 封`, {
            title: r.failed.length ? '部分寄送失敗' : '寄信完成', icon: r.failed.length ? 'warning' : 'success', note: notes.join('\n\n') || undefined,
        });
        setPreview(null);
        onChanged?.();
    });

    const handleReminder = (on) => run('reminder', async () => {
        if (!await showConfirm(on ? '每天 08:00 自動寄取貨提醒給「明天」取貨的客人' : '停止自動寄取貨提醒', {
            title: on ? '開啟自動取貨提醒' : '關閉自動取貨提醒', icon: 'info', confirmText: on ? '開啟' : '關閉',
            note: on ? '寄完會把名單寄到店家信箱；失敗的會重試一次' : undefined,
        })) return;
        await setNianfaiReminder(year, on);
        onChanged?.();
    });

    const toggle = (id) => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const current = TYPES.find(t => t.key === type);
    const sendCount = preview ? preview.eligible.filter(x => checked.has(x.id)).length : 0;

    return (
        <div className="bg-white rounded-xl shadow p-6 mt-5">
            <h3 className="text-xl font-bold text-gray-700 mb-1">{number}. 寄信</h3>
            <p className="text-sm text-gray-500 mb-4">
                先預覽名單、勾選確認後才寄。寄過的不會重寄，現場單不寄（宅配用簡訊／LINE 通知，自取客人有顧客聯）。
                寄信狀態會寫回 Sheet「宅配」「自取」。
                {gas?.mailQuota != null && <> 今天 Gmail 還能寄 <b>{gas.mailQuota}</b> 封（一般帳號每天約 100 封，含確認信）。</>}
            </p>

            <div className="flex items-center justify-between gap-3 p-3 mb-4 rounded-lg bg-gray-50">
                <div>
                    <p className="font-bold text-gray-800">自動取貨提醒</p>
                    <p className="text-sm text-gray-500">每天 08:00 寄給明天取貨的客人{gas?.phase !== 'live' && '（正式上線後才會自動寄）'}</p>
                </div>
                <button onClick={() => handleReminder(!gas?.reminderOn)} disabled={!!busy || !gas?.ok}
                    className={`px-4 py-2 rounded-lg font-bold text-white disabled:opacity-50 ${gas?.reminderOn ? 'bg-[#4A9A7A]' : 'bg-gray-400'}`}>
                    {busy === 'reminder' ? '處理中...' : gas?.reminderOn ? '已開啟' : '已關閉'}
                </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-2">
                {TYPES.map(t => (
                    <button key={t.key} onClick={() => setType(t.key)}
                        className={`px-4 py-2 rounded-lg font-bold ${type === t.key ? 'bg-[#C1032F] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {t.label}
                    </button>
                ))}
            </div>
            <p className="text-sm text-gray-500 mb-3">{current.desc}</p>

            <div className="flex flex-wrap items-center gap-3 mb-3">
                {type === 'pickupReminder' && (
                    <select value={date} onChange={e => setDate(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-base">
                        {!pickupDates.includes(date) && <option value={date}>{formatPickupDate(date)}（明天）</option>}
                        {pickupDates.map(d => <option key={d} value={d}>{formatPickupDate(d)}{d === tomorrowIso() ? '（明天）' : ''}</option>)}
                    </select>
                )}
                <button onClick={handlePreview} disabled={!!busy}
                    className="px-5 py-2.5 rounded-lg font-bold text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-50">
                    {busy === 'preview' ? '讀取中...' : '預覽名單'}
                </button>
            </div>

            {preview && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                    <div>
                        <p className="font-bold text-gray-800 mb-2">
                            可寄 {preview.eligible.length} 封{preview.date ? `（${preview.date} 取貨）` : ''}
                        </p>
                        {preview.eligible.length === 0 && <p className="text-sm text-gray-400">沒有要寄的</p>}
                        <div className="space-y-1 max-h-72 overflow-y-auto">
                            {preview.eligible.map(x => (
                                <label key={x.id} className="flex items-center gap-3 text-base py-1">
                                    <input type="checkbox" className="w-5 h-5" checked={checked.has(x.id)} onChange={() => toggle(x.id)} />
                                    <span className="font-bold w-24 truncate">{x.name}</span>
                                    <span className="text-gray-500 truncate">{x.email}</span>
                                    {x.failed && <span className="text-xs font-bold text-red-600">上次失敗</span>}
                                </label>
                            ))}
                        </div>
                    </div>
                    {preview.skipped.length > 0 && (
                        <div>
                            <p className="font-bold text-gray-500 mb-1">不寄 {preview.skipped.length} 筆</p>
                            <div className="text-sm text-gray-500 space-y-0.5 max-h-48 overflow-y-auto">
                                {preview.skipped.map(x => <p key={x.id}>・{x.name}：{x.reason}</p>)}
                            </div>
                        </div>
                    )}
                    <button onClick={handleSend} disabled={!!busy || sendCount === 0}
                        className="px-5 py-2.5 rounded-lg font-bold text-white bg-[#C1032F] hover:bg-[#A0022A] disabled:opacity-50">
                        {busy === 'send' ? '寄送中...' : `寄出 ${sendCount} 封`}
                    </button>
                </div>
            )}
        </div>
    );
}

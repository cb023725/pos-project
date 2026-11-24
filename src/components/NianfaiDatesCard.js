// src/components/NianfaiDatesCard.js — 年菜管理頁「取貨與寄出日期」（每年初始化後設定）
// 存在 app_settings（每個年度各自一組）：
//   nianfai_<年>_pickup_dates    自取日清單（JSON 陣列 YYYY-MM-DD）→ 點單頁、補資料下拉、表單取貨日選項
//   nianfai_<年>_last_pickup_end 最後一天取貨結束時間（例 16:00，除夕前一天）
//   nianfai_<年>_ship_dates      宅配寄出起訖（JSON { start, end }）
//   nianfai_<年>_delivery_period 宅配寄出期間文字（由起訖產生，例「2027/1/25 (一) ~ 1/27 (三)」）
// 自取與寄出日期都設定好才能開賣（onStatusChange 回報給年菜管理頁）。
import React, { useState, useEffect, useMemo } from 'react';
import { getSettingValue, saveSettingValue } from '../db';
import { formatDateSlash, dateRange } from '../utils/nianfai';

const parseJson = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export default function NianfaiDatesCard({ year, number, onStatusChange, showAlert }) {
    const [pickStart, setPickStart] = useState('');
    const [pickEnd, setPickEnd] = useState('');
    const [selected, setSelected] = useState(new Set()); // 有開放自取的日子
    const [lastEnd, setLastEnd] = useState('16:00');
    const [shipStart, setShipStart] = useState('');
    const [shipEnd, setShipEnd] = useState('');
    const [saved, setSaved] = useState(null); // 已儲存的內容（判斷有沒有未儲存的修改）
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!year) return;
        (async () => {
            const [p, l, sh] = await Promise.all([
                getSettingValue(`nianfai_${year}_pickup_dates`, '[]'),
                getSettingValue(`nianfai_${year}_last_pickup_end`, '16:00'),
                getSettingValue(`nianfai_${year}_ship_dates`, '{}'),
            ]);
            const dates = (parseJson(p, []) || []).slice().sort();
            const ship = parseJson(sh, {}) || {};
            setPickStart(dates[0] || ''); setPickEnd(dates[dates.length - 1] || '');
            setSelected(new Set(dates));
            setLastEnd(l || '16:00');
            setShipStart(ship.start || ''); setShipEnd(ship.end || '');
            setSaved({ dates: dates.join(','), lastEnd: l || '16:00', ship: `${ship.start || ''}~${ship.end || ''}` });
        })();
    }, [year]);

    const days = useMemo(() => dateRange(pickStart, pickEnd), [pickStart, pickEnd]);
    const pickupDates = days.filter(d => selected.has(d));
    const ready = !!saved && saved.dates !== '' && saved.ship !== '~';
    const dirty = !!saved && (pickupDates.join(',') !== saved.dates || lastEnd !== saved.lastEnd || `${shipStart}~${shipEnd}` !== saved.ship);

    useEffect(() => { onStatusChange?.(ready); }, [ready, onStatusChange]);

    // 改起訖日時，新範圍內的日子預設全部開放（年菜自取連續 7 天，不跳過公休日）
    const changeRange = (start, end) => {
        setPickStart(start); setPickEnd(end);
        setSelected(new Set(dateRange(start, end)));
    };
    const toggle = (d) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(d)) next.delete(d); else next.add(d);
        return next;
    });

    const shipText = shipStart && shipEnd
        ? `${formatDateSlash(shipStart)} ~ ${formatDateSlash(shipEnd, shipStart.slice(0, 4) !== shipEnd.slice(0, 4))}`
        : '';

    const handleSave = async () => {
        if (!pickupDates.length) { await showAlert('請設定至少一天自取日', { title: '自取日未設定', icon: 'warning' }); return; }
        if (!shipStart || !shipEnd || shipStart > shipEnd) { await showAlert('請設定宅配寄出的開始與結束日', { title: '寄出日未設定', icon: 'warning' }); return; }
        setSaving(true);
        try {
            await Promise.all([
                saveSettingValue(`nianfai_${year}_pickup_dates`, JSON.stringify(pickupDates)),
                saveSettingValue(`nianfai_${year}_last_pickup_end`, lastEnd),
                saveSettingValue(`nianfai_${year}_ship_dates`, JSON.stringify({ start: shipStart, end: shipEnd })),
                saveSettingValue(`nianfai_${year}_delivery_period`, shipText),
            ]);
            setSaved({ dates: pickupDates.join(','), lastEnd, ship: `${shipStart}~${shipEnd}` });
            await showAlert('記得到「Google 表單／Sheet」重新同步', { title: '日期已儲存', icon: 'success' });
        } catch (e) {
            await showAlert(e.message, { title: '儲存失敗', icon: 'warning' });
        } finally {
            setSaving(false);
        }
    };

    const input = 'border border-gray-300 rounded-lg p-2 text-base';
    return (
        <div className="bg-white rounded-xl shadow p-6 mb-5">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-xl font-bold text-gray-700">{number}. 取貨與寄出日期（{year}）</h3>
                {!ready && <span className="text-sm font-bold text-red-600 bg-red-50 rounded-lg px-2 py-1">尚未設定，不能開賣</span>}
            </div>
            <p className="text-sm text-gray-500 mb-4">每年初始化後設定。自取日會用在點單頁、補資料與表單選項；寄出期間會印在顧客聯與確認信上。</p>

            <div className="space-y-4">
                <div>
                    <p className="font-bold text-gray-700 mb-2">來店自取</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <input type="date" className={input} value={pickStart} onChange={e => changeRange(e.target.value, pickEnd < e.target.value ? e.target.value : pickEnd)} />
                        <span className="text-gray-400">～</span>
                        <input type="date" className={input} value={pickEnd} min={pickStart} onChange={e => changeRange(pickStart, e.target.value)} />
                        <span className="text-sm text-gray-500 ml-2">最後一天取貨到</span>
                        <input type="time" className={`${input} w-36`} value={lastEnd} onChange={e => setLastEnd(e.target.value)} />
                    </div>
                    {days.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            {days.map(d => (
                                <button key={d} type="button" onClick={() => toggle(d)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${selected.has(d) ? 'bg-[#4A9A7A] border-[#4A9A7A] text-white' : 'bg-white border-gray-300 text-gray-400 line-through'}`}>
                                    {formatDateSlash(d, false)}
                                </button>
                            ))}
                        </div>
                    )}
                    {days.length > 0 && <p className="text-xs text-gray-400 mt-1">點日期可以取消／恢復；目前開放 {pickupDates.length} 天</p>}
                </div>

                <div>
                    <p className="font-bold text-gray-700 mb-2">宅配寄出</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <input type="date" className={input} value={shipStart} onChange={e => setShipStart(e.target.value)} />
                        <span className="text-gray-400">～</span>
                        <input type="date" className={input} value={shipEnd} min={shipStart} onChange={e => setShipEnd(e.target.value)} />
                        {shipText && <span className="text-sm text-gray-500 ml-2">顯示為：{shipText}</span>}
                    </div>
                </div>
            </div>

            <button onClick={handleSave} disabled={saving || !dirty}
                className="mt-5 px-5 py-2.5 rounded-lg bg-[#4A9A7A] text-white font-bold disabled:opacity-40">
                {saving ? '儲存中...' : dirty ? '儲存日期' : '已儲存'}
            </button>
        </div>
    );
}

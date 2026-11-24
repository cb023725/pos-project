// src/components/NianfaiGoogleCard.js — 年菜管理頁「Google 表單／Sheet」
// GAS 是一支獨立的「年菜系統」專案（gas/nianfai/），每年由這裡一鍵建立該年度的試算表與表單：
//   1. 建立 Google 試算表與表單（需先設定取貨、寄出日期與預購截止日）
//   2. Yw 到表單上 review、修正說明文字與圖片（不要改題目名稱、選項、單點品名）
//   3. 檢查表單對應 → 通過才能開賣（年菜管理頁的開賣按鈕會擋）
// 之後品項、價格、日期有變動：同步品項到 Sheet → 同步到表單（先看差異）→ 再檢查一次。
import React, { useState, useEffect, useCallback } from 'react';
import {
    getNianfaiGasStatus, createNianfaiSheet, syncNianfaiSettingsToSheet,
    nianfaiFormSync, checkNianfaiForm, protectNianfaiSheet,
} from '../db';

export default function NianfaiGoogleCard({ year, number, datesReady, showAlert, showConfirm, onStatusChange }) {
    const [gas, setGas] = useState(null); // null = 檢查中
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        setGas(null);
        let g;
        try { g = await getNianfaiGasStatus(year); } catch (e) { g = { configured: true, ok: false, error: e.message }; }
        setGas(g);
        onStatusChange?.(g);
    }, [year, onStatusChange]);

    useEffect(() => { if (year) load(); }, [year, load]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { await showAlert(e.message, { title: '操作失敗', icon: 'warning' }); } finally { setBusy(''); load(); }
    };

    const handleCreate = () => run('create', async () => {
        if (!await showConfirm(`在雲端硬碟建立「${year} 年菜訂單」試算表與預購表單`, {
            title: '建立 Google 試算表與表單', icon: 'info', note: '建立後請到表單上檢查、修改文案與圖片', confirmText: '建立',
        })) return;
        await createNianfaiSheet(year);
        await showAlert('請打開表單檢查文案、上傳圖片，完成後按「檢查表單對應」', { title: '已建立', icon: 'success' });
    });

    const handleSyncSettings = () => run('sync', async () => {
        if (!await showConfirm(`把 ${year} 年菜品項、價格、日期寫入「設定」分頁`, { title: '同步品項到 Sheet', icon: 'info', confirmText: '同步' })) return;
        const r = await syncNianfaiSettingsToSheet(year);
        await showAlert(`已同步 ${r.items} 個品項\n如果品名、價格或取貨日有變動，請再按「同步到表單」`, { title: '同步完成', icon: 'success' });
    });

    const handleFormSync = () => run('form', async () => {
        const plan = await nianfaiFormSync(year, false);
        if (plan.warnings.length) await showAlert(plan.warnings.join('\n'), { title: '請注意', icon: 'warning' });
        if (!plan.changes.length) { await showAlert('表單已經和「設定」一致', { title: '不需要更新', icon: 'info' }); return; }
        const ok = await showConfirm(plan.changes.join('\n'), {
            title: '將更新表單', icon: 'warning', confirmText: '套用',
            note: plan.hasResponses ? '表單已經有回應，開賣期間不要改品名（品名是對應欄位的依據）' : '只更新題目名稱與選項，說明文字、圖片不會動',
        });
        if (!ok) return;
        await nianfaiFormSync(year, true);
        await showAlert('已更新表單，請再按「檢查表單對應」', { title: '已套用', icon: 'success' });
    });

    const handleCheck = () => run('check', async () => {
        const r = await checkNianfaiForm(year);
        if (r.passed) await showAlert('每個品項與欄位都對應正確，可以開賣', { title: '檢查通過', icon: 'success' });
        else await showAlert('請修正以下問題後再檢查一次', { title: '檢查未通過', icon: 'warning', note: r.problems.join('\n') });
    });

    const handleProtect = () => run('protect', async () => {
        await protectNianfaiSheet(year);
        await showAlert('匯款資訊只有你能改；表單回應與品項表修改前會跳警告', { title: '已重新套用保護範圍', icon: 'success' });
    });

    const btn = 'px-4 py-2.5 rounded-lg font-bold disabled:opacity-40';
    const link = 'text-[#4A9A7A] font-bold underline';
    const fc = gas?.formCheck;

    return (
        <div className="bg-white rounded-xl shadow p-6 mt-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold text-gray-700">{number}. Google 表單／Sheet</h3>
                <button onClick={load} className="text-sm font-bold text-gray-500 hover:text-gray-700">重新檢查</button>
            </div>

            {gas === null ? (
                <p className="text-gray-400">檢查連線中...</p>
            ) : !gas.configured ? (
                <p className="text-gray-500">尚未設定 GAS 網址與密鑰（NIANFAI_GAS_URL／NIANFAI_GAS_SECRET）。現場單會停在「待傳送」，設定後自動補送。</p>
            ) : !gas.ok ? (
                <p className="text-red-600 font-bold"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-2" />連線失敗：{gas.error}</p>
            ) : !gas.created ? (
                <div>
                    <p className="text-gray-700"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />年菜系統已連線，{year} 年的試算表與表單還沒建立。</p>
                    {!datesReady && <p className="text-sm font-bold text-red-600 mt-2">請先在上方設定取貨、寄出日期與預購截止日</p>}
                    <button onClick={handleCreate} disabled={!!busy || !datesReady} className={`${btn} mt-4 bg-[#4A9A7A] text-white`}>
                        {busy === 'create' ? '建立中（約 1 分鐘）...' : '建立 Google 試算表與表單'}
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="space-y-1 text-gray-700">
                        <p><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />{gas.spreadsheet}{gas.env === 'dev' && <span className="ml-2 text-xs text-orange-600 font-bold">測試環境</span>}</p>
                        <p className="text-sm">
                            <a href={gas.spreadsheetUrl} target="_blank" rel="noreferrer" className={link}>開啟試算表</a>
                            <span className="mx-2 text-gray-300">｜</span>
                            <a href={gas.formEditUrl} target="_blank" rel="noreferrer" className={link}>編輯表單</a>
                            <span className="mx-2 text-gray-300">｜</span>
                            <a href={gas.formUrl} target="_blank" rel="noreferrer" className={link}>表單預覽</a>
                        </p>
                        <p className="text-sm text-gray-500">
                            設定品項 {gas.items} 項・表單
                            <span className={`font-bold ml-1 ${gas.formAccepting ? 'text-green-600' : 'text-red-600'}`}>{gas.formAccepting ? '開放中' : '已關閉'}</span>
                        </p>
                        <p className={`text-sm font-bold ${fc?.passed ? 'text-green-700' : 'text-red-600'}`}>
                            表單對應：{fc ? (fc.passed ? `已通過（${new Date(fc.at).toLocaleString('zh-TW', { hour12: false })}）` : '未通過，請修正後再檢查') : '尚未檢查，開賣前必須通過'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleCheck} disabled={!!busy} className={`${btn} bg-[#4A9A7A] text-white`}>{busy === 'check' ? '檢查中...' : '檢查表單對應'}</button>
                        <button onClick={handleSyncSettings} disabled={!!busy} className={`${btn} bg-gray-700 text-white`}>{busy === 'sync' ? '同步中...' : '同步品項到 Sheet'}</button>
                        <button onClick={handleFormSync} disabled={!!busy} className={`${btn} bg-gray-700 text-white`}>{busy === 'form' ? '處理中...' : '同步到表單'}</button>
                        <button onClick={handleProtect} disabled={!!busy} className={`${btn} bg-gray-100 text-gray-600`}>{busy === 'protect' ? '處理中...' : '重新套用保護範圍'}</button>
                    </div>
                    <p className="text-xs text-gray-400">
                        可以自由修改表單的說明文字、段落說明、圖片與主題；請不要改題目名稱、選項與單點品名（改了「檢查表單對應」會擋下）。
                    </p>
                </div>
            )}
        </div>
    );
}

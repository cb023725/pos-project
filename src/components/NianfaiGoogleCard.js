// src/components/NianfaiGoogleCard.js — 年菜管理頁「Google 表單／Sheet」（步驟式）
// GAS 是一支獨立的「年菜系統」專案（gas/nianfai/），每年由這裡一鍵建立該年度的試算表與表單：
//   ① 建立試算表與表單 → ② 檢查、修改表單文案 → ③ 檢查表單對應 → ④ 真實測試 → ⑤ 測試完畢，正式上線
// 正式上線會清空所有測試資料（Google 表單回覆、表單回應、WebPOS 年菜單、流水號歸 27001），每年只能一次。
import React, { useState, useEffect, useCallback } from 'react';
import {
    getNianfaiGasStatus, createNianfaiSheet, syncNianfaiSettingsToSheet,
    nianfaiFormSync, checkNianfaiForm, protectNianfaiSheet, rebuildNianfaiTabs,
    goLiveNianfai, backToTestingNianfai, generateNianfaiFormImage, getNianfaiFormLinks,
} from '../db';

const Step = ({ n, title, done, active, children }) => (
    <div className={`flex gap-3 ${active || done ? '' : 'opacity-50'}`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm
            ${done ? 'bg-[#4A9A7A] text-white' : active ? 'bg-[#C1032F] text-white' : 'bg-gray-200 text-gray-500'}`}>
            {done ? '✓' : n}
        </div>
        <div className="flex-1 pb-4 border-b border-gray-100 last:border-0">
            <p className="font-bold text-gray-800">{title}</p>
            <div className="text-sm text-gray-600 mt-1 space-y-2">{children}</div>
        </div>
    </div>
);

export default function NianfaiGoogleCard({ year, number, datesReady, showAlert, showConfirm, onStatusChange, reloadKey }) {
    const [gas, setGas] = useState(null); // null = 檢查中
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        setGas(null);
        let g;
        try { g = await getNianfaiGasStatus(year); } catch (e) { g = { configured: true, ok: false, error: e.message }; }
        setGas(g);
        onStatusChange?.(g);
    }, [year, onStatusChange]);

    useEffect(() => { if (year) load(); }, [year, load, reloadKey]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { await showAlert(e.message, { title: '操作失敗', icon: 'warning' }); } finally { setBusy(''); load(); }
    };

    const handleCreate = () => run('create', async () => {
        if (!await showConfirm(`在雲端硬碟建立「${year} 年菜訂單」試算表與預購表單`, {
            title: '建立 Google 試算表與表單', icon: 'info', note: '建立後是「測試中」，可以真實送單測試', confirmText: '建立',
        })) return;
        await createNianfaiSheet(year);
        await showAlert('請進行第 ② 步：打開表單檢查文案、上傳圖片', { title: '已建立', icon: 'success' });
    });

    const handleFormImage = () => run('image', async () => {
        await generateNianfaiFormImage(year);
        await showAlert('已放到表單最上方，請打開「預覽表單」確認', { title: '說明圖片已更新', icon: 'success' });
    });

    // 海報用短網址與 QR code
    const [links, setLinks] = useState(null);
    useEffect(() => {
        if (!year || !gas?.created) return;
        getNianfaiFormLinks(year).then(setLinks).catch(e => setLinks({ error: e.message }));
    }, [year, gas?.created]);

    const handleCheck = () => run('check', async () => {
        const r = await checkNianfaiForm(year);
        if (r.passed) await showAlert('每個品項與欄位都對應正確', { title: '檢查通過', icon: 'success' });
        else await showAlert('請修正以下問題後再檢查一次', { title: '檢查未通過', icon: 'warning', note: r.problems.join('\n') });
    });

    const handleGoLive = () => run('golive', async () => {
        if (!await showConfirm(`${year} 年菜測試完畢，正式上線`, {
            title: '正式上線', icon: 'danger', confirmText: '清空並上線', danger: true,
            note: '會清空：Google 表單所有回覆、試算表表單回應與修改紀錄、WebPOS 這個年度的年菜單與發票，流水號從 ' + (year % 100) + '001 重新開始。每個年度只能做一次，無法復原。',
        })) return;
        const r = await goLiveNianfai(year);
        await showAlert(`已清空 ${r.sheetCleared} 筆表單回應、${r.clearedOrders} 張 WebPOS 年菜單\n正式客人從表單回應第 2 列開始`, { title: '已正式上線', icon: 'success' });
    });

    const handleBackToTesting = () => run('back', async () => {
        if (!await showConfirm('把年度改回「測試中」（只有測試環境有這個按鈕）', { title: '回到測試', icon: 'warning', confirmText: '回到測試' })) return;
        await backToTestingNianfai(year);
    });

    const handleSyncSettings = () => run('sync', async () => {
        if (!await showConfirm(`把 ${year} 年菜品項、價格、日期寫入「設定」分頁`, { title: '同步品項到 Sheet', icon: 'info', confirmText: '同步' })) return;
        const r = await syncNianfaiSettingsToSheet(year);
        await showAlert(`已同步 ${r.items} 個品項\n品名、價格或取貨日有變動的話，接著按「同步到表單」`, { title: '同步完成', icon: 'success' });
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

    const handleRebuild = () => run('rebuild', async () => {
        if (!await showConfirm('依目前品項重建「宅配」「自取」「查詢」「統計」「備料表」', {
            title: '重建分頁', icon: 'warning', confirmText: '重建',
            note: '付款、出貨日、託運單號、已取貨、寄信狀態會保留；表單回應與修改紀錄不受影響',
        })) return;
        await rebuildNianfaiTabs(year);
        await showAlert('分頁已重建', { title: '完成', icon: 'success' });
    });

    const handleProtect = () => run('protect', async () => {
        await protectNianfaiSheet(year);
        await showAlert('匯款資訊只有你能改；表單回應與品項表修改前會跳警告', { title: '已重新套用保護範圍', icon: 'success' });
    });

    const btn = 'px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-40';
    const link = 'text-[#4A9A7A] font-bold underline';
    const fc = gas?.formCheck;
    const created = !!gas?.created;
    const live = gas?.phase === 'live';
    const checked = !!fc?.passed;

    return (
        <div className="bg-white rounded-xl shadow p-6 mt-5">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-xl font-bold text-gray-700">{number}. Google 表單／Sheet</h3>
                <button onClick={load} className="text-sm font-bold text-gray-500 hover:text-gray-700">重新整理</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">線上預購表單與訂單試算表。照下面的步驟完成，第 ⑤ 步正式上線後才能開賣。</p>

            {gas === null ? (
                <p className="text-gray-400">檢查連線中...</p>
            ) : !gas.configured ? (
                <p className="text-gray-500">尚未設定 GAS 網址與密鑰（NIANFAI_GAS_URL／NIANFAI_GAS_SECRET）。現場單會停在「待傳送」，設定後自動補送。</p>
            ) : !gas.ok ? (
                <p className="text-red-600 font-bold">年菜系統連線失敗：{gas.error}</p>
            ) : (
                <>
                    {created && (
                        <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
                            <span className={`px-2.5 py-1 rounded-full font-black ${live ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                {live ? `已正式上線（${gas.liveAt || ''}）` : '測試中'}
                            </span>
                            <span className={`px-2.5 py-1 rounded-full font-bold ${gas.formAccepting ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                表單{gas.formAccepting ? '開放中' : '已關閉'}
                            </span>
                            {gas.env === 'dev' && <span className="px-2.5 py-1 rounded-full font-bold bg-gray-100 text-gray-500">測試環境</span>}
                        </div>
                    )}

                    <div className="space-y-4">
                        <Step n={1} title="建立試算表與表單" done={created} active={!created}>
                            {created ? (
                                <p>已建立「{gas.spreadsheet}」（雲端硬碟「咕咕義年菜{gas.env === 'dev' ? '（測試）' : ''}」資料夾）</p>
                            ) : (
                                <>
                                    <p>依 WebPOS 的品項、價格、日期，照 2026 年的格式建立預購表單與訂單試算表（約 1 分鐘）。</p>
                                    {!datesReady && <p className="font-bold text-red-600">請先在上方設定取貨、寄出日期與預購截止日</p>}
                                    <button onClick={handleCreate} disabled={!!busy || !datesReady} className={`${btn} bg-[#4A9A7A] text-white`}>
                                        {busy === 'create' ? '建立中...' : '建立試算表與表單'}
                                    </button>
                                </>
                            )}
                        </Step>

                        <Step n={2} title="檢查、修改表單文案與圖片" done={created && checked} active={created}>
                            <p>
                                <a href={gas.formEditUrl} target="_blank" rel="noreferrer" className={link}>編輯表單</a>
                                <span className="mx-2 text-gray-300">｜</span>
                                <a href={gas.formUrl} target="_blank" rel="noreferrer" className={link}>預覽表單</a>
                                <span className="mx-2 text-gray-300">｜</span>
                                <a href={gas.spreadsheetUrl} target="_blank" rel="noreferrer" className={link}>開啟試算表</a>
                            </p>
                            <p>可以改：說明文字、段落說明、圖片、主題顏色。<span className="text-red-600 font-bold">不要改：題目名稱、選項、單點品名</span>（改了第 ③ 步會擋下）。</p>
                            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                                <p className="font-bold text-gray-700">說明圖片</p>
                                <p>Google 表單的說明只能純文字，這裡依品項、價格、運費、店家資訊畫成有標題和重點顏色的圖片，放在表單最上方（重新產生會替換同一張）。原本的文字說明不會動，要不要刪由你決定。</p>
                                <p>
                                    <a href={`/api/nianfai/form-image.png?year=${year}`} target="_blank" rel="noreferrer" className={link}>預覽圖片</a>
                                    <button onClick={handleFormImage} disabled={!!busy || !created} className={`${btn} ml-3 bg-gray-700 text-white`}>{busy === 'image' ? '產生中...' : '產生並放到表單'}</button>
                                </p>
                            </div>
                        </Step>

                        <Step n={3} title="檢查表單對應" done={checked} active={created}>
                            <p>確認每個品項、每個欄位在表單與試算表都對得上。改過表單或品項後要再檢查一次。</p>
                            <p className={`font-bold ${checked ? 'text-green-700' : 'text-red-600'}`}>
                                {fc ? (checked ? `已通過（${new Date(fc.at).toLocaleString('zh-TW', { hour12: false })}）` : '未通過') : '尚未檢查'}
                            </p>
                            <button onClick={handleCheck} disabled={!!busy || !created} className={`${btn} bg-[#4A9A7A] text-white`}>{busy === 'check' ? '檢查中...' : '檢查表單對應'}</button>
                        </Step>

                        <Step n={4} title="真實測試" done={live} active={created && !live}>
                            <p>用 WebPOS 年菜點單、補資料送出，也可以直接在表單網頁填幾張，確認：表單回應有新增、確認信有收到、宅配／自取有出現、統計／備料表數字正確。</p>
                        </Step>

                        <Step n={5} title="測試完畢，正式上線" done={live} active={created && checked && !live}>
                            {live ? (
                                <>
                                    <p>已清空測試資料，正式客人從表單回應第 2 列開始，WebPOS 訂購編號流水號從 001 開始（例 {year % 100}YYMMDD001）。</p>
                                    {gas.env === 'dev' && (
                                        <button onClick={handleBackToTesting} disabled={!!busy} className={`${btn} bg-gray-100 text-gray-600`}>{busy === 'back' ? '處理中...' : '回到測試（只限測試環境）'}</button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p>清空所有測試資料（表單回覆、表單回應、WebPOS 年菜單與發票），訂購編號流水號歸 001。<span className="font-bold">每年只能一次。</span></p>
                                    <button onClick={handleGoLive} disabled={!!busy || !created || !checked} className={`${btn} bg-[#C1032F] text-white`}>
                                        {busy === 'golive' ? '處理中...' : '測試完畢，正式上線'}
                                    </button>
                                </>
                            )}
                        </Step>
                    </div>

                    {created && (
                        <div className="mt-4 border border-gray-200 rounded-lg p-4">
                            <p className="font-bold text-gray-800 mb-2">海報用短網址與 QR code</p>
                            {links?.short || links?.url ? (
                                <div className="flex flex-wrap items-start gap-4">
                                    <img src={`/api/nianfai/form-qr.png?year=${year}`} alt="表單 QR code" className="w-36 h-36 border border-gray-200 rounded" />
                                    <div className="space-y-2 text-sm">
                                        <p className="text-lg font-bold text-gray-800 select-all">{links.short || links.url}</p>
                                        <button onClick={() => navigator.clipboard?.writeText(links.short || links.url)} className={`${btn} bg-gray-100 text-gray-700`}>複製短網址</button>
                                        <p>
                                            <a href={`/api/nianfai/form-qr.png?year=${year}`} download={`${year}-年菜表單-QR.png`} className={link}>下載 QR code（PNG）</a>
                                            <span className="mx-2 text-gray-300">｜</span>
                                            <a href={`/api/nianfai/form-qr.png?year=${year}&format=svg`} download={`${year}-年菜表單-QR.svg`} className={link}>下載向量檔（SVG，海報放大用）</a>
                                        </p>
                                        <p className="text-gray-500">短網址由 Google 表單官方提供（forms.gle），表單網址不變就一直有效。</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">{links === null ? '讀取中...' : `讀取失敗：${links.error || ''}`}</p>
                            )}
                        </div>
                    )}

                    {created && (
                        <details className="mt-4 bg-gray-50 rounded-lg p-3">
                            <summary className="font-bold text-gray-700 cursor-pointer">維護工具（品項、價格、日期有變動時）</summary>
                            <div className="mt-3 space-y-3 text-sm">
                                {[
                                    ['sync', '同步品項到 Sheet', '品項、價格、套餐組成、日期、製作入庫改了之後，寫入試算表「設定」。', handleSyncSettings],
                                    ['form', '同步到表單', '品名、價格、取貨日改了之後，更新表單題目與選項（會先列出差異）。完成後再做第 ③ 步。', handleFormSync],
                                    ['rebuild', '重建分頁', '新增或刪除品項、改了寄出日後，重建宅配／自取／查詢／統計／備料表。手動欄與寄信狀態會保留。', handleRebuild],
                                    ['protect', '重新套用保護範圍', '保護範圍被改掉或新增匯款欄位時使用。', handleProtect],
                                ].map(([key, label, desc, fn]) => (
                                    <div key={key} className="flex items-start gap-3">
                                        <button onClick={fn} disabled={!!busy} className={`${btn} bg-white border border-gray-300 text-gray-700 flex-shrink-0 w-40`}>{busy === key ? '處理中...' : label}</button>
                                        <p className="text-gray-500 pt-1.5">{desc}</p>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </>
            )}
        </div>
    );
}

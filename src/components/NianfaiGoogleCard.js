// src/components/NianfaiGoogleCard.js — 年菜管理頁「Google 表單／Sheet」（步驟式）
// GAS 是一支獨立的「年菜系統」專案（gas/nianfai/），每年由這裡一鍵建立該年度的試算表與表單：
//   ① 建立試算表與表單 → ② 檢查、修改表單文案 → ③ 檢查表單對應 → ④ 真實測試 → ⑤ 測試完畢，正式上線
// 正式上線會清空所有測試資料（Google 表單回覆、表單回應、WebPOS 年菜單、流水號歸 27001），每年只能一次。
import React, { useState, useEffect, useCallback } from 'react';
import {
    getNianfaiGasStatus, createNianfaiSheet, syncNianfaiSettingsToSheet,
    nianfaiFormSync, checkNianfaiForm, checkNianfaiFormText, protectNianfaiSheet, rebuildNianfaiTabs,
    goLiveNianfai, backToTestingNianfai, clearNianfaiTestData, getNianfaiFormLinks,
} from '../db';

// 複製文字：iPad 用 http://（不是 https）開 WebPOS 時瀏覽器不提供 navigator.clipboard，改用舊方法；都失敗回傳 false
export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* 改用舊方法 */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); // iPad Safari 要 setSelectionRange
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) {
        return false;
    }
}

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

// Google 表單目前是開放還是關閉（讀 Google 表單實際狀態）。不連動停售，表單要不要關由 Yw 自己決定，
// 這裡只負責提醒：開賣中卻關著、或不在開賣中卻還開著，都會跳出提示。
export function NianfaiFormStatus({ gas, salesStatus, compact = false }) {
    if (!gas || !gas.configured || !gas.ok || !gas.created) return null;
    const open = !!gas.formAccepting;
    const live = gas.phase === 'live';
    let warn = '';
    if (live && salesStatus === 'selling' && !open) warn = '目前是「開賣中」，但表單已關閉，顧客無法線上下單';
    else if (live && salesStatus && salesStatus !== 'selling' && open) warn = '目前不是「開賣中」，但表單還開著，顧客仍可線上下單';
    return (
        <div className={compact ? 'mt-2' : 'mb-4'}>
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 font-bold ${open ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${open ? 'bg-green-500' : 'bg-red-500'}`} />
                Google 表單：{open ? '開放中（顧客可以線上下單）' : '已關閉（顧客無法線上下單）'}
            </div>
            {warn && <p className="mt-1.5 text-sm font-bold text-orange-600">⚠️ {warn}</p>}
        </div>
    );
}

// part：'steps'（建立到正式上線，會讀 GAS 狀態並回報給年菜管理頁）｜'poster'（海報短網址／QR）｜'tools'（維護工具）
// poster、tools 用 steps 讀到的狀態（gasData），按鈕做完呼叫 onReload 讓 steps 重新讀
export default function NianfaiGoogleCard({ year, number, part = 'steps', gasData, onReload, datesReady, showAlert, showConfirm, onStatusChange, reloadKey, salesStatus }) {
    const [ownGas, setGas] = useState(null); // null = 檢查中
    const [busy, setBusy] = useState('');
    const external = part !== 'steps';
    const gas = external ? (gasData || null) : ownGas;

    const load = useCallback(async () => {
        if (external) { onReload?.(); return; }
        setGas(null);
        let g;
        try { g = await getNianfaiGasStatus(year); } catch (e) { g = { configured: true, ok: false, error: e.message }; }
        setGas(g);
        onStatusChange?.(g);
    }, [year, onStatusChange, external, onReload]);

    useEffect(() => { if (year && !external) load(); }, [year, load, reloadKey, external]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { await showAlert(e.message, { title: '操作失敗', icon: 'warning' }); } finally { setBusy(''); load(); }
    };

    const handleCreate = () => run('create', async () => {
        if (!await showConfirm(`在雲端硬碟建立「${year} 年菜訂單」試算表與預購表單`, {
            title: '建立 Google 試算表與表單', icon: 'info', note: '建立後是「測試中」，可以真實送單測試', confirmText: '建立',
        })) return;
        const r = await createNianfaiSheet(year);
        const carried = r?.carriedKeys || [];
        await showAlert('請進行第 ② 步：打開表單檢查文案、上傳圖片', {
            title: '已建立', icon: 'success',
            note: carried.length
                ? `以下設定沿用 ${r.carriedFrom} 年，請打開試算表「設定」確認還正確（尤其匯款帳號）：\n${carried.join('、')}`
                : '請打開試算表「設定」填寫：匯款戶名、銀行、分行、帳號、加熱說明小卡ID',
        });
    });

    // 海報用短網址與 QR code
    const [links, setLinks] = useState(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (part !== 'poster' || !year || !gas?.created) return;
        getNianfaiFormLinks(year).then(setLinks).catch(e => setLinks({ error: e.message }));
    }, [part, year, gas?.created]);
    const handleCopy = async (text) => {
        if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
        else await showAlert(text, { title: '無法自動複製', icon: 'info', note: '請長按上面的網址選取後複製' });
    };

    const handleCheck = () => run('check', async () => {
        const r = await checkNianfaiForm(year);
        if (r.passed) await showAlert('每個品項與欄位都對應正確', { title: '檢查通過', icon: 'success' });
        else await showAlert('請修正以下問題後再檢查一次', { title: '檢查未通過', icon: 'warning', note: r.problems.join('\n') });
    });

    // 檢查表單說明：改了「設定」之後，說明文字要自己改，這裡列出對不上的地方
    const handleCheckText = () => run('text', async () => {
        const r = await checkNianfaiFormText(year);
        const mail = '寄信用的設定（改了下一封信就生效）：\n' + r.mail.map(x => '・' + x).join('\n');
        if (!r.problems.length) await showAlert(`「設定」的 ${r.ok.length} 個項目都有出現在表單說明`, { title: '表單說明一致', icon: 'success', detail: mail });
        else await showAlert(`有 ${r.problems.length} 個地方和「設定」對不上，請到「編輯表單」修改說明文字`, {
            title: '請修改表單說明', icon: 'warning', note: r.problems.map(x => '・' + x).join('\n'), detail: mail,
        });
    });

    const handleGoLive = () => run('golive', async () => {
        if (!await showConfirm(`${year} 年菜測試完畢，正式上線`, {
            title: '正式上線', icon: 'danger', confirmText: '清空並上線', danger: true,
            note: '會清空：Google 表單所有回覆、試算表表單回應與修改紀錄、WebPOS 這個年度的年菜單與發票，訂購編號流水號從 001 重新開始。每個年度只能做一次，無法復原。',
        })) return;
        const r = await goLiveNianfai(year);
        await showAlert(`已清空 ${r.sheetCleared} 筆表單回應、${r.clearedOrders} 張 WebPOS 年菜單\n正式客人從表單回應第 2 列開始`, { title: '已正式上線', icon: 'success' });
    });

    const handleClearTest = () => run('cleartest', async () => {
        if (!await showConfirm(`清空 ${year} 年菜的測試資料，從乾淨的表單重新測試`, {
            title: '清空測試資料', icon: 'warning', confirmText: '清空', danger: true,
            note: '會清空：Google 表單所有回覆、試算表表單回應／宅配／自取／修改紀錄、寄信紀錄，WebPOS 這個年度的年菜單與發票，訂購編號流水號回到 001。\n不會動：一般營業的訂單與發票、菜單、庫存、「設定」分頁、品項與日期。\n清完還是「測試中」，可以繼續測；正式上線時會再清一次。',
        })) return;
        const r = await clearNianfaiTestData(year);
        await showAlert(`已清空 ${r.sheetCleared} 筆表單回應、${r.clearedOrders} 張 WebPOS 年菜單\n可以從乾淨的表單重新測試`, { title: '已清空測試資料', icon: 'success' });
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
    const bankMissing = gas?.bankMissing || [];

    const header = (title, desc, refresh) => (
        <>
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-xl font-bold text-gray-700">{number}. {title}</h3>
                {refresh && <button onClick={load} className="text-sm font-bold text-gray-500 hover:text-gray-700">重新整理</button>}
            </div>
            <p className="text-sm text-gray-500 mb-4">{desc}</p>
        </>
    );
    if (part === 'poster') {
        if (!gas?.ok || !created) return null;
        return (
            <div className="bg-white rounded-xl shadow p-6">
                {header('海報與 QR code', live ? '開賣前做海報、貼文用。表單網址和 QR code 每年固定，之後都不會變。' : '正式上線前就可以先做海報（網址不會變），但測試期間不要先貼出去，以免客人在上線前下單（上線時會被清空）。')}
                        <div>
                            {links?.short || links?.url ? (
                                <div className="flex flex-wrap items-start gap-4">
                                    <img src={`/api/nianfai/form-qr.png?year=${year}`} alt="表單 QR code" className="w-36 h-36 border border-gray-200 rounded" />
                                    <div className="space-y-2 text-sm">
                                        <p className="text-lg font-bold text-gray-800 select-all">{links.short || links.url}</p>
                                        <button onClick={() => handleCopy(links.short || links.url)} className={`${btn} ${copied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{copied ? '✓ 已複製' : '複製短網址'}</button>
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
            </div>
        );
    }
    if (part === 'tools') {
        if (!gas?.ok || !created) return null;
        return (
            <div className="bg-white rounded-xl shadow p-6">
                        <details>
                            <summary className="text-xl font-bold text-gray-700 cursor-pointer">{number}. 維護工具<span className="ml-2 text-sm font-normal text-gray-500">平常用不到；開賣後改了品項、價格、日期才需要（點開）</span></summary>
                            <div className="mt-3 space-y-3 text-sm">
                                {[
                                    ['sync', '同步品項到 Sheet', '品項、價格、套餐組成、日期改了之後，寫入試算表「設定」。', handleSyncSettings],
                                    ['form', '同步到表單', '品名、價格、取貨日改了之後，更新表單題目與選項（會先列出差異）。完成後再按一次上面 Google 表單的 ③「檢查表單對應」。', handleFormSync],
                                    ['rebuild', '重建分頁', '新增或刪除品項、改了寄出日後，重建宅配／自取／查詢／統計／備料表。手動欄與寄信狀態會保留。', handleRebuild],
                                    ['protect', '重新套用保護範圍', '保護範圍被改掉或新增匯款欄位時使用。', handleProtect],
                                ].map(([key, label, desc, fn]) => (
                                    <div key={key} className="flex items-start gap-3">
                                        <button onClick={fn} disabled={!!busy} className={`${btn} bg-white border border-gray-300 text-gray-700 flex-shrink-0 w-40`}>{busy === key ? '處理中...' : label}</button>
                                        <p className="text-gray-500 pt-1.5">{desc}</p>
                                    </div>
                                ))}
                                {!live && (
                                    <div className="flex items-start gap-3 pt-3 border-t border-dashed border-gray-200">
                                        <button onClick={handleClearTest} disabled={!!busy} className={`${btn} bg-white border border-[#C1032F] text-[#C1032F] flex-shrink-0 w-40`}>{busy === 'cleartest' ? '清空中...' : '清空測試資料'}</button>
                                        <p className="text-gray-500 pt-1.5"><b className="text-[#C1032F]">只在測試中出現，正式上線後就沒有這個按鈕。</b>清空表單回覆、試算表訂單與寄信紀錄、WebPOS 這個年度的年菜單，流水號回到 001，從乾淨的表單重新測試。只清年菜，一般營業資料不會動。</p>
                                    </div>
                                )}
                            </div>
                        </details>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow p-6">
            {header('Google 表單與訂單試算表', '線上預購表單與訂單試算表。由上往下照 ①～⑤ 做，第 ⑤ 步「正式上線」後才能開賣。', true)}

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
                            {gas.env === 'dev' && <span className="px-2.5 py-1 rounded-full font-bold bg-gray-100 text-gray-500">測試環境</span>}
                        </div>
                    )}
                    <NianfaiFormStatus gas={gas} salesStatus={salesStatus} />

                    <div className="space-y-4">
                        <Step n={1} title="建立試算表與表單" done={created} active={!created}>
                            {created ? (
                                <p>已建立「{gas.spreadsheet}」</p>
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
                            <p>「設定」改了日期、運費、取貨時間、LINE 等，<b>表單說明不會自動更新</b>，請自己改，改完按這裡比對：</p>
                            <button onClick={handleCheckText} disabled={!!busy || !created} className={`${btn} border border-[#4A9A7A] text-[#4A9A7A]`}>{busy === 'text' ? '檢查中...' : '檢查表單說明'}</button>
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
                            {created && !live && <p className="text-gray-500">想從乾淨的表單重新測：最下面「維護工具」點開有「清空測試資料」（只清年菜、只限測試中）。</p>}
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
                                    {bankMissing.length > 0 && <p className="font-bold text-red-600">請先在試算表「設定」填好匯款資訊（還沒填：{bankMissing.join('、')}），確認信要用，沒填完不能正式上線</p>}
                                    <button onClick={handleGoLive} disabled={!!busy || !created || !checked || bankMissing.length > 0} className={`${btn} bg-[#C1032F] text-white`}>
                                        {busy === 'golive' ? '處理中...' : '測試完畢，正式上線'}
                                    </button>
                                </>
                            )}
                        </Step>
                    </div>

                </>
            )}
        </div>
    );
}

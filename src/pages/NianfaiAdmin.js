// src/pages/NianfaiAdmin.js — 年菜管理頁（控制中心）
// 修正單 #01：preparing/selling/closed/archived 單一狀態機取代 season_active，
// 新年度初始化改成真的複製品項（新 id，去年資料完全不動）。
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useDialog from '../components/useDialog';
import { getSettingValue, saveSettingValue, getMenuItems, getInventoryItems, addMenuItem, updateMenuItem, getNianfaiItems, finishNianfaiProduction, getNianfaiDemand, getNianfaiGasStatus, syncNianfaiSettingsToSheet } from '../db';

const STATUS_ORDER = ['preparing', 'selling', 'closed', 'archived'];
const STATUS_LABELS = { preparing: '準備中', selling: '開賣中', closed: '收單後', archived: '已封存（平常營業）' };
const NEXT_ACTION_LABELS = { preparing: '開賣（顯示年菜 tab）', selling: '收單（隱藏年菜 tab）', closed: '封存（年度結束，恢復平常營業）' };
const NEXT_CONFIRM = {
    preparing: (y) => ({ title: `開賣 ${y} 年菜`, message: '開始接受年菜訂單', confirmText: '開賣' }),
    selling:   (y) => ({ title: `${y} 年菜收單`, message: '收單後只有 Yw 能加單', confirmText: '收單' }),
    closed:    (y) => ({ title: `封存 ${y} 年菜`, message: '所有年菜畫面會隱藏\n資料完整保留', confirmText: '封存' }),
};

const NianfaiAdminPage = () => {
    const { dialog, showAlert, showConfirm } = useDialog();
    const [activeYear, setActiveYear] = useState(null);
    const [status, setStatus] = useState('archived');
    const [items, setItems] = useState([]);
    const [inventoryItems, setInventoryItems] = useState([]);
    const [formClosed, setFormClosed] = useState(false);
    const [newYearInput, setNewYearInput] = useState('');
    const [isInitializing, setIsInitializing] = useState(false);
    const [isToggling, setIsToggling] = useState(false);
    const [finishingId, setFinishingId] = useState(null);
    const [gas, setGas] = useState(null);            // GAS 連線狀態（null = 檢查中）
    const [syncing, setSyncing] = useState(false);
    const [demandInfo, setDemandInfo] = useState(null); // { source, updatedAt, error }

    const loadGas = useCallback(async () => {
        setGas(null);
        try { setGas(await getNianfaiGasStatus()); } catch (e) { setGas({ configured: true, ok: false, error: e.message }); }
    }, []);

    const load = useCallback(async () => {
        const year = await getSettingValue('nianfai_active_year', null);
        const activeYearNum = year ? parseInt(year, 10) : null;
        setActiveYear(activeYearNum);
        setNewYearInput(String((activeYearNum || new Date().getFullYear()) + 1));
        if (activeYearNum) {
            const s = await getSettingValue(`nianfai_${activeYearNum}_status`, 'preparing');
            setStatus(STATUS_ORDER.includes(s) ? s : 'preparing');
            const closed = await getSettingValue(`nianfai_${activeYearNum}_form_closed`, 'false');
            setFormClosed(closed === 'true');
            const nfItems = await getNianfaiItems(activeYearNum).catch(() => []);
            setInventoryItems(nfItems);
            getNianfaiDemand(activeYearNum).then(d => setDemandInfo({ source: d.source, updatedAt: d.updatedAt, error: d.error })).catch(() => setDemandInfo(null));
        } else {
            setStatus('archived');
            setFormClosed(false);
            setInventoryItems([]);
        }
        const all = await getMenuItems();
        setItems(activeYearNum ? all.filter(i => i.category === '年菜' && i.nianfaiYear === activeYearNum) : []);
    }, []);

    useEffect(() => { load(); loadGas(); }, [load, loadGas]);

    // WebPOS 品項／價格／套餐組成／停售上限／取貨日 → Sheet「設定」；之後在 Sheet「年菜工具 → 同步到表單」更新題目
    const handleSyncSheet = async () => {
        if (!await showConfirm(`把 ${activeYear} 年菜品項、價格、取貨日寫入 Sheet「設定」`, { title: '同步品項到 Sheet', icon: 'info', confirmText: '同步' })) return;
        setSyncing(true);
        try {
            const r = await syncNianfaiSettingsToSheet(activeYear);
            await showAlert(`已同步 ${r.items} 個品項\n請到 Sheet「年菜工具 → 同步到表單」更新題目`, { title: '同步完成', icon: 'success' });
            loadGas();
        } catch (e) {
            await showAlert(e.message, { title: '同步失敗', icon: 'warning' });
        } finally {
            setSyncing(false);
        }
    };

    // 新年度初始化＝真的複製：去年品項複製成新的 menu_items（新 id、新 nianfai_year），
    // 套餐的 bundle_composition 重新指向新品項 id；製作入庫/停售上限/流水號都歸零；
    // 去年的品項與訂單完全不動，只是不再是「目前年度」。
    const handleInitNewYear = async () => {
        const newYear = parseInt(newYearInput, 10);
        if (!newYear) { await showAlert('請輸入有效的年度', { title: '年度錯誤', icon: 'warning' }); return; }
        if (!await showConfirm(activeYear ? `複製 ${activeYear} 年菜 ${items.length} 個品項` : '目前沒有上一年度可複製', { title: `建立 ${newYear} 年菜`, icon: 'info', note: '去年資料不會變動', confirmText: '建立' })) return;
        setIsInitializing(true);
        try {
            const lastYearItems = items; // 已經是「年菜」分類＋目前年度的品項
            const idMap = new Map();
            lastYearItems.forEach(it => idMap.set(it.id, `${it.id}_${newYear}`));
            // 年節限定品項的「年菜庫存」每年各自一筆（庫存從 0 開始），平常也賣的冷凍包庫存照原樣沿用
            const inventory = await getInventoryItems();
            const stockMap = new Map(); // 去年年菜庫存 id -> 新年度年菜庫存 id
            for (const it of lastYearItems) {
                const ref = inventory.find(inv => inv.id === it.nianfaiStockRef);
                if (!ref || ref.category !== '年菜庫存') continue;
                const newStockId = `nfstock_${newYear}_${idMap.get(it.id)}`;
                await addMenuItem({ id: newStockId, name: ref.name, category: '年菜庫存', price: null, stock: 0, consumes: [], sortOrder: ref.sortOrder, thresholds: ref.thresholds || null });
                stockMap.set(ref.id, newStockId);
            }
            // 先建立所有新品項（bundleComposition 先留空，新品項都建好才能回填正確的新 id）
            for (const it of lastYearItems) {
                await addMenuItem({
                    id: idMap.get(it.id), name: it.name, printName: it.printName, customerPrintName: it.customerPrintName,
                    price: it.price, category: '年菜', imageUrl: it.imageUrl,
                    stock: 0, consumes: [], sortOrder: it.sortOrder,
                    nianfaiYear: newYear, nianfaiStockRef: stockMap.get(it.nianfaiStockRef) || it.nianfaiStockRef || null,
                    bundleComposition: null,
                });
            }
            for (const it of lastYearItems) {
                if (it.bundleComposition && it.bundleComposition.length > 0) {
                    const remapped = it.bundleComposition.map(c => ({ itemId: idMap.get(c.itemId) || c.itemId, qty: c.qty }));
                    await updateMenuItem(idMap.get(it.id), { bundleComposition: remapped });
                }
            }
            await saveSettingValue('nianfai_active_year', String(newYear));
            await saveSettingValue(`nianfai_${newYear}_status`, 'preparing');
            await saveSettingValue(`nianfai_${newYear}_next_seq`, '1');
            await showAlert(`已複製 ${lastYearItems.length} 個品項\n請到菜單管理確認後再開賣`, { title: `${newYear} 年菜已建立`, icon: 'success' });
            await load();
        } catch (e) {
            await showAlert(e.message, { title: '建立失敗', icon: 'warning' });
        } finally {
            setIsInitializing(false);
        }
    };

    // 狀態機只能往前走（準備中→開賣中→收單後→已封存），改錯了用下面的「返回上一步」修正
    const handleAdvanceStatus = async () => {
        if (!activeYear || status === 'archived') return;
        const next = STATUS_ORDER[STATUS_ORDER.indexOf(status) + 1];
        if (!await showConfirm(NEXT_CONFIRM[status](activeYear).message, { ...NEXT_CONFIRM[status](activeYear), icon: 'info' })) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_status`, next);
            setStatus(next);
        } catch (e) {
            await showAlert(e.message, { title: '設定失敗', icon: 'warning' });
        } finally {
            setIsToggling(false);
        }
    };
    const handleRevertStatus = async () => {
        if (!activeYear || status === 'preparing') return;
        const prev = STATUS_ORDER[STATUS_ORDER.indexOf(status) - 1];
        if (!await showConfirm(`退回「${STATUS_LABELS[prev]}」`, { title: '返回上一步', icon: 'warning', confirmText: '退回' })) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_status`, prev);
            setStatus(prev);
        } catch (e) {
            await showAlert(e.message, { title: '設定失敗', icon: 'warning' });
        } finally {
            setIsToggling(false);
        }
    };

    const handleFinishProduction = async (item) => {
        if (!await showConfirm(`停售上限 ${item.nianfaiProductionQty || 0} 份`, { title: `${item.name} 製作完成`, icon: 'warning', note: '設定後不能再調整', confirmText: '製作完成' })) return;
        setFinishingId(item.id);
        try {
            const r = await finishNianfaiProduction(item.id, activeYear);
            await load();
            if (r?.gasWarning) await showAlert(r.gasWarning, { title: 'Sheet 同步失敗', icon: 'warning' });
        } catch (e) {
            await showAlert(e.message, { title: '設定失敗', icon: 'warning' });
        } finally {
            setFinishingId(null);
        }
    };

    // 「平常也賣」的 5 項本來就有庫存連動（consumes），用既有庫存比對只警示，不走停售上限
    const specialItems = inventoryItems.filter(i => i.isRegularSellingItem);
    const seasonalItems = inventoryItems.filter(i => !i.isRegularSellingItem);

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <h2 className="text-4xl font-black text-gray-800 mb-6">🧧 年菜管理</h2>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">目前狀態</h3>
                <p className="text-gray-600">
                    目前年度：<span className="font-black text-gray-800">{activeYear || '（尚未設定）'}</span>
                </p>
                <p className="text-gray-600 mt-1">
                    狀態：
                    <span className={`font-black ml-1 ${status === 'selling' ? 'text-[#4A9A7A]' : 'text-gray-400'}`}>
                        {activeYear ? STATUS_LABELS[status] : '—'}
                    </span>
                </p>
                <p className="text-gray-600 mt-1">
                    目前年度品項數：<span className="font-black text-gray-800">{items.length}</span>
                </p>
                {formClosed && (
                    <p className="mt-2 text-sm font-bold text-red-600 bg-red-50 rounded-lg px-3 py-2">
                        ⚠️ 已有品項達停售上限，表單已自動關閉。WebPOS 現場要繼續新增年菜訂單需要額外確認。
                    </p>
                )}
            </div>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">1. 新年度初始化</h3>
                <p className="text-sm text-gray-500 mb-3">把目前年度的年菜品項「複製」成新年度的新品項（新品項、新年度資料互相獨立，不是改標記），複製完請到菜單管理頁修正名稱/價格/是否繼續賣。</p>
                <div className="flex items-center gap-3">
                    <input type="number" value={newYearInput} onChange={e => setNewYearInput(e.target.value)}
                        className="w-28 border border-gray-300 rounded-lg p-2.5 text-base" />
                    <button onClick={handleInitNewYear} disabled={isInitializing}
                        className="px-5 py-2.5 rounded-lg bg-[#4A9A7A] text-white font-bold disabled:opacity-50">
                        {isInitializing ? '處理中...' : '建立新年度年菜'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">2. 修正品項</h3>
                <p className="text-sm text-gray-500 mb-3">品項的名稱、價格、套餐組成都在菜單管理頁編輯（品項編輯視窗會多一個「🧧 年菜」區塊）。</p>
                <Link to="/menu" className="inline-block px-5 py-2.5 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-800">
                    前往菜單管理頁
                </Link>
            </div>

            <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-xl font-bold text-gray-700 mb-3">3. 開賣 / 收單狀態</h3>
                <p className="text-sm text-gray-500 mb-3">
                    準備中→開賣中→收單後→已封存，只隱藏畫面不刪資料；封存以外桌位頁都會出現年菜卡片（佇列/點單頁），收單後只有 Yw 能從後台加單。
                </p>
                <div className="flex items-center gap-3">
                    {status !== 'archived' && (
                        <button onClick={handleAdvanceStatus} disabled={!activeYear || isToggling}
                            className="px-5 py-2.5 rounded-lg font-bold text-white bg-[#D47856] hover:bg-[#C46848] disabled:opacity-50">
                            {isToggling ? '處理中...' : NEXT_ACTION_LABELS[status]}
                        </button>
                    )}
                    {status !== 'preparing' && status !== 'archived' && (
                        <button onClick={handleRevertStatus} disabled={isToggling}
                            className="px-4 py-2.5 rounded-lg font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-sm">
                            返回上一步（修正誤按）
                        </button>
                    )}
                    {status === 'archived' && <p className="text-gray-400">已封存，明年初始化新年度後才會再出現。</p>}
                </div>
            </div>

            {activeYear && (
                <div className="bg-white rounded-xl shadow p-6 mt-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xl font-bold text-gray-700">4. Google 表單／Sheet</h3>
                        <button onClick={loadGas} className="text-sm font-bold text-gray-500 hover:text-gray-700">重新檢查</button>
                    </div>
                    {gas === null ? (
                        <p className="text-gray-400">檢查連線中...</p>
                    ) : !gas.configured ? (
                        <p className="text-gray-500">尚未設定 GAS 網址與密鑰（NIANFAI_GAS_URL／NIANFAI_GAS_SECRET）。現場單會停在「待傳送」，設定後自動補送。</p>
                    ) : gas.ok ? (
                        <div className="space-y-1 text-gray-700">
                            <p><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />已連線：<span className="font-bold">{gas.spreadsheet}</span></p>
                            <p className="text-sm text-gray-500">
                                Sheet 年度 {gas.year || '（未同步）'}・設定品項 {gas.items} 項・表單
                                <span className={`font-bold ml-1 ${gas.formAccepting ? 'text-green-600' : 'text-red-600'}`}>{gas.formAccepting ? '開放中' : '已關閉'}</span>
                            </p>
                        </div>
                    ) : (
                        <p className="text-red-600 font-bold"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-2" />連線失敗：{gas.error}</p>
                    )}
                    {gas?.configured && (
                        <button onClick={handleSyncSheet} disabled={syncing || !gas.ok}
                            className="mt-4 px-4 py-2.5 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-800 disabled:opacity-40">
                            {syncing ? '同步中...' : '同步品項到 Sheet'}
                        </button>
                    )}
                </div>
            )}

            {activeYear && (
                <div className="bg-white rounded-xl shadow p-6 mt-5">
                    <h3 className="text-xl font-bold text-gray-700 mb-3">5. 年菜庫存</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        {demandInfo?.source === 'sheet'
                            ? `訂購需求＝Sheet 總訂購量（線上＋已送出的現場單）＋WebPOS 尚未送出的現場單。Sheet 更新時間 ${demandInfo.updatedAt || ''}`
                            : `訂購需求僅含現場單（${demandInfo?.error ? `讀取 Sheet 失敗：${demandInfo.error}` : '尚未連結 Google Sheet'}），不含線上表單，實際需求會更多。`}
                    </p>

                    {seasonalItems.length > 0 && (
                        <>
                            <p className="text-sm font-bold text-gray-600 mb-1">年節限定品項（做完再賣，製作完成後設上限）</p>
                            <p className="text-xs text-gray-400 mb-2">
                                製作入庫請到 <Link to="/inventory" className="text-[#4A9A7A] font-bold underline">庫存管理頁</Link>「年菜庫存」分類補貨／盤點；按「製作完成」時以當下庫存數作為停售上限。
                            </p>
                            <div className="overflow-x-auto mb-6">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-400">
                                            <th className="py-2 pr-2">品項</th>
                                            <th className="py-2 px-2 text-right">年菜庫存</th>
                                            <th className="py-2 px-2 text-right">訂購需求</th>
                                            <th className="py-2 px-2 text-right">差額</th>
                                            <th className="py-2 px-2 text-center">狀態</th>
                                            <th className="py-2 pl-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {seasonalItems.map(item => {
                                            const isBundle = !!item.bundleComposition;
                                            const completed = item.nianfaiSelloutCap != null;
                                            const diff = completed ? item.nianfaiSelloutCap - item.demand : (item.nianfaiProductionQty ?? 0) - item.demand;
                                            return (
                                                <tr key={item.id}>
                                                    <td className="py-2 pr-2 font-bold text-gray-800">{item.name}{isBundle && <span className="ml-1 text-xs font-normal text-gray-400">（套餐）</span>}</td>
                                                    <td className="py-2 px-2 text-right">
                                                        {isBundle ? (
                                                            <span className="text-gray-300">—</span>
                                                        ) : (
                                                            item.nianfaiStockRef
                                                                ? <span className="font-bold text-gray-800">{completed ? item.nianfaiSelloutCap : (item.nianfaiProductionQty ?? 0)}</span>
                                                                : <span className="text-xs text-red-500 font-bold">未設定對應庫存</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2 px-2 text-right text-gray-700">{item.demand}</td>
                                                    <td className={`py-2 px-2 text-right font-bold ${diff != null && diff < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                                                        {isBundle ? <span className="text-gray-300">—</span> : (diff != null ? diff : '—')}
                                                    </td>
                                                    <td className="py-2 px-2 text-center">
                                                        {isBundle ? (
                                                            <span className="text-xs text-gray-400">跟隨組成</span>
                                                        ) : (
                                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${completed ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-600'}`}>
                                                                {completed ? '已完成' : '製作中'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pl-2 text-right">
                                                        {!isBundle && !completed && item.nianfaiStockRef && (
                                                            <button onClick={() => handleFinishProduction(item)} disabled={finishingId === item.id}
                                                                className="text-xs font-bold text-white bg-[#4A9A7A] px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap">
                                                                {finishingId === item.id ? '處理中...' : '製作完成'}
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {specialItems.length > 0 && (
                        <>
                            <p className="text-sm font-bold text-gray-600 mb-2">平常也賣的品項（用既有庫存比對，只警示不停售）</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-400">
                                            <th className="py-2 pr-2">品項</th>
                                            <th className="py-2 px-2 text-right">現有庫存</th>
                                            <th className="py-2 px-2 text-right">訂購需求</th>
                                            <th className="py-2 px-2 text-right">差額</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {specialItems.map(item => {
                                            const diff = (item.stock ?? 0) - item.demand;
                                            return (
                                                <tr key={item.id}>
                                                    <td className="py-2 pr-2 font-bold text-gray-800">{item.name}</td>
                                                    <td className="py-2 px-2 text-right text-gray-700">{item.stock ?? '—'}</td>
                                                    <td className="py-2 px-2 text-right text-gray-700">{item.demand}</td>
                                                    <td className={`py-2 px-2 text-right font-bold ${diff < 0 ? 'text-red-600' : 'text-gray-700'}`}>{diff}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {inventoryItems.length === 0 && <p className="text-gray-400 text-center py-6">目前沒有年菜品項</p>}
                </div>
            )}
            {dialog}
        </div>
    );
};

export default NianfaiAdminPage;

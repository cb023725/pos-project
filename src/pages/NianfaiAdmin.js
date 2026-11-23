// src/pages/NianfaiAdmin.js — 年菜管理頁（控制中心）
// 修正單 #01：preparing/selling/closed/archived 單一狀態機取代 season_active，
// 新年度初始化改成真的複製品項（新 id，去年資料完全不動）。
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getSettingValue, saveSettingValue, getMenuItems, addMenuItem, updateMenuItem, getNianfaiItems, finishNianfaiProduction, addNianfaiProduction } from '../db';

const STATUS_ORDER = ['preparing', 'selling', 'closed', 'archived'];
const STATUS_LABELS = { preparing: '準備中', selling: '開賣中', closed: '收單後', archived: '已封存（平常營業）' };
const NEXT_ACTION_LABELS = { preparing: '開賣（顯示年菜 tab）', selling: '收單（隱藏年菜 tab）', closed: '封存（年度結束，恢復平常營業）' };
const NEXT_CONFIRM = {
    preparing: (y) => `確定要開賣 ${y} 年菜嗎？\n\n開賣後 WebPOS 點餐頁會出現「年菜」tab。`,
    selling:   (y) => `確定要收單嗎？\n\n收單後 WebPOS 點餐頁的「年菜」tab 會立即隱藏，之後只有 Yw 能從後台加單。`,
    closed:    (y) => `確定要封存 ${y} 年菜嗎？\n\n封存後所有年菜畫面會隱藏、恢復平常營業樣子。資料完全保留，不會刪除。`,
};

const NianfaiAdminPage = () => {
    const [activeYear, setActiveYear] = useState(null);
    const [status, setStatus] = useState('archived');
    const [items, setItems] = useState([]);
    const [inventoryItems, setInventoryItems] = useState([]);
    const [formClosed, setFormClosed] = useState(false);
    const [newYearInput, setNewYearInput] = useState('');
    const [isInitializing, setIsInitializing] = useState(false);
    const [isToggling, setIsToggling] = useState(false);
    const [productionDrafts, setProductionDrafts] = useState({}); // itemId -> 輸入中但還沒存檔的值
    const [finishingId, setFinishingId] = useState(null);

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
        } else {
            setStatus('archived');
            setFormClosed(false);
            setInventoryItems([]);
        }
        const all = await getMenuItems();
        setItems(activeYearNum ? all.filter(i => i.category === '年菜' && i.nianfaiYear === activeYearNum) : []);
    }, []);

    useEffect(() => { load(); }, [load]);

    // 新年度初始化＝真的複製：去年品項複製成新的 menu_items（新 id、新 nianfai_year），
    // 套餐的 bundle_composition 重新指向新品項 id；製作入庫/停售上限/流水號都歸零；
    // 去年的品項與訂單完全不動，只是不再是「目前年度」。
    const handleInitNewYear = async () => {
        const newYear = parseInt(newYearInput, 10);
        if (!newYear) { alert('請輸入有效的年度'); return; }
        if (!window.confirm(`確定要初始化 ${newYear} 年菜嗎？\n\n會把${activeYear ? `${activeYear} 年菜的 ${items.length} 個品項` : '（目前沒有上一年度可複製）'}複製成 ${newYear} 的新品項（新年度資料互相獨立），狀態設為準備中。`)) return;
        setIsInitializing(true);
        try {
            const lastYearItems = items; // 已經是「年菜」分類＋目前年度的品項
            const idMap = new Map();
            lastYearItems.forEach(it => idMap.set(it.id, `${it.id}_${newYear}`));
            // 先建立所有新品項（bundleComposition 先留空，新品項都建好才能回填正確的新 id）
            for (const it of lastYearItems) {
                await addMenuItem({
                    id: idMap.get(it.id), name: it.name, printName: it.printName, customerPrintName: it.customerPrintName,
                    price: it.price, category: '年菜', imageUrl: it.imageUrl,
                    stock: 0, consumes: [], sortOrder: it.sortOrder,
                    nianfaiYear: newYear, nianfaiStockRef: it.nianfaiStockRef || null,
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
            alert(`已複製 ${lastYearItems.length} 筆品項到 ${newYear}（新品項，${activeYear || '上一年度'}的資料完全不變），請到菜單管理頁確認/修正後再開賣。`);
            await load();
        } catch (e) {
            alert(`初始化失敗：${e.message}`);
        } finally {
            setIsInitializing(false);
        }
    };

    // 狀態機只能往前走（準備中→開賣中→收單後→已封存），改錯了用下面的「返回上一步」修正
    const handleAdvanceStatus = async () => {
        if (!activeYear || status === 'archived') return;
        const next = STATUS_ORDER[STATUS_ORDER.indexOf(status) + 1];
        if (!window.confirm(NEXT_CONFIRM[status](activeYear))) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_status`, next);
            setStatus(next);
        } catch (e) {
            alert(`設定失敗：${e.message}`);
        } finally {
            setIsToggling(false);
        }
    };
    const handleRevertStatus = async () => {
        if (!activeYear || status === 'preparing') return;
        const prev = STATUS_ORDER[STATUS_ORDER.indexOf(status) - 1];
        if (!window.confirm(`確定要把狀態退回「${STATUS_LABELS[prev]}」嗎？（修正誤按用）`)) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_status`, prev);
            setStatus(prev);
        } catch (e) {
            alert(`設定失敗：${e.message}`);
        } finally {
            setIsToggling(false);
        }
    };

    // 製作入庫用累加而不是整筆覆蓋：Yw 不一定一次做完全部（例如這週做 50、
    // 下週再做 50），用累加才不用每次自己心算目前累計總共是多少。
    const handleAddProduction = async (itemId) => {
        const draft = productionDrafts[itemId];
        const addQty = parseInt(draft, 10);
        if (!addQty || addQty <= 0) return;
        try {
            await addNianfaiProduction(itemId, addQty);
            setProductionDrafts(prev => { const n = { ...prev }; delete n[itemId]; return n; });
            await load();
        } catch (e) {
            alert(`新增入庫失敗：${e.message}`);
        }
    };

    const handleFinishProduction = async (item) => {
        if (!window.confirm(`確定「${item.name}」製作完成嗎？\n\n目前製作入庫 ${item.nianfaiProductionQty || 0} 份會變成停售上限，之後不能再調整。`)) return;
        setFinishingId(item.id);
        try {
            await finishNianfaiProduction(item.id, activeYear);
            await load();
        } catch (e) {
            alert(`設定失敗：${e.message}`);
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
                    準備中→開賣中→收單後→已封存，只隱藏畫面不刪資料；開賣中才會出現年菜佇列/點單頁，收單後只有 Yw 能從後台加單。
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
                {(status === 'selling' || status === 'closed') && (
                    <Link to="/nianfai-order" className="inline-block mt-3 px-4 py-2 rounded-lg bg-gray-700 text-white font-bold text-sm hover:bg-gray-800">
                        前往年菜點單頁
                    </Link>
                )}
            </div>

            {activeYear && (
                <div className="bg-white rounded-xl shadow p-6 mt-5">
                    <h3 className="text-xl font-bold text-gray-700 mb-3">4. 年菜庫存</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        訂購需求目前僅計算 WebPOS 現場單（GAS 還沒部署，不含線上表單），實際需求會比這裡顯示的更多。
                    </p>

                    {seasonalItems.length > 0 && (
                        <>
                            <p className="text-sm font-bold text-gray-600 mb-2">年節限定品項（做完再賣，製作完成後設上限）</p>
                            <div className="overflow-x-auto mb-6">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs font-bold text-gray-400">
                                            <th className="py-2 pr-2">品項</th>
                                            <th className="py-2 px-2 text-right">製作入庫</th>
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
                                            const diff = completed ? item.nianfaiSelloutCap - item.demand : null;
                                            const draftValue = productionDrafts[item.id] ?? '';
                                            return (
                                                <tr key={item.id}>
                                                    <td className="py-2 pr-2 font-bold text-gray-800">{item.name}{isBundle && <span className="ml-1 text-xs font-normal text-gray-400">（套餐）</span>}</td>
                                                    <td className="py-2 px-2 text-right">
                                                        {isBundle ? (
                                                            <span className="text-gray-300">—</span>
                                                        ) : (
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <span className="font-bold text-gray-800 w-10 text-right">{item.nianfaiProductionQty || 0}</span>
                                                                {!completed && (
                                                                    <>
                                                                        <span className="text-gray-300">+</span>
                                                                        <input type="number" min="1" placeholder="本次新增" value={draftValue}
                                                                            onChange={e => setProductionDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                            onKeyDown={e => e.key === 'Enter' && handleAddProduction(item.id)}
                                                                            className="w-20 border border-gray-300 rounded p-1 text-right text-xs" />
                                                                        <button onClick={() => handleAddProduction(item.id)} disabled={!draftValue}
                                                                            className="text-xs font-bold text-white bg-gray-600 px-2 py-1.5 rounded disabled:opacity-30 whitespace-nowrap">
                                                                            入庫
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
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
                                                        {!isBundle && !completed && (
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
        </div>
    );
};

export default NianfaiAdminPage;

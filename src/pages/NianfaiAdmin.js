// src/pages/NianfaiAdmin.js — 年菜管理頁（控制中心）
// 對應 handoff 文件第 8 節「年菜管理頁」表格裡，開賣前階段需要的 3 個按鈕：
// 新年度初始化、修正品項（連到既有 menu management）、開賣/收單開關。
// 庫存/停售機制是下一階段的範圍，這裡先不做。
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getSettingValue, saveSettingValue, getMenuItems, updateMenuItem, getNianfaiItems, finishNianfaiProduction, addNianfaiProduction } from '../db';

const NianfaiAdminPage = () => {
    const [activeYear, setActiveYear] = useState(null);
    const [seasonActive, setSeasonActive] = useState(false);
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
            const active = await getSettingValue(`nianfai_${activeYearNum}_season_active`, 'false');
            setSeasonActive(active === 'true');
            const closed = await getSettingValue(`nianfai_${activeYearNum}_form_closed`, 'false');
            setFormClosed(closed === 'true');
            const nfItems = await getNianfaiItems(activeYearNum).catch(() => []);
            setInventoryItems(nfItems);
        } else {
            setFormClosed(false);
            setInventoryItems([]);
        }
        const all = await getMenuItems();
        setItems(activeYearNum ? all.filter(i => i.nianfaiYear === activeYearNum) : []);
    }, []);

    useEffect(() => { load(); }, [load]);

    // 新年度初始化：沿用去年（目前 active year）標記 nianfai_year 的品項當草稿，
    // 設成新年度但「不送出」——season_active 固定設 false，Yw 自己到菜單管理頁
    // 快速修正完（名稱、價格、要不要繼續賣）再手動按「開賣」。
    const handleInitNewYear = async () => {
        const newYear = parseInt(newYearInput, 10);
        if (!newYear) { alert('請輸入有效的年度'); return; }
        if (!window.confirm(`確定要初始化 ${newYear} 年菜嗎？\n\n會把目前標記 ${activeYear || '（無）'} 年菜的品項複製成 ${newYear} 的草稿（不會建立新品項、不會開賣）。`)) return;
        setIsInitializing(true);
        try {
            const all = await getMenuItems();
            const lastYearItems = activeYear ? all.filter(i => i.nianfaiYear === activeYear) : [];
            for (const it of lastYearItems) {
                await updateMenuItem(it.id, { nianfaiYear: newYear });
            }
            await saveSettingValue('nianfai_active_year', String(newYear));
            await saveSettingValue(`nianfai_${newYear}_season_active`, 'false');
            alert(`已初始化 ${newYear} 年菜草稿（沿用 ${lastYearItems.length} 筆去年品項），請到菜單管理頁確認/修正後再開賣。`);
            await load();
        } catch (e) {
            alert(`初始化失敗：${e.message}`);
        } finally {
            setIsInitializing(false);
        }
    };

    const handleToggleSeason = async () => {
        if (!activeYear) return;
        const next = !seasonActive;
        if (next && !window.confirm(`確定要開賣 ${activeYear} 年菜嗎？\n\n開賣後 WebPOS 點餐頁會出現「年菜」tab。`)) return;
        if (!next && !window.confirm(`確定要收單嗎？\n\n收單後 WebPOS 點餐頁的「年菜」tab 會立即隱藏。`)) return;
        setIsToggling(true);
        try {
            await saveSettingValue(`nianfai_${activeYear}_season_active`, next ? 'true' : 'false');
            setSeasonActive(next);
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
                    開賣狀態：
                    <span className={`font-black ml-1 ${seasonActive ? 'text-[#4A9A7A]' : 'text-gray-400'}`}>
                        {activeYear ? (seasonActive ? '開賣中' : '未開賣／已收單') : '—'}
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
                <p className="text-sm text-gray-500 mb-3">把目前年度標記為年菜的品項複製成新年度的草稿（不會開賣），複製完請到菜單管理頁修正名稱/價格/是否繼續賣。</p>
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
                <h3 className="text-xl font-bold text-gray-700 mb-3">3. 開賣 / 收單</h3>
                <p className="text-sm text-gray-500 mb-3">開賣後 WebPOS 點餐頁才會出現「年菜」tab；收單後立即隱藏（現場已無法再點年菜）。</p>
                <button onClick={handleToggleSeason} disabled={!activeYear || isToggling}
                    className={`px-5 py-2.5 rounded-lg font-bold text-white disabled:opacity-50 ${seasonActive ? 'bg-red-500 hover:bg-red-600' : 'bg-[#D47856] hover:bg-[#C46848]'}`}>
                    {isToggling ? '處理中...' : seasonActive ? '收單（隱藏年菜 tab）' : '開賣（顯示年菜 tab）'}
                </button>
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

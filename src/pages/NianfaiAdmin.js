// src/pages/NianfaiAdmin.js — 年菜管理頁（控制中心）
// 修正單 #01：preparing/selling/closed/archived 單一狀態機取代 season_active，
// 新年度初始化改成真的複製品項（新 id，去年資料完全不動）。
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useDialog from '../components/useDialog';
import NianfaiDatesCard from '../components/NianfaiDatesCard';
import NianfaiGoogleCard, { NianfaiFormStatus } from '../components/NianfaiGoogleCard';
import NianfaiMailCard from '../components/NianfaiMailCard';
import { getSettingValue, saveSettingValue, getMenuItems, getInventoryItems, addMenuItem, updateMenuItem, getNianfaiItems, getNianfaiDemand, setNianfaiFormAccepting } from '../db';

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
    const [newYearInput, setNewYearInput] = useState('');
    const [isInitializing, setIsInitializing] = useState(false);
    const [isToggling, setIsToggling] = useState(false);
    const [gasReload, setGasReload] = useState(0);   // 寄信區改了取貨提醒開關 → 重新讀 GAS 狀態
    const [gas, setGas] = useState(null);            // GAS 狀態（由 NianfaiGoogleCard 回報），用來決定能不能開賣
    const [demandInfo, setDemandInfo] = useState(null); // { source, updatedAt, error }
    const [datesReady, setDatesReady] = useState(false); // 取貨與寄出日期設定好了才能開賣

    const load = useCallback(async () => {
        const year = await getSettingValue('nianfai_active_year', null);
        const activeYearNum = year ? parseInt(year, 10) : null;
        setActiveYear(activeYearNum);
        setNewYearInput(String((activeYearNum || new Date().getFullYear()) + 1));
        if (activeYearNum) {
            // 同時讀（以前一個接一個等）
            const [s, nfItems] = await Promise.all([
                getSettingValue(`nianfai_${activeYearNum}_status`, 'preparing'),
                getNianfaiItems(activeYearNum).catch(() => []),
            ]);
            setStatus(STATUS_ORDER.includes(s) ? s : 'preparing');
            setInventoryItems(nfItems);
            getNianfaiDemand(activeYearNum).then(d => setDemandInfo({ source: d.source, updatedAt: d.updatedAt, error: d.error })).catch(() => setDemandInfo(null));
        } else {
            setStatus('archived');
            setInventoryItems([]);
        }
        const all = await getMenuItems();
        setItems(activeYearNum ? all.filter(i => i.category === '年菜' && i.nianfaiYear === activeYearNum) : []);
    }, []);

    useEffect(() => { load(); }, [load]);

    // 有接 GAS 時，開賣前必須建立好 Google 表單並通過「檢查表單對應」；沒接 GAS（例如本機測試）不擋
    // 有接 GAS 時，開賣前必須：建立 Google 表單、通過「檢查表單對應」、測試完畢正式上線；沒接 GAS（本機測試）不擋
    const bankMissing = gas?.bankMissing || [];
    const googleReady = !gas || !gas.configured || (gas.ok && gas.created && !!gas.formCheck?.passed && gas.phase === 'live' && !bankMissing.length);

    // 正式上線後，Google 表單開關跟著開賣狀態（開賣中開放，其餘關閉）；測試中表單保持開放
    const syncFormAccepting = async (nextStatus) => {
        if (!gas?.configured || gas.phase !== 'live') return;
        try { await setNianfaiFormAccepting(activeYear, nextStatus === 'selling'); }
        catch (e) { await showAlert(`狀態已更新，但 Google 表單${nextStatus === 'selling' ? '開啟' : '關閉'}失敗：${e.message}`, { title: '表單開關失敗', icon: 'warning' }); }
    };

    // 新年度初始化＝真的複製：去年品項複製成新的 menu_items（新 id、新 nianfai_year），
    // 套餐的 bundle_composition 重新指向新品項 id；年菜庫存/流水號都歸零；
    // 去年的品項與訂單完全不動，只是不再是「目前年度」。
    const handleInitNewYear = async () => {
        const newYear = parseInt(newYearInput, 10);
        if (!newYear) { await showAlert('請輸入有效的年度', { title: '年度錯誤', icon: 'warning' }); return; }
        // 第一次使用（沒有目前年度）：不複製，直接用菜單裡已經有的該年度品項（正式環境部署時用 SQL 建好的 2027 品項）
        const existing = activeYear ? [] : (await getMenuItems()).filter(i => i.category === '年菜' && i.nianfaiYear === newYear);
        if (!await showConfirm(activeYear ? `複製 ${activeYear} 年菜 ${items.length} 個品項` : existing.length ? `使用菜單裡已有的 ${existing.length} 個 ${newYear} 年菜品項` : `菜單裡還沒有 ${newYear} 年菜品項，建立後請到菜單管理新增`, { title: `建立 ${newYear} 年菜`, icon: 'info', note: activeYear ? '去年資料不會變動' : undefined, confirmText: '建立' })) return;
        setIsInitializing(true);
        try {
            const lastYearItems = items; // 已經是「年菜」分類＋目前年度的品項
            const idMap = new Map();
            // 新 id＝去掉舊年份後綴再加新年份（nf_beef_stew_2027 → nf_beef_stew_2028），不會一年一年疊上去
            const baseId = (id) => String(id).replace(/_\d{4}$/, '');
            lastYearItems.forEach(it => idMap.set(it.id, `${baseId(it.id)}_${newYear}`));
            // 年節限定品項的「年菜庫存」每年各自一筆（庫存從 0 開始），平常也賣的冷凍包庫存照原樣沿用
            const inventory = await getInventoryItems();
            const stockMap = new Map(); // 去年年菜庫存 id -> 新年度年菜庫存 id
            for (const it of lastYearItems) {
                const ref = inventory.find(inv => inv.id === it.nianfaiStockRef);
                if (!ref || ref.category !== '年菜庫存') continue;
                const newStockId = `nfstock_${newYear}_${baseId(it.id)}`;
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
            await showAlert(`${activeYear ? `已複製 ${lastYearItems.length} 個品項` : `共 ${existing.length} 個品項`}\n請設定取貨與寄出日期、到菜單管理確認品項後再開賣`, { title: `${newYear} 年菜已建立`, icon: 'success' });
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
            await syncFormAccepting(next);
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
            await syncFormAccepting(prev);
        } catch (e) {
            await showAlert(e.message, { title: '設定失敗', icon: 'warning' });
        } finally {
            setIsToggling(false);
        }
    };




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
                {activeYear && status !== 'archived' && <NianfaiFormStatus gas={gas} salesStatus={status} compact />}
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

            {activeYear && status !== 'archived' && (
                <NianfaiDatesCard year={activeYear} number={2} onStatusChange={setDatesReady} showAlert={showAlert} />
            )}

            <div className="bg-white rounded-xl shadow p-6 mb-5">
                <h3 className="text-xl font-bold text-gray-700 mb-3">3. 修正品項</h3>
                <p className="text-sm text-gray-500 mb-3">品項的名稱、價格、套餐組成都在菜單管理頁編輯（品項編輯視窗會多一個「🧧 年菜」區塊）。</p>
                <Link to="/menu" className="inline-block px-5 py-2.5 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-800">
                    前往菜單管理頁
                </Link>
            </div>

            <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-xl font-bold text-gray-700 mb-3">4. 開賣 / 收單狀態</h3>
                <p className="text-sm text-gray-500 mb-3">
                    準備中→開賣中→收單後→已封存，只隱藏畫面不刪資料；封存以外桌位頁都會出現年菜卡片（佇列/點單頁），收單後只有 Yw 能從後台加單。
                </p>
                <div className="flex items-center gap-3">
                    {status !== 'archived' && (
                        <button onClick={handleAdvanceStatus} disabled={!activeYear || isToggling || (status === 'preparing' && (!datesReady || !googleReady))}
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
                    {status === 'preparing' && !datesReady && <p className="text-sm font-bold text-red-600">請先在上方設定取貨與寄出日期</p>}
                    {status === 'preparing' && datesReady && !googleReady && <p className="text-sm font-bold text-red-600">{bankMissing.length > 0 ? `請先在試算表「設定」填好匯款資訊（還沒填：${bankMissing.join('、')}）才能開賣` : '請先完成下方「Google 表單／Sheet」的步驟（第 ⑤ 步正式上線）'}</p>}
                </div>
            </div>

            {activeYear && status !== 'archived' && (
                <NianfaiGoogleCard year={activeYear} number={5} datesReady={datesReady}
                    showAlert={showAlert} showConfirm={showConfirm} onStatusChange={setGas} reloadKey={gasReload} salesStatus={status} />
            )}

            {activeYear && (
                <div className="bg-white rounded-xl shadow p-6 mt-5">
                    <h3 className="text-xl font-bold text-gray-700 mb-3">6. 年菜庫存</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        {demandInfo?.source === 'sheet'
                            ? `訂購需求＝Sheet 總訂購量（線上＋已送出的現場單）＋WebPOS 尚未送出的現場單。Sheet 更新時間 ${demandInfo.updatedAt || ''}`
                            : `訂購需求僅含現場單（${demandInfo?.error ? `讀取 Sheet 失敗：${demandInfo.error}` : '尚未連結 Google Sheet'}），不含線上表單，實際需求會更多。`}
                    </p>

                    <p className="text-xs text-gray-400 mb-3">
                        庫存數量在 <Link to="/inventory" className="text-[#4A9A7A] font-bold underline">庫存管理頁</Link> 維護（年節限定＝年菜庫存，平常也賣＝冷凍包庫存）。這裡只顯示對照，不會自動停售或關閉表單。
                    </p>
                    {inventoryItems.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b-2 border-gray-200 text-xs font-bold text-gray-500">
                                        <th className="py-2 pr-2 text-left">品項</th>
                                        <th className="py-2 px-2 text-left">類型</th>
                                        <th className="py-2 px-2 text-right">庫存</th>
                                        <th className="py-2 pl-2 text-right">訂購量</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {inventoryItems.map(item => {
                                        const isBundle = !!item.bundleComposition;
                                        const regular = item.isRegularSellingItem;
                                        const stock = regular ? item.stock : item.nianfaiProductionQty;
                                        const dash = <span className="text-gray-300">—</span>;
                                        return (
                                            <tr key={item.id}>
                                                <td className="py-2 pr-2 font-bold text-gray-800">{item.name}{item.soldOut && <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap">已停售</span>}</td>
                                                <td className="py-2 px-2 text-gray-500">{isBundle ? '套餐' : regular ? '平常也賣' : '年節限定'}</td>
                                                <td className="py-2 px-2 text-right text-gray-800">
                                                    {isBundle ? dash : !item.nianfaiStockRef ? <span className="text-xs font-bold text-red-600">未設定庫存</span> : stock == null ? dash : stock}
                                                </td>
                                                <td className="py-2 pl-2 text-right font-bold text-gray-800">{isBundle ? `${item.ordered || 0} 份` : item.demand}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <p className="text-xs text-gray-400 mt-2">單品的訂購量已把套餐拆開計入；套餐列顯示的是套餐本身的點購份數。</p>
                        </div>
                    )}

                    {inventoryItems.length === 0 && <p className="text-gray-400 text-center py-6">目前沒有年菜品項</p>}
                </div>
            )}

            {activeYear && status !== 'archived' && gas?.ok && gas?.created && (
                <NianfaiMailCard year={activeYear} number={7} gas={gas} showAlert={showAlert} showConfirm={showConfirm}
                    onChanged={() => setGasReload(k => k + 1)} />
            )}
            {dialog}
        </div>
    );
};

export default NianfaiAdminPage;

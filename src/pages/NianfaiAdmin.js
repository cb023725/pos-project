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
// 版面元件放在外層（放在頁面元件裡每次重繪都會變成新元件，裡面的輸入框會失去焦點）
const Group = ({ title, desc }) => (
    <div className="pt-4">
        <h3 className="text-lg font-black text-[#C1032F]">{title}</h3>
        {desc && <p className="text-sm text-gray-500">{desc}</p>}
    </div>
);
const Card = ({ id, n, title, desc, badge, children }) => (
    <div id={id} className="bg-white rounded-xl shadow p-6 scroll-mt-4">
        <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-xl font-bold text-gray-700">{n}. {title}</h3>
            {badge}
        </div>
        {desc && <p className="text-sm text-gray-500 mb-3">{desc}</p>}
        {children}
    </div>
);
const Done = ({ children = '已完成' }) => <span className="text-sm font-bold text-green-700 bg-green-50 rounded-lg px-2 py-1 whitespace-nowrap">✓ {children}</span>;
const NEXT_CONFIRM = {
    preparing: (y) => ({ title: `開賣 ${y} 年菜`, message: '桌位頁出現年菜點單，Google 表單開放顧客下單', confirmText: '開賣' }),
    selling:   (y) => ({ title: `${y} 年菜收單`, message: '桌位頁的年菜點單會隱藏，Google 表單會關閉', confirmText: '收單' }),
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




    // ── 依實際操作順序排列；最上面告訴操作的人「現在該做什麼」，點一下跳到那一段 ──
    const live = gas?.phase === 'live';
    const gasCreated = !!gas?.created;
    const formChecked = !!gas?.formCheck?.passed;
    const usesGoogle = !!gas?.configured;
    const yearOpen = !!activeYear && status !== 'archived';
    const nextStep = (() => {
        if (!yearOpen) return { id: 's-year', text: '建立今年的年菜年度', detail: '輸入年度（例如 2028），按「建立新年度年菜」。' };
        if (status === 'preparing') {
            if (items.length === 0) return { id: 's-items', text: '新增今年的年菜品項', detail: '到菜單管理頁新增或修改年菜品項、價格、套餐內容。' };
            if (!datesReady) return { id: 's-dates', text: '設定取貨與寄出日期', detail: '填預購截止日、自取日期、每日取貨時間、宅配寄出期間，按「儲存」。' };
            if (usesGoogle && !gas?.ok) return { id: 's-google', text: '年菜系統連線中或連線失敗', detail: '稍等一下按「重新整理」；一直失敗請聯絡負責人。' };
            if (usesGoogle && !gasCreated) return { id: 's-google', text: '建立 Google 表單與訂單試算表', detail: '按 ①「建立試算表與表單」，約 1 分鐘。' };
            if (usesGoogle && !formChecked) return { id: 's-google', text: '檢查表單文案，再檢查表單對應', detail: '做完 ②，按 ③「檢查表單對應」直到通過。' };
            if (usesGoogle && bankMissing.length) return { id: 's-google', text: '在試算表「設定」填匯款資訊', detail: `還沒填：${bankMissing.join('、')}（確認信會用到）。` };
            if (usesGoogle && !live) return { id: 's-google', text: '真實測試，測完按「正式上線」', detail: '用 WebPOS 點幾張年菜單、在表單填幾張，確認信件和試算表都正確後，按 ⑤「測試完畢，正式上線」（會清空測試資料）。' };
            return { id: 's-open', text: '開賣', detail: '海報準備好後，按「開賣」：桌位頁出現年菜、Google 表單開放顧客下單。' };
        }
        if (status === 'selling') return { id: 's-mail', text: '開賣中：每天處理寄信、留意庫存', detail: '預購截止、不再接單時，到最下面按「收單」。' };
        return { id: 's-close', text: '已收單：全部取貨、寄出完成後封存', detail: '封存後年菜畫面會隱藏，資料都保留。' };
    })();
    const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btnPrimary = 'px-5 py-2.5 rounded-lg font-bold text-white disabled:opacity-50';

    return (
        <div className="p-6 max-w-3xl mx-auto space-y-5">
            <h2 className="text-4xl font-black text-gray-800">🧧 年菜管理</h2>

            {/* 目前進度＋下一步 */}
            <div className="bg-white rounded-xl shadow p-6">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-gray-600">
                    <span>年度：<b className="text-gray-800">{activeYear || '（尚未建立）'}</b></span>
                    <span>狀態：<b className={status === 'selling' ? 'text-[#4A9A7A]' : 'text-gray-800'}>{activeYear ? STATUS_LABELS[status] : '—'}</b></span>
                    {yearOpen && <span>品項：<b className="text-gray-800">{items.length}</b> 個</span>}
                    {yearOpen && usesGoogle && gasCreated && <span>表單：<b className={live ? 'text-green-700' : 'text-orange-600'}>{live ? '已正式上線' : '測試中'}</b></span>}
                </div>
                {yearOpen && <NianfaiFormStatus gas={gas} salesStatus={status} compact />}
                <button onClick={() => goTo(nextStep.id)} className="mt-4 w-full text-left rounded-xl border-2 border-[#C1032F]/30 bg-[#C1032F]/5 hover:bg-[#C1032F]/10 p-4">
                    <p className="text-xs font-bold text-[#C1032F]">現在要做的事（點這裡跳到該步驟）</p>
                    <p className="text-lg font-black text-gray-800 mt-0.5">👉 {nextStep.text}</p>
                    <p className="text-sm text-gray-600 mt-1">{nextStep.detail}</p>
                </button>
                <p className="text-xs text-gray-400 mt-3">這一頁由上往下就是一整年的操作順序：開賣前準備 → 開賣期間 → 收單與年度結束。每一步做完會打勾。</p>
            </div>

            <Group title="一、開賣前準備" desc="每年做一次，約在開賣前 1～2 週。" />

            <Card id="s-year" n={1} title="建立年度"
                desc={yearOpen ? undefined : (activeYear ? `會把 ${activeYear} 年的年菜品項複製成新年度的品項（去年的資料不會變動），之後在第 2 步修改名稱、價格。` : '第一次使用：會使用菜單裡已經建立好的該年度年菜品項。')}
                badge={yearOpen ? <Done>已建立 {activeYear}</Done> : null}>
                {yearOpen ? (
                    <p className="text-sm text-gray-500">今年的年度已經建立。要建下一個年度，請先在最後的「收單與封存」把今年封存。</p>
                ) : (
                    <div className="flex items-center gap-3">
                        <input type="number" value={newYearInput} onChange={e => setNewYearInput(e.target.value)}
                            className="w-28 border border-gray-300 rounded-lg p-2.5 text-base" />
                        <button onClick={handleInitNewYear} disabled={isInitializing} className={`${btnPrimary} bg-[#4A9A7A]`}>
                            {isInitializing ? '處理中...' : '建立新年度年菜'}
                        </button>
                    </div>
                )}
            </Card>

            {yearOpen && (
                <>
                    <Card id="s-items" n={2} title="確認品項與價格"
                        desc="品項名稱、價格、套餐內容都在「菜單管理」修改（編輯品項時會看到「🧧 年菜」區塊）。開賣後不要再改品名，表單是用品名對應的。"
                        badge={items.length > 0 ? <Done>{items.length} 個品項</Done> : <span className="text-sm font-bold text-red-600 bg-red-50 rounded-lg px-2 py-1">還沒有品項</span>}>
                        <Link to="/menu" className="inline-block px-5 py-2.5 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-800">前往菜單管理頁</Link>
                    </Card>

                    <div id="s-dates" className="scroll-mt-4">
                        <NianfaiDatesCard year={activeYear} number={3} onStatusChange={setDatesReady} showAlert={showAlert} />
                    </div>

                    <div id="s-google" className="scroll-mt-4">
                        <NianfaiGoogleCard year={activeYear} number={4} datesReady={datesReady}
                            showAlert={showAlert} showConfirm={showConfirm} onStatusChange={setGas} reloadKey={gasReload} salesStatus={status} />
                    </div>

                    <div id="s-poster" className="scroll-mt-4">
                        <NianfaiGoogleCard part="poster" year={activeYear} number={5} gasData={gas} onReload={() => setGasReload(k => k + 1)}
                            showAlert={showAlert} showConfirm={showConfirm} salesStatus={status} />
                    </div>

                    <Card id="s-open" n={6} title="開賣"
                        desc="按下開賣後：桌位頁出現年菜（現場點單、年菜訂單），Google 表單開放顧客線上下單。"
                        badge={status !== 'preparing' ? <Done>已開賣</Done> : null}>
                        {status === 'preparing' ? (
                            <div className="space-y-2">
                                <button onClick={handleAdvanceStatus} disabled={isToggling || !datesReady || !googleReady} className={`${btnPrimary} bg-[#D47856] hover:bg-[#C46848]`}>
                                    {isToggling ? '處理中...' : '開賣'}
                                </button>
                                {!datesReady && <p className="text-sm font-bold text-red-600">還不能開賣：請先完成第 3 步「取貨與寄出日期」</p>}
                                {datesReady && !googleReady && <p className="text-sm font-bold text-red-600">還不能開賣：{bankMissing.length > 0 ? `請先在試算表「設定」填好匯款資訊（還沒填：${bankMissing.join('、')}）` : '請先完成第 4 步 Google 表單的 ①～⑤（最後要按「正式上線」）'}</p>}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">{status === 'selling' ? '開賣中。' : '已收單。'}誤按要退回，請到最後的「收單與封存」按「返回上一步」。</p>
                        )}
                    </Card>

                    <Group title="二、開賣期間" desc="開賣到全部寄出、取貨完畢這段時間，每天會用到。" />

                    {gas?.ok && gasCreated && (
                        <div id="s-mail" className="scroll-mt-4">
                            <NianfaiMailCard year={activeYear} number={7} gas={gas} showAlert={showAlert} showConfirm={showConfirm}
                                onChanged={() => setGasReload(k => k + 1)} />
                        </div>
                    )}
                </>
            )}

            {activeYear && status !== 'archived' && (
                <Card id="s-stock" n={8} title="年菜庫存與訂購量"
                    desc={demandInfo?.source === 'sheet'
                        ? `訂購量＝試算表總訂購量（線上＋已送出的現場單）＋WebPOS 還沒送出的現場單。試算表更新時間 ${demandInfo.updatedAt || ''}`
                        : `訂購量只含現場單（${demandInfo?.error ? `讀取試算表失敗：${demandInfo.error}` : '尚未連結 Google 試算表'}），不含線上表單，實際會更多。`}>
                    <p className="text-xs text-gray-400 mb-3">
                        庫存數量在 <Link to="/inventory" className="text-[#4A9A7A] font-bold underline">庫存管理頁</Link> 修改（年節限定＝年菜庫存，平常也賣＝冷凍包庫存）。這裡只做對照，不會自動停售或關閉表單；要停售某個品項，在年菜點單頁長按該品項。
                    </p>
                    {inventoryItems.length > 0 ? (
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
                            <p className="text-xs text-gray-400 mt-2">單品的訂購量已把套餐拆開計入；套餐那一列是套餐本身的份數。</p>
                        </div>
                    ) : <p className="text-gray-400 text-center py-6">目前沒有年菜品項</p>}
                </Card>
            )}

            {yearOpen && (
                <>
                    <Group title="三、收單與年度結束" />
                    <Card id="s-close" n={9} title="收單與封存"
                        desc="收單：預購截止、不再接單時按（桌位頁的年菜點單隱藏）。封存：全部取貨、寄出完成後按（年菜畫面全部隱藏，恢復平常營業；資料都保留）。"
                        badge={status === 'closed' ? <span className="text-sm font-bold text-gray-600 bg-gray-100 rounded-lg px-2 py-1">已收單</span> : null}>
                        {status === 'preparing' ? (
                            <p className="text-sm text-gray-400">開賣後才會用到。</p>
                        ) : (
                            <div className="flex flex-wrap items-center gap-3">
                                <button onClick={handleAdvanceStatus} disabled={isToggling} className={`${btnPrimary} ${status === 'selling' ? 'bg-[#D47856] hover:bg-[#C46848]' : 'bg-gray-700 hover:bg-gray-800'}`}>
                                    {isToggling ? '處理中...' : status === 'selling' ? '收單' : '封存（年度結束）'}
                                </button>
                                <button onClick={handleRevertStatus} disabled={isToggling}
                                    className="px-4 py-2.5 rounded-lg font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-sm">
                                    返回上一步（退回「{STATUS_LABELS[STATUS_ORDER[STATUS_ORDER.indexOf(status) - 1]]}」，修正誤按）
                                </button>
                            </div>
                        )}
                    </Card>

                    <div id="s-tools" className="scroll-mt-4">
                        <NianfaiGoogleCard part="tools" year={activeYear} number={10} gasData={gas} onReload={() => setGasReload(k => k + 1)}
                            showAlert={showAlert} showConfirm={showConfirm} salesStatus={status} />
                    </div>
                </>
            )}
            {dialog}
        </div>
    );
};

export default NianfaiAdminPage;

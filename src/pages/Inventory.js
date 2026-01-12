// src/pages/Inventory.js
import React, { useState, useMemo, useCallback, useEffect } from 'react';
// 假設 getMenuItems 返回包含 {id, name, category, consumes: ['id1', 'id2']} 結構的菜單
import { getMenuItems, updateMenuItem } from '../db'; 

// ----------------------------------------------------------------------
// 1. 庫存項目初始設定
// ----------------------------------------------------------------------

// 初始庫存配置 (這是庫存管理頁面要管理的對象)
const INITIAL_STOCK_CONFIG = [
    // 主食庫存
    { id: 'beef', name: '紅燒牛腩筋', category: '主食庫存', stock: 15, thresholds: { full: 45, low: 25, urgent: 10 } },
    { id: 'pork_ribs', name: '無錫排骨', category: '主食庫存', stock: 15, thresholds: { full: 45, low: 25, urgent: 10 } },
    { id: 'pork_shoulder', name: '松阪豬', category: '主食庫存', stock: 15, thresholds: { full: 30, low: 10, urgent: 5 } },
    { id: 'chicken_soup', name: '菜脯雞湯', category: '主食庫存', stock: 10, thresholds: { full: 18, low: 10, urgent: 5 } },
    { id: 'curry_chicken', name: '咖哩雞胸', category: '主食庫存', stock: 15, thresholds: { full: 15, low: 8, urgent: 5 } },
    { id: 'salted_pork', name: '鹹豬肉', category: '主食庫存', stock: 15, thresholds: { full: 15, low: 8, urgent: 3 } },
    { id: 'goulash', name: '匈牙利牛肉湯', category: '主食庫存', stock: 10, thresholds: { full: 30, low: 12, urgent: 8 } },
    
    // 點心庫存
    { id: 'pig_balls', name: '小豬球', category: '點心庫存', stock: 30, thresholds: { full: 30, low: 10, urgent: 6 } },
    { id: 'fried_chicken', name: '炸雞', category: '點心庫存', stock: 30, thresholds: { full: 20, low: 10, urgent: 5 } },
];

// ----------------------------------------------------------------------
// 2. 輔助元件：閾值與菜單連動設定 Modal (ThresholdSettingModal)
// ----------------------------------------------------------------------
const ThresholdInput = ({ label, value, onChange, color }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
            type="number"
            value={value}
            onChange={onChange}
            min="0"
            className={`w-full p-3 border-2 rounded-lg text-lg font-bold text-right focus:ring-blue-500 focus:border-blue-500 ${color}`}
        />
    </div>
);

// 修正 ThresholdSettingModal，接收全菜單與連動映射
const ThresholdSettingModal = ({ isOpen, onClose, item, onSave, allMenuItems, consumesMapping }) => {
    const [thresholds, setThresholds] = useState({ full: 0, low: 0, urgent: 0 });
    
    // 1. 取得與當前庫存項目連動的所有菜單項目 (來自父元件傳入的映射)
    const consumingMenuItems = useMemo(() => {
        // consumesMapping[item?.id] 包含了所有消耗當前庫存 item 的菜單項目
        return consumesMapping[item?.id] || [];
    }, [item, consumesMapping]);

    // 2. 為了分組顯示，建立全菜單的分類映射 (用於產生分類標題)
    const menuItemsByCategory = useMemo(() => {
        // 這裡不需要 deduplicate，因為我們只用它來找 category
        return allMenuItems.reduce((acc, menuItem) => {
            (acc[menuItem.category] = acc[menuItem.category] || []).push(menuItem);
            return acc;
        }, {});
    }, [allMenuItems]);


    useEffect(() => {
        if (isOpen && item) {
            setThresholds(item.thresholds);
        }
    }, [isOpen, item]);

    const handleInputChange = (key, value) => {
        const numValue = Math.max(0, parseInt(value, 10) || 0);
        setThresholds(prev => ({ ...prev, [key]: numValue }));
    };
    
    const handleSave = () => {
        const { full, low, urgent } = thresholds;
        // 修正閾值檢查邏輯：full > low > urgent
        if (!(urgent < low && low < full)) { 
             alert('閾值設定錯誤：必須滿足 緊急 < 偏低 < 充足。請重新設定。');
             return;
         }
        onSave(item.id, thresholds); 
        onClose();
    };

    if (!isOpen || !item) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-y-auto relative">
                
                {/* 右上角叉叉按鈕 */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
                    title="退出設定"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h3 className="text-2xl font-black mb-6 text-gray-800 border-b pb-2">
                    ⚙️ 設定 {item.name} 庫存警戒線
                </h3>
                
                {/* 庫存閾值設定 */}
                <h4 className="text-lg font-bold text-gray-700 mb-3 border-l-4 border-blue-500 pl-3">1. 庫存警戒線 (充足 &gt; 偏低 &gt; 緊急)</h4>
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <ThresholdInput 
                        label="充足數量"
                        value={thresholds.full}
                        onChange={(e) => handleInputChange('full', e.target.value)}
                        color="text-green-600 border-green-300"
                    />
                    <ThresholdInput 
                        label="偏低數量"
                        value={thresholds.low}
                        onChange={(e) => handleInputChange('low', e.target.value)}
                        color="text-orange-600 border-orange-300"
                    />
                    <ThresholdInput 
                        label="緊急數量"
                        value={thresholds.urgent}
                        onChange={(e) => handleInputChange('urgent', e.target.value)}
                        color="text-red-600 border-red-300"
                    />
                </div>
                
                {/* 菜單連動設定 (只讀顯示) */}
                <h4 className="text-lg font-bold text-gray-700 mb-3 border-l-4 border-emerald-500 pl-3">2. 菜單銷售連動</h4>
                <p className="text-sm text-gray-500 mb-4">
                    以下菜單品項（已在**菜單管理**中設定）售出時，會消耗 **{item.name}** 一份庫存。
                </p>
                <div className="space-y-4">
                    {consumingMenuItems.length > 0 ? (
                        // 使用菜單分類進行顯示
                        // 迭代所有菜單分類
                        Object.entries(menuItemsByCategory).map(([category, menuItems]) => {
                            // 過濾：只顯示屬於這個分類且與當前庫存項目連動的品項
                            const relevantItems = menuItems.filter(menuItem => 
                                consumingMenuItems.some(cItem => cItem.id === menuItem.id)
                            );
                            
                            if (relevantItems.length === 0) return null; // 該分類無連動項目，不顯示分類標題
                            
                            return (
                                <div key={category} className="bg-green-50 p-4 rounded-lg border border-green-200">
                                    <p className="font-black text-green-800 mb-3 border-b pb-1 text-base">
                                        🔗 {category} (連動中)
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        {relevantItems.map(menuItem => (
                                            <div 
                                                key={menuItem.id} 
                                                className={`flex items-center p-2 rounded-lg bg-green-100 font-semibold border-l-4 border-green-500 text-sm`}
                                            >
                                                <span className="text-green-700 mr-2">✅</span>
                                                {menuItem.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                         <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-center text-yellow-800 font-semibold">
                            ⚠️ 此庫存目前未被任何菜單品項連動消耗。
                        </div>
                    )}
                </div>


                <button 
                    onClick={handleSave} 
                    className="w-full mt-6 bg-blue-500 hover:bg-blue-600 text-white p-3 rounded-xl text-xl font-black shadow-md"
                >
                    儲存
                </button>
            </div>
        </div>
    );
};


// ----------------------------------------------------------------------
// 3. 輔助元件：數字鍵盤 Modal (StockOperationModal) (不變)
// ----------------------------------------------------------------------

const StockOperationModal = ({ isOpen, onClose, item, onSave }) => {
    const [inputValue, setInputValue] = useState(0); 
    const [operationType, setOperationType] = useState('replenish'); // replenish, consume, inventory

    useEffect(() => {
        if (isOpen) {
            setInputValue(0);
            setOperationType('replenish');
        }
    }, [isOpen, item]);

    const handleInput = (digit) => {
        setInputValue(prev => {
            const current = String(prev);
            let newValue = current === '0' ? digit : current + digit;
            
            if (!/^\d*$/.test(newValue)) return prev;
            
            if (newValue.length > 1 && newValue.startsWith('0')) {
                newValue = newValue.slice(1);
            }
            
            return Number(newValue);
        });
    };
    
    const handleDelete = () => {
        setInputValue(prev => {
            const current = String(prev);
            return current.length > 1 ? Number(current.slice(0, -1)) : 0;
        });
    };

    const handleSave = () => {
        if (inputValue <= 0 && operationType !== 'inventory') {
            alert('補貨或消耗數量必須大於 0');
            return;
        }
        
        if (operationType === 'inventory' && inputValue < 0) {
             alert('盤點數量不能小於 0');
             return;
        }

        let finalStock = item.stock;
        let operationName = '';
        
        switch (operationType) {
            case 'replenish': 
                finalStock = item.stock + inputValue;
                operationName = '補貨';
                break;
            case 'consume': 
                finalStock = Math.max(0, item.stock - inputValue);
                operationName = '消耗';
                break;
            case 'inventory': 
                finalStock = inputValue;
                operationName = '盤點';
                break;
            default:
                break;
        }
        
        onSave(item.id, finalStock, operationType, inputValue);
        onClose();
    };

    if (!isOpen || !item) return null;
    
    const getOperationText = () => {
        switch (operationType) {
            case 'replenish': return '補貨';
            case 'consume': return '消耗';
            case 'inventory': return '盤點';
            default: return '操作';
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[400px] relative">
                
                {/* 右上角叉叉退出 */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
                    title="退出操作"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h3 className="text-2xl font-black mb-4 text-gray-800">
                    庫存操作: {item.name}
                </h3>

                {/* 操作類型選擇 */}
                <div className="flex justify-between mb-4 bg-gray-100 rounded-lg p-1">
                    <button 
                        onClick={() => setOperationType('replenish')}
                        className={`flex-grow p-2 rounded-lg text-sm font-bold transition-all ${operationType === 'replenish' ? 'bg-emerald-500 text-white shadow-md' : 'text-gray-600'}`}
                    >
                        補貨
                    </button>
                    <button 
                        onClick={() => setOperationType('consume')}
                        className={`flex-grow p-2 rounded-lg text-sm font-bold transition-all ${operationType === 'consume' ? 'bg-orange-500 text-white shadow-md' : 'text-gray-600'}`}
                    >
                        消耗
                    </button>
                    <button 
                        onClick={() => setOperationType('inventory')}
                        className={`flex-grow p-2 rounded-lg text-sm font-bold transition-all ${operationType === 'inventory' ? 'bg-blue-500 text-white shadow-md' : 'text-gray-600'}`}
                    >
                        盤點
                    </button>
                </div>
                
                <div className="text-lg font-bold text-gray-600 mb-2">當前庫存: <span className="text-2xl font-black text-green-700 ml-2">{item.stock}</span> 份</div>
                
                <div className="text-3xl font-black text-right border-4 border-gray-200 p-3 mb-4 rounded-xl bg-gray-50 text-gray-900">
                    <span className="font-extrabold text-3xl">{inputValue}</span> 份
                </div>

                {/* 數字鍵盤 */}
                <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                        <button key={n} onClick={() => handleInput(String(n))} className="bg-gray-200 hover:bg-gray-300 p-3 rounded-xl text-xl font-bold">
                            {n}
                        </button>
                    ))}
                    <button onClick={() => setInputValue(0)} className="bg-red-200 hover:bg-red-300 p-3 rounded-xl text-lg font-bold">
                        清空
                    </button>
                    <button onClick={() => handleInput('0')} className="bg-gray-200 hover:bg-gray-300 p-3 rounded-xl text-xl font-bold">
                        0
                    </button>
                    <button onClick={handleDelete} className="bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-xl text-lg font-bold">
                        刪除
                    </button>
                </div>

                <button 
                    onClick={handleSave} 
                    className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white p-3 rounded-xl text-lg font-black shadow-md"
                >
                    確認執行{getOperationText()}
                </button>
            </div>
        </div>
    );
};


// ----------------------------------------------------------------------
// 4. 輔助元件：卡片與篩選按鈕 (不變)
// ----------------------------------------------------------------------

const Card = ({ title, count, color, onClick, isActive, icon }) => {
    const baseColor = {
        green: 'border-green-500 text-green-700 bg-green-50/50',
        orange: 'border-orange-600 text-orange-700 bg-orange-50/50',
        red: 'border-red-600 text-red-700 bg-red-50/50',
    };
    
    const mainColor = {
        green: 'text-green-600',
        orange: 'text-orange-600',
        red: 'text-red-600',
    }
    
    return (
        <button 
            onClick={onClick}
            className={`w-full bg-white p-5 rounded-xl shadow-lg border-l-4 transition-all text-left ${baseColor[color]} ${isActive ? 'ring-2 ring-offset-2 ring-blue-500 shadow-xl scale-[1.01] border-l-8' : 'hover:scale-[1.01] hover:shadow-xl'}`}
        >
            <div className='flex justify-between items-center mb-1'>
                <p className="text-sm font-bold">{title}</p>
                <div className={`p-2 rounded-full bg-opacity-80 ${mainColor[color]}`}>
                    {icon}
                </div>
            </div>
            
            <p className="text-3xl font-black text-gray-800">{count} 項</p>
        </button>
    );
};


const FilterButton = ({ label, status, currentStatus, onClick }) => {
    // ⚠️ 狀態已經簡化，只檢查 currentStatus 是否等於 status
    const isActive = currentStatus === status; 
    
    return (
        <button 
            onClick={() => onClick(status)}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${
                isActive 
                ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
        >
            {label}
        </button>
    );
};


// ----------------------------------------------------------------------
// 5. 庫存管理主元件
// ----------------------------------------------------------------------

const InventoryPage = () => {
    const [inventory, setInventory] = useState(INITIAL_STOCK_CONFIG);
    const [isLoading, setIsLoading] = useState(false); 
    const [filterStatus, setFilterStatus] = useState('全部'); 
    const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
    const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);

    // 儲存從 DB 讀取的所有菜單項目 (包含最新的 consumes 資訊)
    const [allMenuItems, setAllMenuItems] = useState([]); 
    
    // 輔助函式：根據內容（名稱+類別）進行去重複
    const deduplicateAndFormat = useCallback((items) => {
        const uniqueItemsMap = new Map();
        items.forEach(item => {
            const compositeKey = `${item.name}-${item.category}`; 
            
            if (!uniqueItemsMap.has(compositeKey)) {
                 uniqueItemsMap.set(compositeKey, { 
                    ...item, 
                    consumes: item.consumes || [],
                });
            }
        });
        return Array.from(uniqueItemsMap.values());
    }, []);

    // 從 DB 載入菜單資料並建立連動對照表
    useEffect(() => {
        const loadData = async () => {
            try {
                // 讀取最新的菜單連動數據
                const items = await getMenuItems(); 
                
                // 使用 MenuManagement 的去重複邏輯確保數據乾淨
                const uniqueItemsWithConsumes = deduplicateAndFormat(items);
                
                setAllMenuItems(uniqueItemsWithConsumes); 
                
            } catch (error) {
                console.error("載入菜單資料失敗:", error);
                setAllMenuItems([]); 
            }
        };
        loadData();
    }, [deduplicateAndFormat]); 


    // 根據 DB 菜單動態建立庫存連動對照表 (Memoized)
    const inventoryConsumesMapping = useMemo(() => {
        return allMenuItems.reduce((acc, menuItem) => {
            const consumes = menuItem.consumes || []; 
            consumes.forEach(inventoryId => {
                if (!acc[inventoryId]) acc[inventoryId] = [];
                acc[inventoryId].push(menuItem); // 將菜單項目加入到其消耗的庫存 ID 下
            });
            return acc;
        }, {});
    }, [allMenuItems]);


    // 庫存狀態判斷函式 (已修改：合併「充足」和「正常」)
    const getStockStatus = useCallback((item) => {
        const stock = item.stock;
        const { low, urgent } = item.thresholds; // full 不再用於狀態判斷

        if (stock <= urgent) return { status: '緊急', color: 'bg-red-600 text-white', display: '極需補貨', badge: 'bg-red-600' };
        if (stock < low) return { status: '偏低', color: 'bg-orange-500 text-white', display: '庫存偏低', badge: 'bg-orange-500' };
        
        // 只要 stock >= low，都屬於「充足」
        // 使用原本「充足」的綠色樣式
        return { status: '充足', color: 'bg-green-500 text-white', display: '庫存充足', badge: 'bg-green-500' };
    }, []);

    // 處理庫存操作後儲存 (補貨/消耗/盤點) (不變)
    const handleStockSave = useCallback((id, newStock, type, amount) => {
        setIsLoading(true);
        // 這裡應當呼叫 updateMenuItem(id, { stock: newStock })
        setInventory(prevInventory =>
            prevInventory.map(item => 
                item.id === id ? { ...item, stock: newStock } : item
            )
        );
        setIsLoading(false);
    }, []);
    
    // 處理閾值設定後儲存 (不變)
    const handleThresholdSave = useCallback((id, newThresholds) => {
        const itemName = inventory.find(i => i.id === id)?.name;

        // 這裡應當呼叫 updateMenuItem(id, { thresholds: newThresholds })
        setInventory(prevInventory =>
            prevInventory.map(item => 
                item.id === id ? { ...item, thresholds: newThresholds } : item
            )
        );
        
        alert(`${itemName} 庫存警戒線設定已更新！`);
    }, [inventory]); 

    // 處理點擊 Modal 開啟 (不變)
    const handleOpenOperationModal = (item) => {
        setSelectedItem(item);
        setIsOperationModalOpen(true);
    };
    
    const handleOpenThresholdModal = (item) => {
        setSelectedItem(item);
        setIsThresholdModalOpen(true);
    };

    // 篩選邏輯 (已修改：只檢查 '充足')
    const filteredInventory = useMemo(() => {
        if (filterStatus === '全部') return inventory;
        
        return inventory.filter(item => {
            const status = getStockStatus(item).status;
            
            if (filterStatus === '充足') return status === '充足';
            if (filterStatus === '偏低') return status === '偏低';
            if (filterStatus === '緊急') return status === '緊急';
            
            return false;
        });
    }, [inventory, filterStatus, getStockStatus]);

    // 分組顯示 (不變)
    const groupedInventory = useMemo(() => {
        return filteredInventory.reduce((acc, item) => {
            (acc[item.category] = acc[item.category] || []).push(item);
            return acc;
        }, {});
    }, [filteredInventory]);

    // 計算總體狀態概況 (已修改：只檢查 '充足')
    const summary = useMemo(() => {
        let fullCount = 0; // 現在包含原來的「充足」和「正常」
        let lowCount = 0;
        let urgentCount = 0;

        inventory.forEach(item => {
            const status = getStockStatus(item).status;
            if (status === '緊急') urgentCount++;
            else if (status === '偏低') lowCount++;
            else if (status === '充足') fullCount++;
        });

        return { fullCount, lowCount, urgentCount, totalItems: inventory.length };
    }, [inventory, getStockStatus]);


    return (
        <div className="flex flex-col h-full w-full p-6 bg-gray-50">
            
            {/* 標題 */}
            <div className="flex justify-between items-center mb-6 border-b pb-3">
                <h2 className="text-3xl font-black text-gray-800">庫存管理</h2>
            </div>

            {/* 庫存狀態總覽 (點擊可篩選) */}
            <div className="grid grid-cols-3 gap-5 mb-8">
                {/* 充足 (合併了原來的充足和正常) */}
                <Card 
                    title="庫存充足" 
                    count={summary.fullCount} 
                    color="green" 
                    onClick={() => setFilterStatus('充足')}
                    isActive={filterStatus === '充足'}
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.007 12.007 0 002.944 12c.002.095.008.19.018.285.007.09.017.179.029.268A11.983 11.983 0 0012 21.056a11.955 11.955 0 018.618-3.04A12.007 12.007 0 0021.056 12c-.002-.095-.008-.19-.018-.285-.007-.09-.017-.179-.029-.268z" /></svg>}
                />
                
                {/* 偏低 */}
                <Card 
                    title="庫存偏低" 
                    count={summary.lowCount} 
                    color="orange" 
                    onClick={() => setFilterStatus('偏低')}
                    isActive={filterStatus === '偏低'}
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 7c-.77-1.333-2.694-1.333-3.464 0L3.318 16c-.77 1.333.192 3 1.732 3z" /></svg>}
                />
                
                {/* 緊急 */}
                <Card 
                    title="極需補貨" 
                    count={summary.urgentCount} 
                    color="red" 
                    onClick={() => setFilterStatus('緊急')}
                    isActive={filterStatus === '緊急'}
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                />
            </div>
            
            {/* 庫存列表 */}
            <div className="flex-grow overflow-y-auto bg-white rounded-xl shadow-xl">
                <div className="p-4 border-b border-gray-100">
                    {/* 篩選按鈕 (已修改標籤) */}
                    <div className="flex space-x-2">
                        <FilterButton label="全部" status="全部" currentStatus={filterStatus} onClick={setFilterStatus} />
                        <FilterButton label="充足" status="充足" currentStatus={filterStatus} onClick={setFilterStatus} />
                        <FilterButton label="偏低" status="偏低" currentStatus={filterStatus} onClick={setFilterStatus} />
                        <FilterButton label="緊急" status="緊急" currentStatus={filterStatus} onClick={setFilterStatus} />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-3/12">
                                    品項名稱
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">
                                    類別
                                </th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">
                                    當前庫存 (份)
                                </th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">
                                    狀態
                                </th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-1/12">
                                    操作
                                </th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-2/12">
                                    設定
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {Object.entries(groupedInventory).map(([category, items]) => (
                                <React.Fragment key={category}>
                                    <tr className="bg-gray-100">
                                        <td colSpan="6" className="px-6 py-3 text-sm font-black text-gray-800 border-l-4 border-blue-600">
                                            {category}
                                        </td>
                                    </tr>
                                    {items.map(item => {
                                        const { display, badge } = getStockStatus(item);
                                        
                                        return (
                                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                                    {item.name}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {item.category}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center text-lg font-black text-gray-800">
                                                    {item.stock}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className={`px-3 py-1 text-xs font-bold rounded-full text-white ${badge}`}>
                                                        {display}
                                                    </span>
                                                </td>
                                                
                                                {/* 補貨按鈕 (箱子圖示) - 調整為操作 */}
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <button
                                                        onClick={() => handleOpenOperationModal(item)}
                                                        disabled={isLoading}
                                                        className={`text-emerald-600 hover:text-white hover:bg-emerald-600 transition-colors p-2 rounded-lg ${
                                                            isLoading 
                                                            ? 'opacity-50 cursor-not-allowed'
                                                            : 'active:scale-95'
                                                        }`}
                                                        title="執行庫存操作 (補貨/消耗/盤點)"
                                                    >
                                                        {/* 箱子 + 向上箭頭 */}
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h3m-1 4v-3" /></svg>
                                                    </button>
                                                </td>

                                                {/* 設定按鈕 (齒輪圖示) - 恢復齒輪圖示 */}
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <button
                                                        onClick={() => handleOpenThresholdModal(item)}
                                                        className="text-gray-400 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-gray-200"
                                                        title="設定庫存閾值及查看菜單連動"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.941 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.941-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        </svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal 渲染 (不變) */}
            {isOperationModalOpen && selectedItem && (
                <StockOperationModal 
                    isOpen={isOperationModalOpen}
                    onClose={() => setIsOperationModalOpen(false)}
                    item={selectedItem}
                    onSave={handleStockSave}
                />
            )}
            
            {isThresholdModalOpen && selectedItem && (
                 <ThresholdSettingModal
                    isOpen={isThresholdModalOpen}
                    onClose={() => setIsThresholdModalOpen(false)}
                    item={selectedItem}
                    onSave={handleThresholdSave}
                    allMenuItems={allMenuItems}
                    consumesMapping={inventoryConsumesMapping}
                />
            )}
        </div>
    );
};

export default InventoryPage;
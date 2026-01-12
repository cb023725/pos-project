import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getReportOrders } from '../db'; // 【✅ 修正：從 getOrders 替換為 getReportOrders】
import { useNavigate } from 'react-router-dom';

// ----------------------------------------------------------------------
// 輔助函式：日期與時間處理
// ----------------------------------------------------------------------

// 時間區間定義
const DAY_START_HOUR = 11; // 11:00 AM
const DAY_END_HOUR = 16;   // 4:00 PM
const NIGHT_END_HOUR = 21; // 9:00 PM

/**
 * 格式化金額
 * @param {number} number 
 * @returns {string}
 */
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US'); 
};

/**
 * 格式化 ISO 日期字串為易讀格式
 * @param {string} dateISOString 
 * @returns {string}
 */
const formatDate = (dateISOString) => {
    if (!dateISOString) return 'N/A';
    const date = new Date(dateISOString);
    return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
};

/**
 * 判斷訂單時間屬於「白天」或「晚上」
 * @param {string} timestampISOString 
 * @returns {'day'|'night'|'other'}
 */
const getTimeSlot = (timestampISOString) => {
    const date = new Date(timestampISOString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    
    // 白天：11:00 - 16:00
    if (hours >= DAY_START_HOUR && (hours < DAY_END_HOUR || (hours === DAY_END_HOUR && minutes === 0))) {
        return 'day';
    }
    // 晚上：16:30 - 21:00 (簡化為 > 16:00 且 <= 21:00)
    else if ((hours > DAY_END_HOUR || (hours === DAY_END_HOUR && minutes >= 30)) && hours <= NIGHT_END_HOUR) {
        return 'night';
    }
    return 'other';
};

/**
 * 排序輔助函數
 */
const sortData = (data, key, direction) => {
    return [...data].sort((a, b) => {
        let comparison = 0;
        if (a[key] > b[key]) comparison = 1;
        else if (a[key] < b[key]) comparison = -1;
        return direction === 'asc' ? comparison : comparison * -1;
    });
};


// ----------------------------------------------------------------------
// Dashboard/Report Data Calculation Hooks
// ----------------------------------------------------------------------

/**
 * 彙總報表核心數據
 */
const useReportSummary = (filteredOrders, allOrders, dateFilter) => {
    
    // 1. 當日報表計算 (基於 filteredOrders)
    const summary = useMemo(() => {
        let totalRevenue = 0;
        let dayRevenue = 0;
        let nightRevenue = 0;
        let customerCount = 0;
        
        filteredOrders.forEach(order => {
            totalRevenue += order.total;
            // 假設 customerCount 存在，否則預設為 1
            customerCount += order.customerCount || 1; 

            const slot = getTimeSlot(order.timestamp);
            if (slot === 'day') {
                dayRevenue += order.total;
            } else if (slot === 'night') {
                nightRevenue += order.total;
            }
        });

        const averagePrice = customerCount > 0 ? totalRevenue / customerCount : 0;
        
        return {
            totalRevenue,
            dayRevenue,
            nightRevenue,
            customerCount,
            averagePrice: Math.round(averagePrice),
        };
    }, [filteredOrders]);

    // 2. 當月總營業額計算 (需要所有訂單)
    const monthlyTotal = useMemo(() => {
        if (!dateFilter) return allOrders.reduce((sum, order) => sum + order.total, 0);

        const selectedDate = new Date(dateFilter);
        const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).toISOString().split('T')[0];
        // 計算當月最後一天
        const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).toISOString().split('T')[0];
        
        return allOrders.reduce((sum, order) => {
            const orderDateString = (order.date || order.timestamp).split('T')[0];
            if (orderDateString >= startOfMonth && orderDateString <= endOfMonth) {
                return sum + order.total;
            }
            return sum;
        }, 0);
    }, [allOrders, dateFilter]);
    
    return { ...summary, monthlyTotal };
};

/**
 * 彙總商品和類別銷售排行
 */
const useSalesRankings = (filteredOrders) => {
    return useMemo(() => {
        const itemMap = new Map();
        const categoryMap = new Map();

        filteredOrders.forEach(order => {
            order.items.forEach(item => {
                const itemTotal = item.price * item.quantity;
                
                // 商品排行
                const itemData = itemMap.get(item.name) || { name: item.name, quantity: 0, revenue: 0, category: item.category };
                itemData.quantity += item.quantity;
                itemData.revenue += itemTotal;
                itemMap.set(item.name, itemData);

                // 類別排行 (假設 item.category 存在於訂單項目中)
                const categoryName = item.category || '未分類';
                const categoryData = categoryMap.get(categoryName) || { name: categoryName, quantity: 0, revenue: 0 };
                categoryData.quantity += item.quantity;
                categoryData.revenue += itemTotal;
                categoryMap.set(categoryName, categoryData);
            });
        });

        const itemRank = Array.from(itemMap.values());
        const categoryRank = Array.from(categoryMap.values());
        
        itemRank.sort((a, b) => b.quantity - a.quantity);
        categoryRank.sort((a, b) => b.quantity - a.quantity);

        return { itemRank, categoryRank };

    }, [filteredOrders]);
};


// ----------------------------------------------------------------------
// Report Page Component
// ----------------------------------------------------------------------

const ReportPage = () => {
    
    // --- 狀態定義 (Hooks 頂層 1/4) ---
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    // 預設為今天
    const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]); 
    const [itemSortKey, setItemSortKey] = useState('quantity');
    const [categorySortKey, setCategorySortKey] = useState('quantity');
    const [itemSortDirection, setItemSortDirection] = useState('desc');
    const [categorySortDirection, setCategorySortDirection] = useState('desc');
    
    const navigate = useNavigate();

    // --- 副作用 (Hooks 頂層 2/4) ---
    useEffect(() => {
        loadOrders();
    }, []);

    const loadOrders = async () => {
        setIsLoading(true);
        
        // 【✅ 修正點 1：直接呼叫 getReportOrders，只獲取已結帳的報表數據】
        const reportableOrders = await getReportOrders(); 
        
        // 🚨 移除前端手動篩選 order.status === 'paid_report_complete' 的邏輯 
        // 因為 getReportOrders 已經在 IndexedDB 層面完成篩選，效率更高且邏輯更清晰。
        
        setOrders(reportableOrders.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())); 
        setIsLoading(false);
    };

    // --- 計算屬性 (Hooks 頂層 3/4) ---
    
    // 1. 依日期過濾訂單
    const filteredOrders = useMemo(() => {
        if (!dateFilter) return orders;
        
        const filterDateString = dateFilter.split('T')[0];

        return orders.filter(order => {
            const orderDateString = (order.date || order.timestamp).split('T')[0];
            return orderDateString === filterDateString;
        });
    }, [orders, dateFilter]);
    
    // 2. 彙總數據
    const { totalRevenue, dayRevenue, nightRevenue, customerCount, averagePrice, monthlyTotal } = useReportSummary(filteredOrders, orders, dateFilter);
    const { itemRank, categoryRank } = useSalesRankings(filteredOrders);

    // 3. 排序後的銷售排行
    const sortedItemRank = useMemo(() => sortData(itemRank, itemSortKey, itemSortDirection), [itemRank, itemSortKey, itemSortDirection]);
    const sortedCategoryRank = useMemo(() => sortData(categoryRank, categorySortKey, categorySortDirection), [categoryRank, categorySortKey, categorySortDirection]);
    
    // 4. 趨勢圖數據結構佔位符
    const weeklyRevenueData = useMemo(() => {
        // 實際計算近四周以週四為始的數據結構，此處為簡化範例
        return []; 
    }, [orders]);
    

    // --- 函數定義 (Hooks 頂層 4/4) ---
    const handleSort = (key, currentKey, currentDirection, setKey, setDirection) => {
        if (currentKey === key) {
            setDirection(currentDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setKey(key);
            setDirection('desc');
        }
    };
    
    const renderSortArrow = (key, currentKey, direction) => {
        if (currentKey !== key) return null;
        return direction === 'asc' ? ' 🔼' : ' 🔽';
    };


    if (isLoading) {
        return <div className="p-6 text-center text-xl text-blue-600">報表載入中...</div>;
    }

    return (
        <div className="p-6">
            <h2 className="text-3xl font-black mb-6 text-gray-900 border-b pb-2">營業報表</h2>
            
            {/* 篩選日期與回總覽按鈕 */}
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-md mb-6 border-l-4 border-blue-500">
                <div className="flex items-center space-x-4">
                    <button onClick={() => navigate('/tables')} className="px-4 py-2 bg-blue-100 rounded-lg text-blue-600 hover:bg-blue-200 transition font-bold">
                        回桌位總覽
                    </button>
                    <div>
                        <label htmlFor="date-filter" className="block text-sm font-medium text-gray-700 mb-1">請選擇報表日期</label>
                        <input
                            id="date-filter"
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                            onClick={() => setDateFilter('')}
                            className="ml-3 px-4 py-2 bg-gray-200 rounded-lg text-gray-700 hover:bg-gray-300 transition"
                        >
                            清除篩選 (所有紀錄)
                        </button>
                    </div>
                </div>

                <div className="text-right">
                    <p className="text-sm font-medium text-gray-500">當前顯示日期：{dateFilter || '全部日期'}</p>
                    <p className="text-xl font-extrabold text-red-600">
                        當月總營收: ${formatCurrency(monthlyTotal)}
                    </p>
                </div>
            </div>


            {/* 核心儀表板數據 (Dashboard) */}
            <div className="grid grid-cols-4 gap-4 mb-8">
                
                {/* 總營業額 */}
                <div className="bg-white p-5 rounded-xl shadow-lg border-l-4 border-green-500">
                    <p className="text-sm font-medium text-gray-500">當日總營業額</p>
                    <p className="text-3xl font-extrabold text-green-700 mt-1">${formatCurrency(totalRevenue)}</p>
                    <div className="mt-3 text-xs text-gray-600">
                        <span className="font-semibold text-blue-500">白天</span> ${formatCurrency(dayRevenue)}<br/>
                        <span className="font-semibold text-red-500">晚上</span> ${formatCurrency(nightRevenue)}
                    </div>
                </div>

                {/* 來客數 */}
                <div className="bg-white p-5 rounded-xl shadow-lg border-l-4 border-purple-500">
                    <p className="text-sm font-medium text-gray-500">當日來客數</p>
                    <p className="text-3xl font-extrabold text-purple-700 mt-1">{customerCount} 人</p>
                    <div className="mt-3 text-xs text-gray-600">
                        <span className="font-semibold">訂單數</span>: {filteredOrders.length}
                    </div>
                </div>

                {/* 客單價 */}
                <div className="bg-white p-5 rounded-xl shadow-lg border-l-4 border-orange-500">
                    <p className="text-sm font-medium text-gray-500">當日客單價</p>
                    <p className="text-3xl font-extrabold text-orange-700 mt-1">${formatCurrency(averagePrice)}</p>
                    <div className="mt-3 text-xs text-gray-600">
                         {customerCount > 0 
                            ? `($${formatCurrency(totalRevenue)} / ${customerCount}人)`
                            : '來客數不足，無法計算'
                         }
                    </div>
                </div>
                
                {/* 趨勢圖佔位符 (實際應用需使用圖表庫) */}
                <div className="bg-white p-5 rounded-xl shadow-lg border-l-4 border-yellow-500">
                    <p className="text-sm font-medium text-gray-500">近四周營業額趨勢</p>
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                        [營業額折線圖數據結構已準備好，請導入圖表庫]
                    </div>
                </div>
            </div>


            {/* --- 銷售排行 --- */}
            <div className="grid grid-cols-2 gap-6">
                
                {/* 1. 熱門商品排行 */}
                <div className="bg-white p-6 rounded-lg shadow-xl">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">🏆 熱門商品排行 ({dateFilter ? '當日' : '總計'})</h3>
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名稱</th>
                                <th 
                                    className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                                    onClick={() => handleSort('quantity', itemSortKey, itemSortDirection, setItemSortKey, setItemSortDirection)}
                                >
                                    銷售量{renderSortArrow('quantity', itemSortKey, itemSortDirection)}
                                </th>
                                <th 
                                    className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                                    onClick={() => handleSort('revenue', itemSortKey, itemSortDirection, setItemSortKey, setItemSortDirection)}
                                >
                                    銷售額{renderSortArrow('revenue', itemSortKey, itemSortDirection)}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {sortedItemRank.slice(0, 10).map((item, index) => (
                                <tr key={item.name} className="hover:bg-blue-50/50">
                                    <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}. {item.name}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-blue-600 font-semibold">{item.quantity} 份</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-green-700 font-semibold">${formatCurrency(item.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* 2. 類別排行 */}
                <div className="bg-white p-6 rounded-lg shadow-xl">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">🔖 類別排行 ({dateFilter ? '當日' : '總計'})</h3>
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名稱</th>
                                <th 
                                    className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                                    onClick={() => handleSort('quantity', categorySortKey, categorySortDirection, setCategorySortKey, setCategorySortDirection)}
                                >
                                    銷售量{renderSortArrow('quantity', categorySortKey, categorySortDirection)}
                                </th>
                                <th 
                                    className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                                    onClick={() => handleSort('revenue', categorySortKey, categorySortDirection, setCategorySortKey, setCategorySortDirection)}
                                >
                                    銷售額{renderSortArrow('revenue', categorySortKey, categorySortDirection)}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {sortedCategoryRank.map((category, index) => (
                                <tr key={category.name} className="hover:bg-blue-50/50">
                                    <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}. {category.name}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-blue-600 font-semibold">{category.quantity} 份</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-sm text-green-700 font-semibold">${formatCurrency(category.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 歷史訂單列表 (保留，但降級為次要資訊) */}
            <div className="mt-8">
                <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">📜 歷史訂單詳情 ({dateFilter ? '當日' : '全部'})</h3>
                <div className="bg-white p-6 rounded-lg shadow-xl overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">單號</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">桌號/人數</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">項目與數量</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">總金額</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredOrders.map((order) => (
                                <tr key={order.id} className="hover:bg-gray-50 transition">
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {order.id}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {formatDate(order.timestamp || order.date)} 
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">
                                        {order.table} / {order.customerCount || 1} 人
                                    </td>
                                    <td className="px-4 py-4 text-sm text-gray-700">
                                        <ul className="list-disc list-inside space-y-0.5">
                                            {order.items.map((item, index) => (
                                                <li key={index} className="text-xs">
                                                    {item.name} x {item.quantity} (${formatCurrency(item.price)})
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-lg font-extrabold text-green-700">
                                        ${formatCurrency(order.total)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredOrders.length === 0 && (
                         <div className="text-center py-8 text-gray-500">
                            {dateFilter ? '所選日期沒有已結帳的訂單紀錄。' : '目前沒有任何已結帳的歷史訂單。'}
                         </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReportPage;
// src/pages/MenuManagement.js
import React, { useState, useEffect } from 'react'; 
import { getMenuItems, updateMenuItem, addMenuItem, deleteMenuItem } from '../db';

// ======================================================================
// ⭐️ 靜態資料定義 ⭐️
// ======================================================================

const CATEGORIES = ['主餐', '小點', '飲品', '冷凍包']; 

const ALL_INVENTORY_ITEMS = [
    // 庫存項目定義 (略)
    { id: 'rice_stock', name: '飯量庫存 (份)', category: '其他庫存' },
    { id: 'beef', name: '紅燒牛腩筋', category: '主食庫存' },
    { id: 'pork_ribs', name: '無錫排骨', category: '主食庫存' },
    { id: 'pork_shoulder', name: '松阪豬', category: '主食庫存' },
    { id: 'chicken_soup', name: '菜脯雞湯', category: '主食庫存' },
    { id: 'curry_chicken', name: '咖哩雞胸', category: '主食庫存' },
    { id: 'salted_pork', name: '鹹豬肉', category: '主食庫存' },
    { id: 'goulash', name: '匈牙利牛肉湯', category: '主食庫存' },
    { id: 'pig_balls', name: '小豬球', category: '點心庫存' },
    { id: 'fried_chicken', name: '炸雞', category: '點心庫存' },
];

const INVENTORY_GROUPS = ALL_INVENTORY_ITEMS.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
}, {});

// ======================================================================
// 輔助函式
// ======================================================================
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number);
    return roundedNumber.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const getCategoryStyles = (category) => {
    switch (category) {
        case '主餐': return 'bg-teal-50 text-teal-700 border-teal-200';
        case '小點': return 'bg-amber-50 text-amber-700 border-amber-200';
        case '飲品': return 'bg-lime-50 text-lime-700 border-lime-200';
        case '冷凍包': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
        default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
};

const deduplicateAndFormat = (items) => {
    const uniqueItemsMap = new Map();
    items.forEach(item => {
        const compositeKey = `${item.name}-${item.category}`; 
        
        if (!uniqueItemsMap.has(compositeKey)) {
             uniqueItemsMap.set(compositeKey, { 
                ...item, 
                imageUrl: item.imageUrl || '',
                price: item.price || 0,
                stock: item.stock || 0,
                consumes: item.consumes || [],
                sortOrder: item.sortOrder !== undefined ? Number(item.sortOrder) : Infinity, 
            });
        }
    });
    
    const uniqueItems = Array.from(uniqueItemsMap.values());
    uniqueItems.sort((a, b) => a.sortOrder - b.sortOrder); 
    
    return uniqueItems;
};

// ======================================================================
// 子元件：新增/編輯共用 Modal 邏輯 (保持不變)
// ======================================================================
const ItemModal = ({ item, onClose, onSave, isAdding = false }) => {
    const baseItem = { name: '', price: 0, category: CATEGORIES[0], imageUrl: '', stock: 0, consumes: [] };
    const initialData = isAdding ? baseItem : { 
        ...baseItem, 
        ...item, 
        price: item?.price || 0, 
        consumes: item?.consumes || [], 
        sortOrder: item?.sortOrder !== undefined ? item.sortOrder : Infinity
    };
    const [formData, setFormData] = useState(initialData);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ 
            ...prev, 
            [name]: name === 'price' || name === 'stock' ? Math.max(0, parseFloat(value) || 0) : value
        }));
    };
    
    const handleConsumeToggle = (inventoryId) => {
        setFormData(prev => {
            const currentConsumes = prev.consumes;
            if (currentConsumes.includes(inventoryId)) {
                return { ...prev, consumes: currentConsumes.filter(id => id !== inventoryId) };
            } else {
                return { ...prev, consumes: [...currentConsumes, inventoryId] };
            }
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name || formData.price <= 0) {
            alert('名稱與價格是必填且價格需大於零。');
            return;
        }
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
                
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700" title="關閉">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                
                <h3 className="text-3xl font-black mb-6 text-gray-800 border-b pb-3">
                    {isAdding ? '✨ 新增菜單項目' : `🛠 編輯菜單項目: ${item?.name || '項目'}`}
                </h3>
                
                <form onSubmit={handleSubmit}>
                    
                    {/* 菜單基本資訊 */}
                    <div className="mb-6 border p-5 rounded-xl bg-gray-50">
                        <h4 className="text-xl font-bold text-gray-700 mb-4 border-l-4 border-blue-400 pl-3">基本資訊</h4>
                        
                        <div className="mb-4 flex justify-center">
                            {formData.imageUrl ? (
                                <img src={formData.imageUrl} alt="預覽圖" className="h-24 w-24 object-cover rounded-full border-2 border-gray-300 shadow-md" onError={(e) => { e.target.style.opacity = 0; }} />
                            ) : (
                                <div className="h-24 w-24 bg-gray-200 rounded-full flex items-center justify-center text-sm text-gray-500">無圖片</div>
                            )}
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-base font-medium text-gray-700">圖片 URL</label>
                            <input type="text" name="imageUrl" value={formData.imageUrl} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base focus:ring-blue-500 focus:border-blue-500" />
                        </div>

                        <div className="mb-4">
                            <label className="block text-base font-medium text-gray-700">名稱</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base font-bold focus:ring-blue-500 focus:border-blue-500" required />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4"> 
                            <div className="mb-4">
                                <label className="block text-base font-medium text-gray-700">類別</label>
                                <select 
                                    name="category" 
                                    value={formData.category} 
                                    onChange={handleChange} 
                                    className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base focus:ring-blue-500 focus:border-blue-500 h-[52px]" 
                                >
                                    {CATEGORIES.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                                </select>
                            </div>

                            <div className="mb-4">
                                <label className="block text-base font-medium text-gray-700">價格 ($)</label>
                                <input 
                                    type="number" 
                                    name="price" 
                                    value={formData.price} 
                                    onChange={handleChange} 
                                    className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 text-base text-right font-black focus:ring-blue-500 focus:border-blue-500 h-[52px]" 
                                    min="1" 
                                    required 
                                />
                            </div>
                        </div>
                        
                        <input type="hidden" name="stock" value={formData.stock} />
                    </div>
                    
                    {/* 庫存連動設定 */}
                    <div className="mb-6 border p-5 rounded-xl bg-green-50">
                        <h4 className="text-xl font-bold text-gray-700 mb-4 border-l-4 border-green-500 pl-3">📦 庫存連動</h4>
                        <p className="text-sm text-gray-600 mb-3">勾選此菜單品項售出時，將會消耗的庫存原料項目。</p>
                        
                        <div className="space-y-4 max-h-72 overflow-y-auto pr-3">
                            {Object.entries(INVENTORY_GROUPS).map(([category, items]) => (
                                <div key={category} className="border border-green-200 p-3 rounded-lg bg-white shadow-sm">
                                    <p className="text-base font-black text-green-800 mb-2">{category}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {items.map(inventoryItem => (
                                            <label key={inventoryItem.id} className="flex items-center space-x-2 text-base cursor-pointer hover:bg-green-100 p-2 rounded-lg transition-colors">
                                                <input type="checkbox" checked={formData.consumes.includes(inventoryItem.id)} onChange={() => handleConsumeToggle(inventoryItem.id)} className="form-checkbox text-green-600 h-5 w-5 rounded focus:ring-green-500" />
                                                <span className={`${formData.consumes.includes(inventoryItem.id) ? 'font-bold text-green-700' : 'text-gray-800'}`}>{inventoryItem.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end space-x-4 pt-4 border-t">
                        <button type="button" onClick={onClose} className="px-6 py-3 text-base font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition duration-150">取消</button>
                        <button type="submit" className="px-6 py-3 text-base font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition duration-150 font-bold shadow-md">{isAdding ? '確認新增' : '儲存變更'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ======================================================================
// 主元件：菜單管理頁面
// ======================================================================
const MenuManagementPage = () => {
    
    const [menuItems, setMenuItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [editingItem, setEditingItem] = useState(null); 
    const [isAddingNew, setIsAddingNew] = useState(false);
    
    const [filterCategory, setFilterCategory] = useState(CATEGORIES[0]); 

    useEffect(() => {
        const loadMenuItems = async () => {
            setIsLoading(true);
            const items = await getMenuItems();
            
            const uniqueItems = deduplicateAndFormat(items);
            
            setMenuItems(uniqueItems); 
            setIsLoading(false);
        };
        loadMenuItems();
        
    }, []); 


    const handleAddItem = async (newItemData) => {
        const itemToSave = { 
            ...newItemData, 
            stock: 0, 
            consumes: newItemData.consumes || [],
            sortOrder: (menuItems.length + 1) * 10 
        };
        try {
            const addedItem = await addMenuItem(itemToSave);
            setMenuItems(prevItems => deduplicateAndFormat([...prevItems, addedItem]));
            
            setIsAddingNew(false);
            alert(`項目「${itemToSave.name}」已成功新增。`);
        } catch (error) {
            console.error('新增菜單項目失敗:', error);
            alert('新增失敗，請重試。');
        }
    };

    const handleSaveEdit = async (updatedData) => {
        const { id, consumes, stock, sortOrder, ...updates } = updatedData;
        const finalSortOrder = sortOrder !== undefined ? sortOrder : (menuItems.length + 1) * 10;

        try {
            await updateMenuItem(id, { ...updates, consumes, stock, sortOrder: finalSortOrder }); 
            
            setMenuItems(prevItems =>
                deduplicateAndFormat(prevItems.map(item => item.id === id ? { ...updatedData, sortOrder: finalSortOrder } : item))
            );
            
            setEditingItem(null);
            alert(`項目「${updatedData.name}」已成功更新。`);
        } catch (error) {
            console.error('更新菜單失敗:', error);
            alert('更新失敗，請檢查網路或數據庫連線。');
        }
    };

    const handleDelete = async (id, name) => {
        if (!window.confirm(`確定要永久刪除菜單項目「${name}」嗎？此操作無法復原。`)) {
            return;
        }

        try {
            await deleteMenuItem(id);
            setMenuItems(prevItems => prevItems.filter(item => item.id !== id));
            alert(`項目「${name}」已成功刪除。`);
        } catch (error) {
            console.error('刪除菜單項目失敗:', error);
            alert('刪除失敗，請重試。');
        }
    };
    
    const filteredItems = menuItems.filter(item => item.category === filterCategory);

    if (isLoading) {
        return <div className="p-8 text-center text-2xl text-gray-600">菜單資料載入中...</div>;
    }

    const filterTabs = CATEGORIES; 

    return (
        <div className="p-8 min-h-screen bg-gray-50">
            
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-4xl font-black text-gray-800">菜單管理</h2>
                
                <button
                    onClick={() => setIsAddingNew(true)}
                    className="bg-emerald-600 text-white px-5 py-3 rounded-lg hover:bg-emerald-700 transition duration-150 font-bold text-base shadow-md flex items-center space-x-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    <span>新增菜單項目</span>
                </button>
            </div>
            
            {/* 類別篩選 Tab 導航列 */}
            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setFilterCategory(tab)}
                            className={`
                                whitespace-nowrap py-3 px-1 border-b-4 text-lg font-medium transition-colors duration-150
                                ${tab === filterCategory
                                    ? 'border-blue-600 text-blue-600 font-black'
                                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                }
                            `}
                        >
                            {tab} ({menuItems.filter(i => i.category === tab).length})
                        </button>
                    ))}
                </nav>
            </div>


            {/* 菜單列表 */}
            <div className="bg-white p-6 rounded-xl shadow-xl overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider w-[10%]">圖片</th>
                            {/* 調整寬度 w-[30%] -> w-[25%] */}
                            <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider w-[25%]">名稱</th> 
                            <th className="px-3 py-2 text-center text-sm font-medium text-gray-500 uppercase tracking-wider w-[10%]">類別</th> 
                            <th className="px-3 py-2 text-right text-sm font-medium text-gray-500 uppercase tracking-wider w-[15%]">價格</th> 
                            <th className="px-3 py-2 w-[10%]"></th> 
                            <th className="px-3 py-2 text-center text-sm font-medium text-gray-500 uppercase tracking-wider w-[25%]">操作</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredItems.length > 0 ? (
                            filteredItems.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-3 whitespace-nowrap text-base text-gray-500">
                                        {item.imageUrl ? (
                                            <img src={item.imageUrl} alt={item.name} className="h-10 w-10 object-cover rounded shadow-sm" onError={(e) => { e.target.style.opacity = 0; }} />
                                        ) : (
                                            <div className="h-10 w-10 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs">圖</div> 
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-base font-semibold text-gray-900">{item.name}</td>
                                    
                                    <td className="px-3 py-3 whitespace-nowrap text-base text-center">
                                        <div className="flex justify-center"> 
                                            <span 
                                                className={`
                                                    px-3 py-1 inline-flex text-sm leading-5 font-semibold 
                                                    rounded-full border min-w-[75px] text-center justify-center
                                                    ${getCategoryStyles(item.category)}
                                                `}
                                            >
                                                {item.category}
                                            </span>
                                        </div>
                                    </td>
                                    
                                    <td className="px-3 py-3 whitespace-nowrap text-base text-gray-900 font-black text-right">
                                        NT$ {formatCurrency(item.price)}
                                    </td>
                                    
                                    <td className="px-3 py-3"></td> 

                                    <td className="px-3 py-3 whitespace-nowrap text-center text-base font-medium space-x-3">
                                        <button onClick={() => setEditingItem(item)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-full transition-colors" title="編輯項目">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-9-4l9-9m-4 4l-9 9" /></svg>
                                        </button>
                                        <button onClick={() => handleDelete(item.id, item.name)} className="text-red-600 hover:bg-red-100 p-2 rounded-full transition-colors" title="刪除項目">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="6" className="px-3 py-8 text-center text-lg text-gray-500">
                                    {`「${filterCategory}」類別中沒有任何項目。`}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal 渲染 (保持不變) */}
            {editingItem && (
                <ItemModal item={editingItem} onClose={() => setEditingItem(null)} onSave={handleSaveEdit} isAdding={false} />
            )}
            
            {isAddingNew && (
                <ItemModal item={null} onClose={() => setIsAddingNew(false)} onSave={handleAddItem} isAdding={true} />
            )}
        </div>
    );
};

export default MenuManagementPage;
import React from 'react';

// 輔助函式：金額格式化
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US'); 
};

// 輔助函式：判斷商品是否需追蹤庫存
const itemNeedsStockTracking = (item) => item.stock !== undefined && item.stock !== null;

/**
 * 菜單卡片元件 (修正版：完美適應 3:2 圖片比例)
 * 修正重點：
 * 1. 使用 aspect-[3/2] 確保任何裝置下比例不跑掉。
 * 2. 圖片改用 absolute 填滿容器，避免渲染誤差。
 * 3. 保持資訊區高度一致。
 */
const MenuCard = React.memo(({ item, onAddItem }) => {
    
    const needsStockManagement = itemNeedsStockTracking(item); 
    const currentStock = needsStockManagement ? (item.stock || 0) : Infinity; 
    const isOutOfStock = needsStockManagement && currentStock <= 0;

    return (
        <button 
            onClick={() => !isOutOfStock && onAddItem(item)}
            disabled={isOutOfStock}
            className={`
                w-full bg-white rounded-xl shadow-lg transition-all text-left flex flex-col overflow-hidden
                ${isOutOfStock 
                    ? 'opacity-60 cursor-not-allowed border-4 border-red-300' 
                    : 'hover:ring-4 hover:ring-blue-200 active:scale-[0.98] hover:shadow-xl'
                }
            `}
        >
            {/* 圖片區域： aspect-[3/2] 確保比例，移除固定 h-28 */}
            <div className="w-full aspect-[3/2] relative overflow-hidden bg-gray-100">
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.name}
                        // 使用 absolute inset-0 配合 aspect 比例最為精準
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        onError={(e) => { 
                            e.target.onerror = null; 
                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'; 
                            e.target.className += ' bg-gray-100'; 
                        }}
                    />
                ) : (
                    // 留白容器同樣保持 3:2
                    <div className="absolute inset-0 w-full h-full bg-gray-100"></div>
                )}
                
                {/* 庫存標籤 */}
                {needsStockManagement && (
                    <span className={`absolute top-1 right-1 px-2 py-0.5 rounded-full text-xs font-bold shadow-md z-10 ${
                        isOutOfStock ? 'bg-red-600 text-white' : 
                        currentStock < 5 ? 'bg-orange-500 text-white' : 'bg-green-500 text-white'
                    }`}>
                        {isOutOfStock ? '售罄' : `庫存: ${currentStock}`}
                    </span>
                )}
            </div>

            {/* 底部資訊區：保持高度固定以整齊排列 */}
            <div className="p-2 flex flex-col h-16 justify-center"> 
                {/* 菜名 */}
                <p 
                    className={`
                        text-l font-black leading-snug 
                        ${isOutOfStock ? 'text-gray-500' : 'text-gray-900'} 
                        truncate
                    `}
                    title={item.name} 
                >
                    {item.name}
                </p>
                
                {/* 價格區域 */}
                <div className="flex justify-between items-center mt-0.5"> 
                    <span className="text-sm font-extrabold text-blue-600">
                        NT$ {formatCurrency(item.price)}
                    </span>
                    {!isOutOfStock && (
                         <span className="text-blue-500 font-bold text-sm opacity-0"></span>
                    )}
                </div>
            </div>
        </button>
    );
});

export default MenuCard;
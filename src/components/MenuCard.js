import React from 'react';

// 輔助函式：金額格式化
const formatCurrency = (number) => {
    const roundedNumber = Math.round(number || 0);
    return roundedNumber.toLocaleString('en-US'); 
};

// 輔助函式：判斷商品是否需追蹤庫存
const itemNeedsStockTracking = (item) => item.stock !== undefined && item.stock !== null;

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
            {/* 圖片區域：保持 3:2 */}
            <div className="w-full aspect-[3/2] relative overflow-hidden bg-gray-100">
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        onError={(e) => { 
                            e.target.onerror = null; 
                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'; 
                            e.target.className += ' bg-gray-100'; 
                        }}
                    />
                ) : (
                    <div className="absolute inset-0 w-full h-full bg-gray-100"></div>
                )}
                
                {needsStockManagement && (
                    <span className={`absolute top-1 right-1 px-2 py-0.5 rounded-full text-xs font-bold shadow-md z-10 ${
                        isOutOfStock ? 'bg-red-600 text-white' : 
                        currentStock < 5 ? 'bg-orange-500 text-white' : 'bg-green-500 text-white'
                    }`}>
                        {isOutOfStock ? '售罄' : `庫存: ${currentStock}`}
                    </span>
                )}
            </div>

            {/* 底部資訊區：稍微加大高度從 h-16 -> h-27，並增加內距 */}
            <div className="p-1.5 flex flex-col h-25 justify-center"> 
                <div className="relative w-full mb-1"> {/* 改為 relative 以便內部 absolute 定位 */}
                    
                    {/* 編號標籤：改用 absolute 定位 */}
                    {item.category === '主餐' && item.sortOrder && (
                        <div className="
                            absolute left-0 top-0.5
                            flex items-center justify-center 
                            w-6 h-6 
                            bg-black rounded-md 
                            z-10
                        ">
                            <span className="text-white font-bold text-[12px] leading-none">
                                {Number(item.sortOrder)}
                            </span>
                        </div>
                    )}
                    
                    {/* 菜名：使用 indent 讓第一行空出編號的位置 */}
                    <p 
                        className={`
                            text-[23px] font-black leading-tight
                            ${isOutOfStock ? 'text-gray-500' : 'text-gray-900'} 
                            line-clamp-2 break-words
                        `}
                        style={{ 
                            // 24px (方塊寬度) + 4px (間距) = 28px
                            textIndent: item.category === '主餐' && item.sortOrder ? '28px' : '0px' 
                        }}
                    >
                        {item.name}
                    </p>
                </div>
                                
                                <div className="flex justify-between items-center"> 
                                    <span className="text-base font-extrabold text-blue-600">
                                        NT$ {formatCurrency(item.price)}
                                    </span>
                                </div>
                            </div>
                        </button>
                    );
                });


export default MenuCard;
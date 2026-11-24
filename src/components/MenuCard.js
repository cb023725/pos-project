import React, { useRef } from 'react';

const formatCurrency = (n) => Math.round(n || 0).toLocaleString('en-US');

const LONG_PRESS_MS = 600;

// 外部 CDN 圖片（如 mcusercontent.com）原圖動輒 1-2MB，縮圖顯示用，走伺服器端代理縮小快取；
// 本機 /images/... 的靜態圖本來就小、同源，不需要代理
const toDisplaySrc = (url) => (/^https?:\/\//.test(url) ? `/api/image-proxy?url=${encodeURIComponent(url)}&w=300` : url);

// allowOverride：停售時外觀仍顯示鎖住樣式，但點擊還是會呼叫 onAddItem，交給呼叫端自己決定
// 要不要跳確認視窗後放行（例如年菜訂購允許「確認後仍要加入已停售品項」）。
// 預設 false，一般點餐頁維持原本「停售就完全點不動」的行為不變。
// hideStock：不顯示右上角庫存數量（年菜點單頁用，年菜不扣庫存，數量只會造成誤解）。
// fillHeight：卡片撐滿格子高度（搭配 grid auto-rows-fr，所有卡片取最高那張的高度、大小一致）。
const MenuCard = React.memo(({ item, onAddItem, onLongPress, allowOverride = false, hideStock = false, fillHeight = false }) => {
    const hasInventoryLink = !!(item.consumes?.length); // 有庫存連動才顯示售完/庫存數
    const isSoldOut  = !!item.soldOut;
    const isDepleted = hasInventoryLink && !!item.depleted; // 只有連動品項才有售完狀態
    const isDisabled = isSoldOut;                           // 停售才完全鎖住（視覺樣式用，allowOverride 不影響外觀）

    // 右上角庫存數量：有連動、有數值、且尚未售完時顯示
    const showStockBadge = !hideStock && hasInventoryLink && item.linkedStock != null && !isDepleted;
    const linkedStock    = item.linkedStock ?? 0;

    const timerRef       = useRef(null);
    const didLongPress   = useRef(false);

    const startPress = () => {
        didLongPress.current = false;
        timerRef.current = setTimeout(() => {
            didLongPress.current = true;
            onLongPress && onLongPress(item);
        }, LONG_PRESS_MS);
    };

    const cancelPress = () => clearTimeout(timerRef.current);

    const handleClick = () => {
        if (didLongPress.current) return;
        if (isDisabled && !allowOverride) return;
        onAddItem(item);
    };

    return (
        <button
            onClick={handleClick}
            onMouseDown={startPress}
            onMouseUp={cancelPress}
            onMouseLeave={cancelPress}
            onTouchStart={startPress}
            onTouchEnd={cancelPress}
            onContextMenu={e => e.preventDefault()}
            className={`
                w-full ${fillHeight ? 'h-full' : ''} bg-white rounded-xl shadow-lg transition-all text-left flex flex-col overflow-hidden relative select-none
                ${isDisabled
                    ? 'opacity-60 cursor-not-allowed ring-4 ring-inset ring-red-300'
                    : isDepleted
                        ? 'ring-4 ring-inset ring-orange-300 hover:ring-orange-200 active:scale-[0.98] hover:shadow-xl'
                        : 'hover:ring-4 hover:ring-inset hover:ring-blue-200 active:scale-[0.98] hover:shadow-xl'
                }
            `}
        >
            {/* 停售 overlay */}
            {isSoldOut && (
                <div className="absolute inset-0 bg-black/55 flex items-center justify-center z-20 rounded-xl pointer-events-none">
                    <span className="bg-red-600 text-white text-xl font-black px-4 py-2 rounded-xl shadow-lg tracking-widest">
                        停售
                    </span>
                </div>
            )}

            {/* 售完 overlay（橙色置中，參考停售樣式） */}
            {isDepleted && !isSoldOut && (
                <div className="absolute inset-0 bg-orange-500/40 flex items-center justify-center z-20 rounded-xl pointer-events-none">
                    <span className="bg-orange-500 text-white text-xl font-black px-4 py-2 rounded-xl shadow-lg tracking-widest">
                        售完
                    </span>
                </div>
            )}

            {/* 圖片區域：3:2 */}
            <div className="w-full aspect-[3/2] relative overflow-hidden bg-gray-100">
                {item.imageUrl ? (
                    <img
                        src={toDisplaySrc(item.imageUrl)}
                        alt={item.name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';
                        }}
                    />
                ) : (
                    <div className="absolute inset-0 w-full h-full bg-gray-100" />
                )}

                {/* 右上角庫存數量（僅有庫存連動且未售完時顯示） */}
                {showStockBadge && (
                    <span className={`absolute top-1 right-1 px-2 py-0.5 rounded-full text-xs font-bold shadow-md z-10 ${
                        linkedStock < 5 ? 'bg-orange-500 text-white' : 'bg-green-700 text-white'
                    }`}>
                        庫存：{linkedStock}
                    </span>
                )}
            </div>

            {/* 底部資訊 */}
            <div className={`py-1 px-0.5 flex flex-col ${fillHeight ? 'flex-grow justify-between' : 'h-25 justify-center'}`}>
                <div className="relative w-full mb-1">
                    {item.category === '主餐' && item.sortOrder && (
                        <div className="absolute left-0 top-0.5 flex items-center justify-center w-5 h-5 bg-black rounded-md z-10">
                            <span className="text-white font-bold text-[12px] leading-none">{Number(item.sortOrder)}</span>
                        </div>
                    )}
                    <p
                        className={`text-[22px] font-black leading-tight line-clamp-2 break-words ${isDisabled ? 'text-gray-500' : 'text-gray-900'}`}
                        style={{ textIndent: item.category === '主餐' && item.sortOrder ? '22px' : '0px' }}
                    >
                        {item.name}
                    </p>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-xl font-extrabold text-blue-600">NT$ {formatCurrency(item.price)}</span>
                </div>
            </div>
        </button>
    );
});

export default MenuCard;

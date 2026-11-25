/**
 * 綁在年度試算表上的「📧 年菜寄信」選單（由 gas/tools/setup_sheet_menu.sh 建立）
 * 實際的寄信程式在「年菜系統」專案（程式庫 NianfaiLib，HEAD 開發模式，會跟著年菜系統更新），
 * 與 WebPOS 寄信共用同一份寄信狀態，兩邊寄過的都不會重寄。
 */
function onOpen() { NianfaiLib.nfMenu(); }
function nfMenuPreShip() { NianfaiLib.nfMenuSend('preShip'); }
function nfMenuShipped() { NianfaiLib.nfMenuSend('shipped'); }
function nfMenuPickup() { NianfaiLib.nfMenuSend('pickupReminder'); }
function nfMenuSync() { NianfaiLib.nfMenuSync(); }

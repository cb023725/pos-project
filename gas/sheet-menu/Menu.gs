/**
 * 綁在年度試算表上的「📧 年菜寄信」選單
 * 選單本身在這裡建立（打開試算表時的權限很受限，不經過程式庫）；點選單後才呼叫「年菜系統」程式庫
 * （NianfaiLib，HEAD 開發模式，跟著年菜系統更新）寄信，與 WebPOS 共用同一份寄信狀態，兩邊寄過的不會重寄。
 * 第一次點選單時 Google 會要求授權一次。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📧 年菜寄信')
    .addItem('寄出前確認（宅配）', 'nfMenuPreShip')
    .addItem('出貨通知（宅配）', 'nfMenuShipped')
    .addItem('取貨提醒（自取）', 'nfMenuPickup')
    .addSeparator()
    .addItem('重新整理宅配／自取', 'nfMenuSync')
    .addToUi();
}
function nfMenuPreShip() { NianfaiLib.nfMenuSend('preShip'); }
function nfMenuShipped() { NianfaiLib.nfMenuSend('shipped'); }
function nfMenuPickup() { NianfaiLib.nfMenuSend('pickupReminder'); }
function nfMenuSync() { NianfaiLib.nfMenuSync(); }

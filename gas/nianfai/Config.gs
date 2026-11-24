/**
 * 咕咕義年菜 GAS — 共用設定（綁在當年度的「年菜訂單」試算表上）
 *
 * 一年一個試算表檔案，表單與這支 GAS 跟著檔案一起複製。
 * WebPOS 密鑰存在「指令碼屬性」WEBPOS_SECRET（選單「年菜工具 → 設定 WebPOS 密鑰」），不寫在程式裡。
 */
var NF = {
  SHEET_RESPONSES: '表單回應',
  SHEET_SETTINGS: '設定',
  STORE_EMAIL: 'goodgoodeatrestaurant@gmail.com',
  SENDER_NAME: '咕咕義小餐館',
  ONSITE_PREFIX: '現結',          // 匯款末五碼以「現結」開頭 = WebPOS 現場單
  STATUS_HEADER: '寄信狀態',       // GAS 寫在「表單回應」最右側的欄位
  TZ: 'Asia/Taipei',
  TIMESTAMP_FORMAT: 'yyyy/MM/dd HH:mm:ss', // 與 Sheet 顯示一致，確認信、取貨提醒都用這個格式
};

function nfSecret_() {
  return PropertiesService.getScriptProperties().getProperty('WEBPOS_SECRET') || '';
}

function nfSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function nfForm_() {
  var url = nfSpreadsheet_().getFormUrl();
  if (!url) throw new Error('這個試算表沒有連結表單');
  return FormApp.openByUrl(url);
}

function nfSheet_(name) {
  var sh = nfSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁「' + name + '」');
  return sh;
}

function nfFormatTimestamp_(d) {
  if (!(d instanceof Date)) return String(d || '');
  return Utilities.formatDate(d, NF.TZ, NF.TIMESTAMP_FORMAT);
}

function nfMoney_(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// '2027-01-29' → '2027/1/29 (五)'（表單取貨日選項的格式）
function nfFormDateLabel_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  var wd = '日一二三四五六'.charAt(d.getUTCDay());
  return +m[1] + '/' + (+m[2]) + '/' + (+m[3]) + ' (' + wd + ')';
}

// 從表單選項或 Sheet 儲存格解析日期 → 'YYYY-MM-DD'（比對用）
function nfIsoDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, NF.TZ, 'yyyy-MM-dd');
  var m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(v || ''));
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function nfJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 咕咕義年菜系統 GAS — 共用設定與年度切換
 *
 * 這是一支「獨立」的 Apps Script 專案（不綁在任何試算表上），只需要部署、授權一次。
 * WebPOS 年菜管理頁按「建立 Google 試算表與表單」時，由這支 GAS 建立當年度的試算表、表單、
 * 各分頁、保護範圍與觸發條件（FormBuild.gs），之後所有操作都依「環境＋年度」打開對應的檔案。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   WEBPOS_SECRET        與 WebPOS .env 的 NIANFAI_GAS_SECRET 相同（Yw 手動新增）
 *   YEAR_<env>:<year>    每個年度的檔案資訊（程式自動寫入）：
 *                        { ssId, formId, folderId, ids: { 表單題目 ID 對應 }, gridRows: [品名…] }
 * env 由 WebPOS 傳入（dev／prod），測試與正式的年度檔案分開記錄、放在不同資料夾。
 */
var NF = {
  SHEET_RESPONSES: '表單回應',
  SHEET_SETTINGS: '設定',
  SHEET_DELIVERY: '宅配',          // GAS 寫入（OrderSheets.gs）
  SHEET_PICKUP: '自取',
  SHEET_LOOKUP: '查詢',
  SHEET_STATS: '統計',
  SHEET_PREP: '備料表',
  SHEET_LOG: '修改紀錄',
  STORE_EMAIL: 'goodgoodeatrestaurant@gmail.com',
  SENDER_NAME: '咕咕義小餐館',
  ONSITE_PREFIX: '現結',          // 匯款末五碼以「現結」開頭 = WebPOS 現場單
  STATUS_HEADER: '寄信狀態',       // GAS 寫在「表單回應」最右側
  EDITED_HEADER: '已修改',          // 手動改過「表單回應」的列打勾
  GRID_TITLE: '單點年菜',
  TZ: 'Asia/Taipei',
  TIMESTAMP_FORMAT: 'yyyy/MM/dd HH:mm:ss', // 與 Sheet 顯示一致，確認信、取貨提醒都用這個格式
};

var NF_CTX = null; // 目前處理中的年度：{ key, env, year, meta, ss, form }

function nfProps_() {
  return PropertiesService.getScriptProperties();
}

function nfSecret_() {
  return nfProps_().getProperty('WEBPOS_SECRET') || '';
}

function nfYearKey_(env, year) {
  return 'YEAR_' + (env || 'prod') + ':' + year;
}

function nfSaveMeta_(env, year, meta) {
  nfProps_().setProperty(nfYearKey_(env, year), JSON.stringify(meta));
}

/** 依環境＋年度切換到該年度的試算表與表單 */
function nfUseYear_(env, year) {
  if (!year) throw new Error('缺少年度');
  var key = nfYearKey_(env, year);
  var raw = nfProps_().getProperty(key);
  if (!raw) throw new Error(year + ' 年的 Google 試算表與表單尚未建立（請到 WebPOS 年菜管理頁建立）');
  var meta = JSON.parse(raw);
  NF_CTX = {
    key: key, env: env, year: String(year), meta: meta,
    ss: SpreadsheetApp.openById(meta.ssId),
    form: FormApp.openById(meta.formId),
  };
  return NF_CTX;
}

/** 觸發條件（提交表單時、編輯時）用：依事件的試算表找出是哪一個年度 */
function nfUseSpreadsheet_(ss) {
  var id = ss.getId();
  var all = nfProps_().getProperties();
  for (var k in all) {
    if (k.indexOf('YEAR_') !== 0) continue;
    var meta = JSON.parse(all[k]);
    if (meta.ssId === id) {
      var envYear = k.slice(5).split(':');
      NF_CTX = { key: k, env: envYear[0], year: envYear[1], meta: meta, ss: ss, form: FormApp.openById(meta.formId) };
      return NF_CTX;
    }
  }
  throw new Error('這份試算表不是由年菜系統建立的');
}

function nfSpreadsheet_() {
  if (!NF_CTX) throw new Error('尚未指定年度');
  return NF_CTX.ss;
}

function nfForm_() {
  if (!NF_CTX) throw new Error('尚未指定年度');
  return NF_CTX.form;
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

// '2027-01-29' → '2027/1/29 (五)'（表單取貨日選項、說明文字的格式）
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

// 欄號（1-based）→ 欄位字母
function nfColLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * 第一次部署前在 Apps Script 編輯器手動執行一次，完成所有權限授權
 * （雲端硬碟、試算表、表單、寄信、觸發條件）。不會建立或修改任何檔案。
 */
function nfAuthorize() {
  // Apps Script 會依整個專案用到的服務一次要求所有權限，執行任何一個函式就會跳出授權畫面
  console.log('雲端硬碟：' + DriveApp.getRootFolder().getName());
  console.log('授權完成。接著到「專案設定 → 指令碼屬性」新增 WEBPOS_SECRET，然後部署網頁應用程式。');
}

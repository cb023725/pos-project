/**
 * 保護範圍與匯款資訊異動通知
 *
 *   「設定」匯款戶名／銀行／分行／帳號  鎖定：只有擁有者能改（其他協作者改不了）
 *   「表單回應」整個分頁               修改前跳警告（Yw 仍要手動改數量、取消訂單，不能完全鎖死，
 *                                      但不會在不知情的情況下手滑改到）
 *   「設定」品項表（D～K 欄）           修改前跳警告（品項應由 WebPOS 同步）
 *   「訂單整理」整個分頁                修改前跳警告，只開放手動欄（付款、取貨、出貨日、託運單號）的資料列；
 *                                      公式欄被改到會由編輯觸發自動還原（擁有者無法被 Google 鎖住，所以補這一層），
 *                                      訂單內容只能從「表單回應」改，並留下修改紀錄
 *
 * 表單送出、GAS 自己寫入（寄信狀態、WebPOS 同步）不受保護範圍影響。
 * 建立年度時執行，之後可從 WebPOS 年菜管理頁「重新套用保護範圍」；只移除／重建說明以「年菜：」
 * 開頭的保護，Yw 自己另外加的保護不會動。
 *
 * 可安裝的「編輯時」觸發（建立年度時安裝，只有人手動編輯才會觸發，表單送出與 GAS 寫入不會）：
 *   - 「設定」匯款資訊被修改 → 寄信通知店家信箱
 *   - 「表單回應」被手動修改 → 格子上色＋備註原值與時間、該列「已修改」打勾、寫入「修改紀錄」
 *     （「訂單整理」整列淺色標示；原因由 Yw 補填，沒填的列標紅）
 */
var NF_PROTECT_PREFIX = '年菜：';
var NF_BANK_KEY_PREFIX = '匯款';

function nfApplyProtections_() {
  var ss = nfSpreadsheet_();
  [SpreadsheetApp.ProtectionType.RANGE, SpreadsheetApp.ProtectionType.SHEET].forEach(function (type) {
    ss.getProtections(type).forEach(function (p) {
      if (String(p.getDescription() || '').indexOf(NF_PROTECT_PREFIX) === 0) p.remove();
    });
  });

  // 表單回應：修改前跳警告
  nfSheet_(NF.SHEET_RESPONSES).protect()
    .setDescription(NF_PROTECT_PREFIX + '表單回應（修改前確認）')
    .setWarningOnly(true);

  var st = nfEnsureSettingsSheet_();
  // 設定品項表：修改前跳警告
  st.getRange(1, NF_SETTINGS_ITEM_COL, st.getMaxRows(), NF_SETTINGS_ITEM_HEADERS.length).protect()
    .setDescription(NF_PROTECT_PREFIX + '設定品項表（請由 WebPOS 同步）')
    .setWarningOnly(true);

  // 訂單整理：整個分頁跳警告，手動欄的資料列除外
  var orders = nfSpreadsheet_().getSheetByName(NF.SHEET_ORDERS);
  if (orders) {
    var L = nfOrdersLayoutForCurrent_();
    var p0 = orders.protect().setDescription(NF_PROTECT_PREFIX + '訂單整理（公式欄請到表單回應修改）').setWarningOnly(true);
    var open = [];
    L.colDefs.forEach(function (c, i) { if (c.manual) open.push(orders.getRange(L.first, i + 1, NF_DATA_ROWS, 1)); });
    p0.setUnprotectedRanges(open);
  }

  // 匯款資訊：只有擁有者能改
  var me = Session.getEffectiveUser();
  var rows = nfBankRows_(st);
  rows.forEach(function (r) {
    var p = st.getRange(r, 1, 1, 2).protect().setDescription(NF_PROTECT_PREFIX + '匯款資訊（只有擁有者能改）');
    p.addEditor(me);
    p.removeEditors(p.getEditors()); // 擁有者不會被移除
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  return { bankRows: rows.length };
}

function nfBankRows_(st) {
  var last = Math.max(st.getLastRow(), 1);
  var rows = [];
  st.getRange(1, 1, last, 1).getValues().forEach(function (r, i) {
    if (String(r[0]).trim().indexOf(NF_BANK_KEY_PREFIX) === 0) rows.push(i + 1);
  });
  return rows;
}

function nfOnEdit(e) {
  if (!e || !e.range) return;
  nfUseSpreadsheet_(e.source || e.range.getSheet().getParent());
  var name = e.range.getSheet().getName();
  if (name === NF.SHEET_SETTINGS) nfNotifyBankEdit_(e);
  else if (name === NF.SHEET_RESPONSES) nfLogResponseEdit_(e);
  else if (name === NF.SHEET_ORDERS) nfRevertOrdersEdit_(e);
}

/** 「設定」的匯款資訊被修改就寄信通知 */
function nfNotifyBankEdit_(e) {
  var sh = e.range.getSheet();
  if (e.range.getColumn() > 2) return;
  var r0 = e.range.getRow();
  var n = e.range.getNumRows();
  var lines = [];
  for (var r = r0; r < r0 + n; r++) {
    var key = String(sh.getRange(r, 1).getValue()).trim();
    if (key.indexOf(NF_BANK_KEY_PREFIX) !== 0) continue;
    var now = sh.getRange(r, 2).getDisplayValue();
    var old = (n === 1 && e.oldValue !== undefined) ? String(e.oldValue) : '（多格同時修改，無法取得原值）';
    lines.push('・' + key + '：' + old + ' → ' + now);
  }
  if (!lines.length) return;
  var who = '';
  try { who = (e.user && e.user.getEmail()) || ''; } catch (err) { who = ''; }
  MailApp.sendEmail({
    to: NF.STORE_EMAIL,
    subject: '【年菜】確認信的匯款資訊被修改了',
    body: '「' + nfSpreadsheet_().getName() + '」的「設定」分頁匯款資訊有變動：\n\n' + lines.join('\n') +
      '\n\n修改時間：' + nfFormatTimestamp_(new Date()) + '\n修改者：' + (who || '（無法取得，可能是協作者）') +
      '\n\n之後寄出的確認信都會使用新的匯款資訊。如果不是你改的，請立即改回並檢查試算表的共用設定。',
    name: NF.SENDER_NAME,
  });
}

/** 手動修改「表單回應」：標示格子、備註原值、該列「已修改」打勾、寫入修改紀錄 */
function nfLogResponseEdit_(e) {
  var sh = e.range.getSheet();
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var statusIdx = headers.indexOf(NF.STATUS_HEADER);
  var editedCol = nfEnsureEditedColumn_(sh);
  var r0 = e.range.getRow();
  var c0 = e.range.getColumn();
  var nRows = e.range.getNumRows();
  var nCols = e.range.getNumColumns();
  if (r0 + nRows - 1 < 2) return; // 只改到標題列
  var settings = nfReadSettings_();
  var cols = nfMapColumns_(headers, settings);
  var now = nfFormatTimestamp_(new Date());
  var single = nRows === 1 && nCols === 1;
  var logRows = [];
  var formLastCol = Math.min.apply(null, [statusIdx >= 0 ? statusIdx : lastCol, editedCol - 1].filter(function (x) { return x > 0; }));
  var cleared = [];
  for (var r = Math.max(r0, 2); r < r0 + nRows && logRows.length < 200; r++) {
    var rowVals = sh.getRange(r, 1, 1, lastCol).getValues()[0];
    // 整列表單欄位都是空的＝清除整列（取消訂單）或改到空白列：不上色、不打勾，保持空白列，只記一行
    var formVals = rowVals.slice(0, formLastCol);
    if (formVals.every(function (v) { return v === '' || v === null; })) {
      if (!single || (e.oldValue !== undefined && e.oldValue !== '')) cleared.push(r);
      if (editedCol) sh.getRange(r, editedCol).clearContent();
      continue;
    }
    var orderLabel = nfFormatTimestamp_(rowVals[0]) + ' ' + (cols.name !== undefined ? rowVals[cols.name] : '');
    var touched = false;
    for (var c = c0; c < c0 + nCols; c++) {
      if (c === editedCol || c - 1 === statusIdx) continue; // GAS 自己的欄位不記錄
      var cellRange = sh.getRange(r, c);
      var newVal = cellRange.getDisplayValue();
      var oldVal = single ? (e.oldValue === undefined ? '' : String(e.oldValue)) : '（多格同時修改，原值請查看「檔案 → 版本記錄」）';
      cellRange.setBackground('#fff2cc');
      var note = cellRange.getNote();
      cellRange.setNote((note ? note + '\n' : '') + now + ' 修改，原值：' + (single ? oldVal : '（多格修改）'));
      logRows.push([now, orderLabel.trim(), String(headers[c - 1] || ''), oldVal, newVal, '']);
      touched = true;
    }
    if (touched) sh.getRange(r, editedCol).setValue(true);
  }
  if (cleared.length) {
    var span = cleared.length === 1 ? '第 ' + cleared[0] + ' 列' : '第 ' + cleared[0] + '～' + cleared[cleared.length - 1] + ' 列';
    logRows.push([now, span, '（整列清除）', '', '', '']);
  }
  if (logRows.length) {
    var log = nfSheet_(NF.SHEET_LOG);
    log.getRange(log.getLastRow() + 1, 1, logRows.length, 6).setValues(logRows);
  }
}

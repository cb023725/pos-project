/**
 * 試算表上的「📧 年菜寄信」選單（WebPOS「寄信」的備用方式）
 *
 * Google 只允許「綁在試算表裡」的程式加選單，所以每年建立試算表後，在該試算表
 * 「擴充功能 → Apps Script」貼一小段程式，並把這個專案加為程式庫（識別碼 NianfaiLib、版本選 HEAD 開發模式），
 * 選單的動作都呼叫這裡（與 WebPOS 共用同一套寄信程式與寄信狀態，兩邊寄過的都不會重寄）。
 * 要貼的程式見 README「試算表寄信選單」。
 *
 * 用法：在「宅配」或「自取」選取要寄的列（可以多選、跳著選）→ 選單選信件種類 → 確認視窗列出
 * 會寄給誰、誰不寄與原因 → 按「是」才寄 → 寄完顯示結果，狀態寫回工作表。
 */
function nfMenu() {
  SpreadsheetApp.getUi().createMenu('📧 年菜寄信')
    .addItem('寄出前確認（宅配）', 'nfMenuPreShip')
    .addItem('出貨通知（宅配）', 'nfMenuShipped')
    .addItem('取貨提醒（自取）', 'nfMenuPickup')
    .addSeparator()
    .addItem('重新整理宅配／自取', 'nfMenuSync')
    .addToUi();
}

function nfMenuSync() {
  nfUseSpreadsheet_(SpreadsheetApp.getActiveSpreadsheet());
  var r = nfSyncOrderSheets_();
  SpreadsheetApp.getActiveSpreadsheet().toast('宅配 ' + r.delivery + ' 筆、自取 ' + r.pickup + ' 筆', '已重新整理', 5);
}

function nfMenuSend(type) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  nfUseSpreadsheet_(ss);
  var T = NF_MAIL_TYPES[type];
  var sheetName = nfOrderSheetName_(T.kind);
  var sh = ss.getActiveSheet();
  if (sh.getName() !== sheetName) {
    ui.alert(T.label, '請先到「' + sheetName + '」分頁，選取要寄的訂單（可以多選）。', ui.ButtonSet.OK);
    return;
  }
  var ids = [];
  var idCol = nfColIndex_(nfOrderCols_(T.kind, nfReadSettings_()), 'id');
  sh.getActiveRangeList().getRanges().forEach(function (rg) {
    var r0 = Math.max(rg.getRow(), 2), r1 = rg.getRow() + rg.getNumRows() - 1;
    if (r1 < r0) return;
    sh.getRange(r0, idCol, r1 - r0 + 1, 1).getValues().forEach(function (v) { if (v[0] && ids.indexOf(String(v[0])) < 0) ids.push(String(v[0])); });
  });
  if (!ids.length) {
    ui.alert(T.label, '請先選取要寄的訂單列（點列號可以選整列，按住 ⌘ 可以多選）。', ui.ButtonSet.OK);
    return;
  }
  var plan = nfMailPlan_(type, null, ids);
  var ok = plan.list.filter(function (x) { return !x.reason; });
  var skip = plan.list.filter(function (x) { return x.reason; });
  var lines = [];
  if (ok.length) lines.push('會寄給 ' + ok.length + ' 位：\n' + ok.map(function (x) { return '・' + x.name + '（' + x.email + '）'; }).join('\n'));
  if (skip.length) lines.push('不寄 ' + skip.length + ' 位：\n' + skip.map(function (x) { return '・' + x.name + '：' + x.reason; }).join('\n'));
  var quota = nfMailQuota_();
  if (quota !== null) lines.push('今天 Gmail 還能寄 ' + quota + ' 封。');
  if (!ok.length) {
    ui.alert(T.label + '：沒有可以寄的', lines.join('\n\n'), ui.ButtonSet.OK);
    return;
  }
  if (ui.alert('寄出「' + T.label + '」？', lines.join('\n\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var res = nfMailSend_(type, ok.map(function (x) { return x.id; }), null, {});
  var out = ['已寄出 ' + res.sent.length + ' 封。'];
  if (res.failed.length) out.push('寄送失敗：\n' + res.failed.map(function (x) { return '・' + x.name + '：' + x.error; }).join('\n'));
  if (res.overQuota.length) out.push('今天額度用完，明天再寄：' + res.overQuota.map(function (x) { return x.name; }).join('、'));
  ui.alert(T.label, out.join('\n\n'), ui.ButtonSet.OK);
}

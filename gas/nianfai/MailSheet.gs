/**
 * 試算表「寄信」分頁：不靠選單（自訂選單在多帳號登入、iPad／手機 App 都可能不出現），全部用勾選完成
 *
 *   B3 信件種類（寄出前確認／出貨通知／取貨提醒）、B4 取貨日（取貨提醒用）→ 下方自動列出客人與狀態，可寄的預設打勾
 *   B5 ① 準備寄出 → C5 顯示將寄給誰（2 分鐘內有效）
 *   B6 ② 確定寄出 → 寄出、結果寫在 C6，名單重新整理
 *   D3 重新整理
 * 由可安裝的「編輯時」觸發執行（以擁有者身分），與 WebPOS 寄信、Sheet 狀態共用同一份寄信紀錄，不會重寄。
 */
var NF_MAIL_SHEET = { typeCell: 'B3', dateCell: 'B4', prepareCell: 'B5', confirmCell: 'B6', refreshCell: 'D3', msgPrepare: 'C5', msgResult: 'C6', head: 8, first: 9 };
var NF_MAIL_TYPE_BY_LABEL = { '寄出前確認': 'preShip', '出貨通知': 'shipped', '取貨提醒': 'pickupReminder' };
var NF_MAIL_STATUS_TEXT = { ready: '可寄', failed: '寄送失敗', sent: '已寄出', opened: '已開信', acked: '已確認', skip: '不寄' };

function nfBuildMailSheet_(ss, s) {
  var sh = nfGetOrCreateSheet_(ss, NF.SHEET_MAIL);
  var C = NF_MAIL_SHEET;
  sh.getRange(1, 1, 300, 8).setFontSize(11).setFontFamily('Arial').setVerticalAlignment('middle').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.setRowHeights(1, 300, 30);
  sh.setRowHeight(1, 40);
  sh.getRange('A1').setValue('📧 寄信').setFontSize(16).setFontWeight('bold');
  sh.getRange(C.first, 1, 300, 1).setHorizontalAlignment('center');
  sh.getRange('B1').setValue('選信件種類 → 勾選要寄的客人 → ① 準備寄出 → ② 確定寄出。和 WebPOS 寄信共用紀錄；已寄過的預設不勾，要補寄再勾選。').setFontColor('#6b7280').setFontSize(10).setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  var labels = [['信件種類'], ['取貨日（取貨提醒用）'], ['① 準備寄出'], ['② 確定寄出']];
  sh.getRange(3, 1, 4, 1).setValues(labels).setFontWeight('bold').setHorizontalAlignment('right');
  var input = function (a1) { return sh.getRange(a1).setBackground('#fef3c7').setFontWeight('bold').setHorizontalAlignment('center'); };
  input(C.typeCell).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(NF_MAIL_TYPE_BY_LABEL), true).setAllowInvalid(false).build()).setValue('寄出前確認');
  var dateLabels = s.pickupDates.map(nfFormDateLabel_);
  input(C.dateCell).setDataValidation(dateLabels.length ? SpreadsheetApp.newDataValidation().requireValueInList(dateLabels, true).build() : null)
    .setValue(dateLabels.length ? dateLabels[0] : '');
  var check = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  [C.prepareCell, C.confirmCell, C.refreshCell].forEach(function (a1) { input(a1).setDataValidation(check).setValue(false); });
  sh.getRange('E3').setValue('← 重新整理名單').setFontColor('#6b7280').setFontSize(10);
  sh.getRange(C.msgPrepare + ':H5').merge().setFontColor('#92400e').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(C.msgResult + ':H6').merge().setFontColor('#166534').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  var head = ['寄', '訂購人', '電話', 'e-mail', '狀態', '時間', '說明', '訂單編號'];
  nfStyleHead_(sh.getRange(C.head, 1, 1, head.length).setValues([head]));
  [[1, 150], [2, 140], [3, 150], [4, 230], [5, 110], [6, 120], [7, 260], [8, 160]].forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  sh.setFrozenRows(C.head);
  sh.setHiddenGridlines(true);
  var st = sh.getRange(C.first, 5, 300, 1);
  var rule = function (t, bg, fg) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(t).setBackground(bg).setFontColor(fg).setRanges([st]).build(); };
  sh.setConditionalFormatRules([rule('可寄', '#dbeafe', '#1e40af'), rule('寄送失敗', '#fee2e2', '#b91c1c'), rule('已寄出', '#e0f2fe', '#075985'),
    rule('已開信', '#ede9fe', '#5b21b6'), rule('已確認', '#dcfce7', '#166534'), rule('不寄', '#f3f4f6', '#6b7280')]);
  try { sh.hideColumns(8); } catch (e) { /* 略過 */ }
  nfMailSheetRefresh_(sh);
  return sh;
}

/** 依 B3／B4 列出名單（可寄的預設打勾） */
function nfMailSheetRefresh_(sh) {
  var C = NF_MAIL_SHEET;
  var type = NF_MAIL_TYPE_BY_LABEL[String(sh.getRange(C.typeCell).getValue())] || 'preShip';
  var dateIso = nfIsoDate_(sh.getRange(C.dateCell).getValue());
  var ov = nfMailOverview_().types[type];
  var rows = ov.rows.filter(function (r) { return type !== 'pickupReminder' || r.pickupDate === dateIso; });
  var last = Math.max(sh.getLastRow(), C.first);
  sh.getRange(C.first, 1, last - C.first + 1, 8).clearContent().setDataValidation(null);
  sh.getRange(C.msgPrepare).setValue('');
  if (!rows.length) {
    sh.getRange(C.first, 2).setValue(type === 'pickupReminder' ? '這一天沒有自取訂單' : '沒有訂單');
    return 0;
  }
  var values = rows.map(function (r) {
    var can = r.status !== 'skip'; // 已寄過的也可以勾（＝補寄），預設只勾「可寄」
    var note = r.reason || (nfMailSheetIsSent_(r.status) ? '已寄過，要補寄請勾選' : '');
    return [can ? r.status === 'ready' : '', r.name + (r.onsite ? '（現場單）' : ''), r.phone, r.email, NF_MAIL_STATUS_TEXT[r.status] || r.status,
      r.at ? String(r.at).slice(5, 16) : '', note, r.id];
  });
  // 先設文字格式：電話開頭的 0 才不會被吃掉；訂單編號（時間戳記）才不會被轉成日期而對不到訂單
  sh.getRange(C.first, 3, values.length, 1).setNumberFormat('@');
  sh.getRange(C.first, 8, values.length, 1).setNumberFormat('@');
  sh.getRange(C.first, 1, values.length, 8).setValues(values);
  var check = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  rows.forEach(function (r, i) { if (r.status !== 'skip') sh.getRange(C.first + i, 1).setDataValidation(check); });
  return rows.length;
}

function nfMailSheetIsSent_(status) { return status === 'sent' || status === 'opened' || status === 'acked'; }

function nfMailSheetSelected_(sh) {
  var C = NF_MAIL_SHEET;
  var last = sh.getLastRow();
  if (last < C.first) return [];
  var sentText = [NF_MAIL_STATUS_TEXT.sent, NF_MAIL_STATUS_TEXT.opened, NF_MAIL_STATUS_TEXT.acked];
  return sh.getRange(C.first, 1, last - C.first + 1, 8).getValues()
    .filter(function (r) { return r[0] === true && r[7]; })
    .map(function (r) { return { id: nfIdStr_(r[7]), name: String(r[1]), resend: sentText.indexOf(String(r[4])) >= 0 }; });
}

function nfMailSheetEdit_(e) {
  var sh = e.range.getSheet();
  var C = NF_MAIL_SHEET;
  var a1 = e.range.getA1Notation();
  var props = nfProps_();
  var pendingKey = 'MAILSHEET_' + NF_CTX.env + ':' + NF_CTX.year;
  if (a1 === C.typeCell || a1 === C.dateCell || (a1 === C.refreshCell && e.range.getValue() === true)) {
    sh.getRange(C.refreshCell).setValue(false);
    props.deleteProperty(pendingKey);
    var n = nfMailSheetRefresh_(sh);
    nfToast_(e, '已列出 ' + n + ' 位客人');
    return;
  }
  var type = NF_MAIL_TYPE_BY_LABEL[String(sh.getRange(C.typeCell).getValue())] || 'preShip';
  var dateIso = type === 'pickupReminder' ? nfIsoDate_(sh.getRange(C.dateCell).getValue()) : null;
  if (a1 === C.prepareCell && e.range.getValue() === true) {
    sh.getRange(C.prepareCell).setValue(false);
    var sel = nfMailSheetSelected_(sh);
    if (!sel.length) { sh.getRange(C.msgPrepare).setValue('沒有勾選要寄的客人'); props.deleteProperty(pendingKey); return; }
    var first = sel.filter(function (x) { return !x.resend; }), again = sel.filter(function (x) { return x.resend; });
    props.setProperty(pendingKey, JSON.stringify({ type: type, date: dateIso, ids: first.map(function (x) { return x.id; }), resendIds: again.map(function (x) { return x.id; }), at: Date.now() }));
    var quota = nfMailQuota_();
    var parts = [];
    if (first.length) parts.push(first.map(function (x) { return x.name; }).join('、'));
    if (again.length) parts.push('補寄：' + again.map(function (x) { return x.name; }).join('、'));
    sh.getRange(C.msgPrepare).setValue('將寄出 ' + sel.length + ' 封「' + NF_MAIL_TYPES[type].label + '」給：' + parts.join('；') +
      (quota !== null ? '（今天還能寄 ' + quota + ' 封）' : '') + '。請在 2 分鐘內勾選「② 確定寄出」。');
    return;
  }
  if (a1 === C.confirmCell && e.range.getValue() === true) {
    sh.getRange(C.confirmCell).setValue(false);
    var raw = props.getProperty(pendingKey);
    var p = raw ? JSON.parse(raw) : null;
    if (!p || Date.now() - p.at > 2 * 60 * 1000 || p.type !== type) {
      sh.getRange(C.msgResult).setValue('請先勾選「① 準備寄出」確認名單（2 分鐘內有效）');
      return;
    }
    props.deleteProperty(pendingKey);
    sh.getRange(C.msgResult).setValue('寄送中…');
    var empty = { label: NF_MAIL_TYPES[type].label, sent: [], failed: [], overQuota: [], skipped: [] };
    var r = p.ids && p.ids.length ? nfMailSend_(type, p.ids, p.date, {}) : empty;
    var r2 = p.resendIds && p.resendIds.length ? nfMailSend_(type, p.resendIds, p.date, { resend: true }) : empty;
    ['sent', 'failed', 'overQuota', 'skipped'].forEach(function (k) { r[k] = r[k].concat(r2[k]); });
    var nAgain = r.sent.filter(function (x) { return x.resend; }).length;
    var msg = nfFormatTimestamp_(new Date()).slice(5, 16) + '　已寄出 ' + r.sent.length + ' 封「' + r.label + '」' + (nAgain ? '（其中補寄 ' + nAgain + ' 封）' : '');
    var miss = r.skipped.filter(function (x) { return (p.ids || []).concat(p.resendIds || []).indexOf(x.id) >= 0 && !/^已寄過/.test(x.reason); });
    if (miss.length) msg += '；沒有寄：' + miss.map(function (x) { return x.name + '（' + x.reason + '）'; }).join('、');
    if (r.failed.length) msg += '；失敗：' + r.failed.map(function (x) { return x.name + '（' + x.error + '）'; }).join('、');
    if (r.overQuota.length) msg += '；今天額度用完，明天再寄：' + r.overQuota.map(function (x) { return x.name; }).join('、');
    var already = r.skipped.filter(function (x) { return p.ids.indexOf(x.id) >= 0 && /^已寄過/.test(x.reason); });
    if (already.length) msg += '；已經寄過（可能剛由 WebPOS 寄出），沒有重寄：' + already.map(function (x) { return x.name; }).join('、');
    nfMailSheetRefresh_(sh);
    sh.getRange(C.msgResult).setValue(msg);
    nfToast_(e, msg);
    return;
  }
  // 勾選客人：名單變了，之前準備的作廢
  if (e.range.getRow() >= C.first && e.range.getColumn() === 1) {
    if (props.getProperty(pendingKey)) { props.deleteProperty(pendingKey); sh.getRange(C.msgPrepare).setValue('勾選有變動，請重新勾選「① 準備寄出」'); }
  }
}

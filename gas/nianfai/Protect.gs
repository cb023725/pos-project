/**
 * 保護範圍與匯款資訊異動通知
 *
 *   「設定」匯款戶名／銀行／分行／帳號  鎖定：只有擁有者能改（其他協作者改不了）
 *   「表單回應」整個分頁               修改前跳警告（Yw 仍要手動改數量、取消訂單，不能完全鎖死，
 *                                      但不會在不知情的情況下手滑改到）
 *   「設定」品項表（D～J 欄）           修改前跳警告（品項應由 WebPOS 同步）
 *
 * 表單送出、GAS 自己寫入（寄信狀態、WebPOS 同步）不受保護範圍影響。
 * 由「年菜工具 → 初始化」或「重新套用保護範圍」執行；只移除／重建說明以「年菜：」開頭的保護，
 * Yw 自己另外加的保護不會動。
 *
 * 匯款資訊被修改（不論是誰）→ 寄信通知店家信箱（可安裝的「編輯時」觸發，由初始化安裝；
 * 簡易 onEdit 觸發不能寄信，所以用可安裝的）。
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

/** 可安裝的「編輯時」觸發：「設定」的匯款資訊被修改就寄信通知 */
function nfOnEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== NF.SHEET_SETTINGS || e.range.getColumn() > 2) return;
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

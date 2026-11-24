/**
 * 表單提交 → 確認信＋停售檢查（取代舊 confirm.gs）
 *
 * 舊版問題（handoff 第 10 節）的修正：
 * - 用 e.range 讀觸發的那一列（不用 getLastRow，兩人同時送出不會寄錯人）
 * - 依題目名稱找欄位、價格讀「設定」（只存一個地方）
 * - try/catch，結果寫進「寄信狀態」欄
 * - 收件人規則：
 *     有填 email（不是店家信箱）→ 寄給客人，bcc 店家
 *     email 是店家信箱（現場單客人沒填）→ 只寄給店家，用來確認訂單有進 Sheet
 * - 年份、寄出期間、最後取貨日、表單網址從「設定」／表單帶入
 *
 * 觸發條件由選單「年菜工具 → 初始化」安裝（試算表的「提交表單時」）。
 */
function nfOnFormSubmit(e) {
  var sheet = e && e.range ? e.range.getSheet() : nfSheet_(NF.SHEET_RESPONSES);
  var rowNumber = e && e.range ? e.range.getRow() : sheet.getLastRow();
  var statusCol = nfEnsureStatusColumn_(sheet);
  var settings = nfReadSettings_();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
  var order = nfParseOrder_(row, nfMapColumns_(headers, settings), settings, rowNumber);
  if (!order) return;

  try {
    nfSendConfirmation_(order, settings);
    sheet.getRange(rowNumber, statusCol).setValue('確認信已寄出 ' + nfFormatTimestamp_(new Date()));
  } catch (err) {
    sheet.getRange(rowNumber, statusCol).setValue('確認信失敗：' + (err && err.message ? err.message : err));
  }

  try {
    nfCheckSellout_((order.isOnsite ? '現場單 ' + order.seqLabel : '線上單') + ' ' + order.timestampText);
  } catch (err2) {
    console.error('停售檢查失敗：' + err2);
  }
}

function nfBuildOrderData_(order, settings) {
  var kv = settings.kv;
  var lastPickup = kv['最後取貨日說明'] || (settings.pickupDates.length ? nfFormDateLabel_(settings.pickupDates[settings.pickupDates.length - 1]) : '');
  var formUrl = '';
  try { formUrl = nfForm_().getPublishedUrl(); } catch (e) { formUrl = ''; }
  return {
    year: settings.year || String(new Date().getFullYear()),
    timestamp: order.timestampText,
    name: order.name,
    method: order.method,
    pickupDate: order.pickupDateRaw instanceof Date ? nfFormDateLabel_(nfIsoDate_(order.pickupDateRaw)) : String(order.pickupDateRaw || ''),
    recipientName: order.recipientName || order.name,
    recipientPhone: order.recipientPhone || order.phone,
    recipientAddress: order.recipientAddress,
    items: order.items.map(function (x) {
      return {
        label: x.item.name,
        priceText: nfMoney_(x.item.price),
        qty: x.qty,
        amountText: nfMoney_(x.item.price * x.qty),
        subs: x.item.isBundle ? x.item.composition.map(function (c) { return c.item.name; }).join('、') : '',
      };
    }),
    shippingText: nfMoney_(order.shipping),
    totalText: nfMoney_(order.total),
    shipPeriod: String(kv['寄出期間'] || ''),
    lastPickupText: lastPickup,
    lastPickupEnd: String(kv['最後取貨結束時間'] || '16:00'),
    formUrl: formUrl,
    bankHolder: String(kv['匯款戶名'] || ''),
    bankName: String(kv['匯款銀行'] || ''),
    bankBranch: String(kv['匯款分行'] || ''),
    bankAccount: String(kv['匯款帳號'] || ''),
  };
}

function nfSendConfirmation_(order, settings) {
  var data = nfBuildOrderData_(order, settings);
  var tpl = HtmlService.createTemplateFromFile(order.isDelivery ? 'ConfirmDelivery' : 'ConfirmPickup');
  tpl.data = data;
  var html = tpl.evaluate().getContent();
  var to = order.email || NF.STORE_EMAIL;
  var isStore = to.toLowerCase() === NF.STORE_EMAIL.toLowerCase();
  var opts = { htmlBody: html, name: NF.SENDER_NAME };
  if (!isStore) opts.bcc = NF.STORE_EMAIL;
  var subject = '【咕咕義小餐館】' + data.year + ' 新春富貴年菜訂單資料'; // 主旨沿用去年文案，只換年份
  GmailApp.sendEmail(to, subject, '', opts);
}

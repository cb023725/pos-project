/**
 * 寄出前確認、出貨通知、取貨提醒（handoff 第 4、5、6 節；取代舊 pre_ship.gs／shipped.gs／pickup_reminder.gs）
 *
 *   寄出前確認  宅配單；WebPOS 年菜管理頁「寄信」先預覽名單、確認後才寄
 *   出貨通知    宅配單；必須已填「出貨日」與「託運單號」，沒填的列出原因跳過
 *   取貨提醒    自取單；每天 08:00 自動寄給「明天」取貨的客人（設定「取貨提醒開關」= 開），
 *               寄完把名單寄給店家；失敗只重試一次。WebPOS 也可以手動預覽／補寄指定日期
 *
 * 共同規則：
 *   - 寄過的不重寄（狀態存在指令碼屬性，見 OrderSheets.gs）
 *   - 現場單不寄（宅配由店家用簡訊／LINE 通知、自取客人手上有顧客聯）
 *   - 沒有 email（或 email 是店家信箱）不寄
 *   - 已取消的訂單不列入
 *   - Gmail 每天可寄封數有上限（一般帳號約 100 封，含確認信）；超過的部分不寄、列出來隔天再寄
 * 出貨通知與取貨提醒附上「加熱說明小卡」（「設定」的「加熱說明小卡ID」，空白就不附）。
 */
function nfMailPlan_(type, dateIso) {
  var T = NF_MAIL_TYPES[type];
  if (!T) throw new Error('未知的信件類型：' + type);
  nfSyncOrderSheets_();
  var settings = nfReadSettings_();
  var prev = nfReadOrderSheets_(nfSpreadsheet_(), settings);
  var target = type === 'pickupReminder' ? (dateIso || nfTomorrowIso_()) : null;
  var list = [];
  prev.rows[T.kind].forEach(function (r) {
    if (nfIsCancelled_(r)) return;
    if (target && nfIsoDate_(r.pickupDate) !== target) return;
    var ms = nfMailState_(r.id)[type];
    var email = String(r.email || '').trim();
    var reason = '';
    if (ms && ms.status === '已寄出') reason = '已寄過（' + ms.at + '）';
    else if (String(r.note || '').indexOf('現場單') >= 0) reason = '現場單不寄';
    else if (!email || email.toLowerCase() === NF.STORE_EMAIL.toLowerCase()) reason = '沒有 email';
    else if (type === 'shipped' && !r.shipDate) reason = '缺出貨日';
    else if (type === 'shipped' && !r.trackNo) reason = '缺託運單號';
    list.push({ id: r.id, name: String(r.name || ''), email: email, reason: reason, failed: !!(ms && ms.status !== '已寄出'), row: r });
  });
  return { type: type, label: T.label, date: target, list: list, settings: settings };
}

/** 給 WebPOS 預覽：可寄名單、跳過名單（含原因）、今天剩餘可寄封數 */
function nfMailPreview_(type, dateIso) {
  var p = nfMailPlan_(type, dateIso);
  var strip = function (x) { return { id: x.id, name: x.name, email: x.email, reason: x.reason, failed: x.failed }; };
  return {
    label: p.label,
    date: p.date ? nfFormDateLabel_(p.date) : null,
    eligible: p.list.filter(function (x) { return !x.reason; }).map(strip),
    skipped: p.list.filter(function (x) { return x.reason; }).map(strip),
    quota: nfMailQuota_(),
  };
}

function nfMailQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
}

/**
 * 寄出。ids：只寄這些訂單（WebPOS 預覽後確認的名單）；不傳＝全部可寄的。
 * opts.retry：失敗重試一次（自動取貨提醒）；opts.auto：自動排程（寄完通知店家）
 */
function nfMailSend_(type, ids, dateIso, opts) {
  opts = opts || {};
  var result = nfWithLock_(function () { // 避免兩邊同時按寄出造成重寄
    var p = nfMailPlan_(type, dateIso);
    var want = ids && ids.length ? ids.map(String) : null;
    var todo = p.list.filter(function (x) { return !x.reason && (!want || want.indexOf(x.id) >= 0); });
    var quota = nfMailQuota_();
    var overQuota = [];
    if (quota !== null && todo.length > quota) { overQuota = todo.slice(quota); todo = todo.slice(0, quota); }
    var attachment = type === 'preShip' ? null : nfHeatingCard_(p.settings);
    var sent = [], failed = [];
    todo.forEach(function (x) {
      var tries = opts.retry ? 2 : 1, err = null;
      for (var t = 0; t < tries; t++) {
        try { nfSendNotice_(type, x.row, p.settings, attachment); err = null; break; } catch (e) { err = e; Utilities.sleep(1000); }
      }
      if (err) {
        var msg = String(err && err.message ? err.message : err);
        nfSetMailState_(x.id, type, '失敗：' + msg);
        failed.push({ id: x.id, name: x.name, error: msg });
      } else {
        nfSetMailState_(x.id, type, '已寄出');
        sent.push({ id: x.id, name: x.name, email: x.email });
      }
      Utilities.sleep(300);
    });
    return {
      label: p.label,
      date: p.date ? nfFormDateLabel_(p.date) : null,
      sent: sent,
      failed: failed,
      overQuota: overQuota.map(function (x) { return { id: x.id, name: x.name }; }),
      skipped: p.list.filter(function (x) { return x.reason; }).map(function (x) { return { id: x.id, name: x.name, reason: x.reason }; }),
    };
  });
  nfSyncOrderSheets_(); // 把寄信狀態顯示到工作表
  if (opts.auto || result.failed.length || result.overQuota.length) nfMailReport_(result, opts.auto);
  return result;
}

/** 寄信結果通知店家 */
function nfMailReport_(r, auto) {
  if (auto && !r.sent.length && !r.failed.length && !r.overQuota.length) return; // 明天沒有要提醒的就不打擾
  var lines = [];
  lines.push((auto ? '自動' : '') + r.label + (r.date ? '（' + r.date + ' 取貨）' : '') + '：寄出 ' + r.sent.length + ' 封');
  if (r.sent.length) lines.push('\n已寄出：\n' + r.sent.map(function (x) { return '・' + x.name + '　' + x.id; }).join('\n'));
  if (r.failed.length) lines.push('\n寄送失敗（請確認 email 或稍後再寄）：\n' + r.failed.map(function (x) { return '・' + x.name + '　' + x.error; }).join('\n'));
  if (r.overQuota.length) lines.push('\n今天 Gmail 可寄封數已用完，明天再寄：\n' + r.overQuota.map(function (x) { return '・' + x.name; }).join('\n'));
  var skip = r.skipped.filter(function (x) { return x.reason.indexOf('已寄過') !== 0; });
  if (skip.length) lines.push('\n沒有寄：\n' + skip.map(function (x) { return '・' + x.name + '　' + x.reason; }).join('\n'));
  try {
    MailApp.sendEmail({
      to: NF.STORE_EMAIL,
      subject: '【年菜】' + r.label + '寄出 ' + r.sent.length + ' 封' + (r.failed.length ? '，失敗 ' + r.failed.length + ' 封' : ''),
      body: lines.join('\n'),
      name: NF.SENDER_NAME,
    });
  } catch (e) {
    console.error('寄信結果通知失敗：' + e);
  }
}

function nfHeatingCard_(settings) {
  var id = String(settings.kv['加熱說明小卡ID'] || '').trim();
  if (!id) return null;
  return DriveApp.getFileById(id).getBlob().setName('加熱說明小卡.jpg');
}

function nfNoticeItems_(row, settings) {
  var items = [], total = 0;
  settings.items.forEach(function (it, i) {
    var q = parseInt(row['qty_' + i], 10);
    if (!(q > 0)) return;
    var sub = it.isBundle ? it.composition.map(function (c) { return c.item.name; }).join('、') : '';
    var per = it.isBundle && it.composition.length ? it.composition.reduce(function (s, c) { return s + c.qty; }, 0) : 1;
    total += q * per;
    items.push({ name: it.name, qty: q, sub: sub });
  });
  return { items: items, totalCount: total };
}

function nfSendNotice_(type, row, settings, attachment, subjectPrefix) {
  var kv = settings.kv;
  var its = nfNoticeItems_(row, settings);
  var data = {
    year: settings.year,
    name: String(row.name || ''),
    receiverName: String(row.recipientName || row.name || ''),
    receiverPhone: String(row.recipientPhone || row.phone || ''),
    receiverAddress: String(row.recipientAddress || ''),
    shipPeriod: String(kv['寄出期間'] || ''),
    greeting: String(kv['祝賀語'] || ''),
    storePhone: String(kv['電話'] || ''),
    storeAddress: String(kv['店址'] || ''),
    line: String(kv['LINE'] || ''),
    trackingNo: String(row.trackNo || ''),
    shipDate: String(row.shipDate || ''),
    items: its.items,
    totalCount: its.totalCount,
  };
  var subject, file;
  if (type === 'preShip') {
    file = 'PreShip'; subject = '冷凍年菜宅配寄出前確認';
  } else if (type === 'shipped') {
    file = 'Shipped'; subject = '年菜寄出通知';
  } else {
    file = 'PickupReminder'; subject = '冷凍年菜取貨提醒';
    var iso = nfIsoDate_(row.pickupDate);
    data.shipDate = nfFormDateLabel_(iso).replace(/^\d{4}\//, '');
    var last = settings.pickupDates[settings.pickupDates.length - 1];
    var hours = String(kv['每日取貨時間'] || '12:00 ~ 20:00');
    data.pickupHours = iso === last ? hours.split(/\s*[~～-]\s*/)[0] + ' ~ ' + String(kv['最後取貨結束時間'] || '16:00') : hours;
  }
  var tpl = HtmlService.createTemplateFromFile(file);
  tpl.data = data;
  var opts = { htmlBody: tpl.evaluate().getContent(), name: NF.SENDER_NAME };
  if (attachment) opts.attachments = [attachment];
  GmailApp.sendEmail(String(row.email).trim(), (subjectPrefix || '') + subject, '您的信箱不支援 HTML 顯示。', opts);
}

/** 寄範本給店家 review：範例訂單＋「設定」的日期／祝賀語／店家資訊，不寫入任何寄信狀態 */
function nfMailSample_(to, types) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) throw new Error('email 格式不正確');
  var settings = nfReadSettings_();
  var row = {
    name: '王小明', phone: '0911222333', email: to,
    recipientName: '王大明', recipientPhone: '0912345678', recipientAddress: '台北市信義區範例路 1 號',
    trackNo: '123456789012',
    shipDate: nfShipDateLabels_(settings)[0] || '1/25 (一)',
    pickupDate: settings.pickupDates.length ? nfFormDateLabel_(settings.pickupDates[0]) : '',
  };
  var bundle = -1, single = -1;
  settings.items.forEach(function (it, i) { if (it.isBundle && bundle < 0) bundle = i; if (!it.isBundle && single < 0) single = i; });
  if (bundle >= 0) row['qty_' + bundle] = 1;
  if (single >= 0) row['qty_' + single] = 2;
  var attachment = null, note = '';
  try { attachment = nfHeatingCard_(settings); } catch (e) { note = '加熱說明小卡讀取失敗：' + e.message; }
  var sent = [];
  (types || ['preShip', 'shipped', 'pickupReminder']).forEach(function (t) {
    nfSendNotice_(t, row, settings, t === 'preShip' ? null : attachment, '【範本】');
    sent.push(NF_MAIL_TYPES[t].label);
  });
  return { sent: sent, attachment: !!attachment, note: note };
}

function nfTomorrowIso_() {
  return nfIsoDate_(Utilities.formatDate(new Date(Date.now() + 24 * 3600 * 1000), NF.TZ, 'yyyy-MM-dd'));
}

/** 每天 08:00（時間驅動觸發）：所有已正式上線、開啟取貨提醒的年度，寄給明天取貨的客人 */
function nfDailyPickupReminder() {
  var all = nfProps_().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('YEAR_') !== 0) return;
    try {
      var meta = JSON.parse(all[k]);
      if (!meta.live) return;
      var envYear = k.slice(5).split(':');
      nfUseYear_(envYear[0], envYear[1]);
      if (String(nfReadSettings_().kv['取貨提醒開關'] || '').trim() !== '開') return;
      nfMailSend_('pickupReminder', null, null, { retry: true, auto: true });
    } catch (e) {
      try {
        MailApp.sendEmail({ to: NF.STORE_EMAIL, subject: '【年菜】自動取貨提醒執行失敗', body: k + '\n' + (e && e.stack ? e.stack : e), name: NF.SENDER_NAME });
      } catch (e2) { console.error(e2); }
    }
  });
}

/** 確保每天 08:00 的取貨提醒觸發存在（整個專案一個） */
function nfEnsureDailyTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'nfDailyPickupReminder'; });
  if (!has) ScriptApp.newTrigger('nfDailyPickupReminder').timeBased().everyDays(1).atHour(8).nearMinute(0).inTimezone(NF.TZ).create();
  return true;
}

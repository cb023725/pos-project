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
/** ids：只看這些訂單（Sheet 選單選取的列）；取貨提醒有指定 ids 時不限日期 */
function nfMailPlan_(type, dateIso, ids) {
  var T = NF_MAIL_TYPES[type];
  if (!T) throw new Error('未知的信件類型：' + type);
  nfSyncOrderSheets_();
  var settings = nfReadSettings_();
  var prev = nfReadOrderSheets_(nfSpreadsheet_(), settings);
  var only = ids && ids.length ? ids.map(String) : null;
  var target = type === 'pickupReminder' ? (dateIso || (only ? null : nfTomorrowIso_())) : null;
  var list = [];
  prev.rows[T.kind].forEach(function (r) {
    if (only && only.indexOf(r.id) < 0) return;
    if (nfIsCancelled_(r)) return;
    if (target && nfIsoDate_(r.pickupDate) !== target) return;
    var ms = nfMailState_(r.id)[type];
    var email = String(r.email || '').trim();
    var reason = '';
    if (ms && ms.status === '已寄出') reason = '已寄過（' + ms.at + '）';
    else if (!email || email.toLowerCase() === NF.STORE_EMAIL.toLowerCase()) reason = '沒有 email';
    else if (type === 'shipped' && !r.shipDate) reason = '缺出貨日';
    else if (type === 'shipped') reason = nfTrackNoProblem_(r, prev.rows.delivery);
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

/**
 * 寄信總覽（WebPOS 寄信頁）：三種信每位客人的狀態，一次回傳
 *   status：ready 可寄｜sent 已寄出｜opened 已開信（參考）｜acked 客人已確認｜failed 寄送失敗｜skip 不寄（reason）
 *   取貨提醒另外附各取貨日人數
 */
function nfMailOverview_() {
  nfSyncOrderSheets_();
  var settings = nfReadSettings_();
  var prev = nfReadOrderSheets_(nfSpreadsheet_(), settings);
  var out = { quota: nfMailQuota_(), types: {} };
  Object.keys(NF_MAIL_TYPES).forEach(function (type) {
    var T = NF_MAIL_TYPES[type];
    var rows = [];
    prev.rows[T.kind].forEach(function (r) {
      if (nfIsCancelled_(r)) return;
      var ms = nfMailState_(r.id)[type];
      var email = String(r.email || '').trim();
      var status, reason = '', at = '';
      if (ms && ms.status === '已寄出') {
        status = ms.ackAt ? 'acked' : ms.openedAt ? 'opened' : 'sent';
        at = ms.ackAt || ms.openedAt || ms.at;
      } else {
        if (!email || email.toLowerCase() === NF.STORE_EMAIL.toLowerCase()) reason = '沒有 email';
        else if (type === 'shipped' && !r.shipDate) reason = '缺出貨日';
        else if (type === 'shipped') reason = nfTrackNoProblem_(r, prev.rows.delivery);
        status = reason ? 'skip' : (ms ? 'failed' : 'ready');
        if (ms) { at = ms.at; if (!reason) reason = String(ms.status).replace(/^失敗：/, ''); }
      }
      rows.push({
        id: r.id, name: String(r.name || ''), phone: String(r.phone || ''), email: email,
        pickupDate: r.pickupDate ? nfIsoDate_(r.pickupDate) : '', status: status, reason: reason, at: at,
        onsite: String(r.note || '').indexOf('現場單') >= 0,
      });
    });
    out.types[type] = { label: T.label, rows: rows };
  });
  return out;
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
    var p = nfMailPlan_(type, dateIso, ids);
    var want = ids && ids.length ? ids.map(String) : null;
    var todo = p.list.filter(function (x) { return !x.reason && (!want || want.indexOf(x.id) >= 0); });
    var quota = nfMailQuota_();
    var overQuota = [];
    if (quota !== null && todo.length > quota) { overQuota = todo.slice(quota); todo = todo.slice(0, quota); }
    var attachment = type === 'preShip' ? null : nfHeatingCard_(p.settings);
    var sent = [], failed = [];
    todo.forEach(function (x) {
      var cur = nfMailState_(x.id)[type]; // 寄之前再確認一次（WebPOS 與 Sheet 選單同時寄也不會重複）
      if (cur && cur.status === '已寄出') return;
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
    mapUrl: String(kv['地圖連結'] || ''),
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
    var ph = nfPickupHours_(settings, iso);
    data.pickupHours = ph.hours;
    data.isLastDay = ph.isLastDay;
  }
  data.shipPeriodShort = data.shipPeriod.replace(/^\d{4}\//, '');
  var tpl, html;
  data.ackUrl = row.id ? nfAckUrl_(row.id, type) : '#';
  tpl = HtmlService.createTemplateFromFile(file);
  tpl.data = data;
  html = tpl.evaluate().getContent();
  if (row.id) html = html.replace('</body>', nfOpenPixel_(row.id, type) + '</body>');
  var opts = { htmlBody: html, name: NF.SENDER_NAME };
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
  // 確認信範本：線上自取、線上宅配（未滿免運）、現場單（顯示流水號、不顯示匯款）
  var items = [];
  if (bundle >= 0) items.push({ item: settings.items[bundle], qty: 1 });
  if (single >= 0) items.push({ item: settings.items[single], qty: 2 });
  var subtotal = items.reduce(function (s, x) { return s + x.item.price * x.qty; }, 0);
  var base = { name: '王小明', phone: '0911222333', email: to, timestampText: nfFormatTimestamp_(new Date()), items: items, subtotal: subtotal,
    recipientName: '王大明', recipientPhone: '0912345678', recipientAddress: '台北市信義區範例路 1 號' };
  var confirms = {
    confirmPickup: { label: '確認信（線上自取）', o: { method: '來店自取', isDelivery: false, isOnsite: false, pickupDateRaw: row.pickupDate, shipping: 0 } },
    confirmDelivery: { label: '確認信（線上宅配）', o: { method: '宅配', isDelivery: true, isOnsite: false, shipping: subtotal < settings.freeThreshold ? settings.shippingFee : 0 } },
    confirmOnsite: { label: '確認信（現場單自取）', o: { method: '來店自取', isDelivery: false, isOnsite: true, seqLabel: settings.year.slice(-2) + Utilities.formatDate(new Date(), NF.TZ, 'yyMMdd') + '001', last5: '現結', pickupDateRaw: settings.pickupDates.length ? nfFormDateLabel_(settings.pickupDates[settings.pickupDates.length - 1]) : '', shipping: 0 } }, // 訂在最後一天，看提早結束的取貨時間
  };
  (types || ['preShip', 'shipped', 'pickupReminder', 'confirmPickup', 'confirmDelivery', 'confirmOnsite']).forEach(function (t) {
    if (confirms[t]) {
      var o = {}; Object.keys(base).forEach(function (k) { o[k] = base[k]; });
      Object.keys(confirms[t].o).forEach(function (k) { o[k] = confirms[t].o[k]; });
      o.total = o.subtotal + o.shipping;
      nfSendConfirmation_(o, settings, '【範本】');
      sent.push(confirms[t].label);
      return;
    }
    nfSendNotice_(t, row, settings, t === 'preShip' ? null : attachment, '【範本】');
    sent.push(NF_MAIL_TYPES[t].label);
  });
  return { sent: sent, attachment: !!attachment, note: note };
}

// ── 開信追蹤：信裡放一張 1×1 圖片，載入時記下開信時間（Gmail 大致準確；Apple 郵件會預先載入、擋圖片的信箱不會回報）──
function nfOpenToken_(key) {
  var sig = Utilities.computeHmacSha256Signature(key, nfSecret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 22);
}

function nfMailKeyParam_(id, type) {
  var key = NF_CTX.env + '|' + NF_CTX.year + '|' + type + '|' + id;
  return 'k=' + encodeURIComponent(key) + '&s=' + nfOpenToken_(key);
}

function nfOpenPixel_(id, type) {
  var base = nfProps_().getProperty('WEB_APP_URL');
  if (!base) return '';
  return '<img src="' + base + '?action=open&' + nfMailKeyParam_(id, type) + '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">';
}

/**
 * 客人確認：信裡的按鈕先開一個確認頁（doGet action=ack），客人在頁面上再點「確認」連結才記錄（doGet action=ackdo）。
 * 信箱的安全掃描只會打開信裡的連結，不會再點確認頁裡的連結，所以「客人已確認」代表客人真的看過信。
 * 第二步用連結而不是表單送出：多個 Google 帳號的導向、App 內建瀏覽器都不會把它弄壞。
 * （舊信件的表單送出 doPost action=ack 仍然有效）
 */
function nfAckUrl_(id, type) {
  var base = nfProps_().getProperty('WEB_APP_URL');
  return base ? base + '?action=ack&' + nfMailKeyParam_(id, type) : '#';
}

var NF_ACK_TEXT = {
  preShip: { q: '請確認收件資訊正確無誤', btn: '收件資訊正確，我已確認', done: '已收到您的確認，年菜將依寄出期間寄出。如需修改收件資訊，請洽官方 LINE。' },
  shipped: { q: '請確認您已收到出貨通知', btn: '我已收到出貨通知', done: '感謝確認！收到年菜後請確認品項及數量，有任何問題請與我們聯絡。' },
  pickupReminder: { q: '請確認您已收到取貨提醒', btn: '我已收到取貨提醒', done: '感謝確認！期待您準時來店取貨。如需變更取貨日，請提前通知我們備貨。' },
};

function nfAckParse_(key, sig) {
  if (!key || !sig || sig !== nfOpenToken_(key)) return null;
  var p = String(key).split('|');
  if (p.length < 4 || !NF_ACK_TEXT[p[2]]) return null;
  return { env: p[0], year: p[1], type: p[2], id: p.slice(3).join('|') };
}

function nfAckPage_(title, body, form) {
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_top">' +
    '<style>body{font-family:"PingFang TC","Microsoft JhengHei",sans-serif;background:#f9f9f9;margin:0;padding:24px;color:#333}' +
    '.c{max-width:420px;margin:40px auto;background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:28px;text-align:center}' +
    'h1{font-size:18px;margin:12px 0}p{font-size:14px;line-height:1.7;color:#555}button,.btn{display:inline-block;background:#C1032F;color:#fff;border:0;border-radius:28px;font-size:16px;font-weight:bold;padding:12px 32px;margin-top:12px;text-decoration:none}</style>' +
    '</head><body><div class="c"><img src="https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/945a049c-4a56-d37c-288c-e12771643211.png" width="180" alt="咕咕義小餐館">' +
    '<h1>' + esc(title) + '</h1><p>' + esc(body) + '</p>' + (form || '') + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('咕咕義小餐館').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** doGet action=ack：確認頁（還沒記錄） */
function nfAckGet_(key, sig) {
  var a = nfAckParse_(key, sig);
  if (!a) return nfAckPage_('連結無效', '請直接聯絡咕咕義小餐館官方 LINE。');
  var t = NF_ACK_TEXT[a.type];
  var href = (nfProps_().getProperty('WEB_APP_URL') || '') + '?action=ackdo&k=' + encodeURIComponent(key) + '&s=' + encodeURIComponent(sig);
  var link = '<a href="' + href.replace(/"/g, '&quot;') + '" target="_top" class="btn">' + t.btn + '</a>';
  return nfAckPage_(t.q, '請點下方按鈕完成確認。', link);
}

/** 記錄客人已確認：doGet action=ackdo（確認頁上的連結），舊信件的 doPost action=ack 也走這裡 */
function nfAckPost_(key, sig) {
  var a = nfAckParse_(key, sig);
  if (!a) return nfAckPage_('連結無效', '請直接聯絡咕咕義小餐館官方 LINE。');
  if (!nfProps_().getProperty(nfYearKey_(a.env, a.year))) return nfAckPage_('連結已失效', '請直接聯絡咕咕義小餐館官方 LINE。');
  nfUseYear_(a.env, a.year);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var st = nfMailState_(a.id);
    if (st[a.type] && !st[a.type].ackAt) {
      st[a.type].ackAt = nfFormatTimestamp_(new Date());
      nfProps_().setProperty(nfMailKey_(a.id), JSON.stringify(st));
    }
  } finally { lock.releaseLock(); }
  try { nfSyncOrderSheets_(); } catch (e) { /* 下次同步時會顯示 */ }
  return nfAckPage_('感謝您的確認', NF_ACK_TEXT[a.type].done);
}

/** doGet action=open（不需要密鑰，用簽章驗證）：第一次開信記下時間 */
function nfRecordOpen_(key, sig) {
  if (!key || !sig || sig !== nfOpenToken_(key)) return false;
  var p = String(key).split('|');
  if (p.length < 4) return false;
  if (!nfProps_().getProperty(nfYearKey_(p[0], p[1]))) return false;
  nfUseYear_(p[0], p[1]);
  var id = p.slice(3).join('|'), type = p[2];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    var st = nfMailState_(id);
    if (!st[type] || st[type].status !== '已寄出' || st[type].openedAt) return true;
    // 寄出 3 分鐘內的載入多半是信箱的安全掃描（Outlook／Hotmail 送達時就會先抓圖），不算開信
    var sentAt = new Date(String(st[type].at).replace(/\//g, '-').replace(' ', 'T') + '+08:00');
    if (!isNaN(sentAt) && Date.now() - sentAt.getTime() < 3 * 60 * 1000) return true;
    st[type].openedAt = nfFormatTimestamp_(new Date());
    nfProps_().setProperty(nfMailKey_(id), JSON.stringify(st));
  } finally { lock.releaseLock(); }
  try { nfSyncOrderSheets_(); } catch (e) { /* 下次同步時會顯示 */ }
  return true;
}

/** 取貨時段：最後一天（除夕前一天）用「最後取貨結束時間」，其他天用「每日取貨時間」，格式 12:00 - 20:00 */
function nfPickupHours_(settings, iso) {
  var kv = settings.kv;
  var parts = String(kv['每日取貨時間'] || '12:00 ~ 20:00').split(/\s*[~～-]\s*/);
  var start = parts[0] || '12:00', end = parts[1] || '20:00';
  var last = settings.pickupDates[settings.pickupDates.length - 1];
  var isLastDay = !!iso && iso === last;
  return {
    isLastDay: isLastDay,
    hours: start + ' - ' + (isLastDay ? String(kv['最後取貨結束時間'] || '16:00') : end),
    daily: start + ' - ' + end,
    lastEnd: String(kv['最後取貨結束時間'] || '16:00'),
    lastLabel: last ? nfFormDateLabel_(last).replace(/^\d{4}\//, '') : '',
  };
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

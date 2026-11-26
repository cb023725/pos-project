/**
 * 自動提醒（2026-11-27 Yw 規格）——寄出前確認不附小卡、也不需要小卡；小卡只附在出貨通知與取貨提醒
 *
 *   自動寄出前確認（宅配）：「寄出前確認開關」開，而且「寄出前確認時間」有填（例 2027/01/20 20:00），
 *             時間到了一次寄給所有可寄的宅配客（每 10 分鐘檢查一次，所以會在設定時間後 10 分鐘內寄出）。
 *             時間沒填就不寄，WebPOS 年菜管理頁會提醒。寄過的不重寄；之後改時間，只會寄給還沒寄過的人。
 *   自取提醒＝「取貨提醒」：「取貨提醒開關」開，每天 08:00 寄給明天取貨的客人；
 *             「加熱說明小卡ID」沒填或讀不到檔案就不寄，改寄信通知店家原因（明天沒人取貨就不通知）。
 *
 * 兩個開關預設都是「開」。只有正式上線的年度才會自動寄。
 */
var NF_PRESHIP_DONE_PREFIX = 'PRESHIP_AUTO_';

/** 「寄出前確認時間」文字 → Date（台北時間）；格式不對回傳 null */
function nfParseReminderAt_(v) {
  if (v instanceof Date) return v;
  var m = /^\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})\s*$/.exec(String(v || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(d.getTime()) ? null : d;
}

function nfFormatReminderAt_(d) { // 專案時區是 Asia/Taipei，直接用本地時間組字串
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 加熱說明小卡：沒填或讀不到都回傳原因 */
function nfHeatingCardProblem_(settings) {
  var id = String(settings.kv['加熱說明小卡ID'] || '').trim();
  if (!id) return '加熱說明小卡ID 沒填';
  var file;
  try { file = DriveApp.getFileById(id); file.getName(); } catch (e) { return '加熱說明小卡ID 讀不到檔案（請檢查 ID 或共用權限）'; }
  try { if (file.isTrashed()) return '加熱說明小卡在垃圾桶裡，請還原'; } catch (e) { /* 讀不到垃圾桶狀態就略過 */ }
  if (!/^image\//.test(String(file.getMimeType() || ''))) return '加熱說明小卡ID 不是圖片檔（' + file.getName() + '）';
  return '';
}

/** 兩種自動提醒目前的設定與狀態（WebPOS 年菜管理頁顯示用） */
function nfReminderStatus_(settings) {
  settings = settings || nfReadSettings_();
  var kv = settings.kv;
  var rawAt = String(kv['寄出前確認時間'] || '').trim();
  var at = rawAt ? nfParseReminderAt_(rawAt) : null;
  var atText = at ? nfFormatReminderAt_(at) : '';
  var done = NF_CTX ? nfProps_().getProperty(NF_PRESHIP_DONE_PREFIX + NF_CTX.env + ':' + NF_CTX.year) : null;
  var deliveryProblem = !rawAt ? '還沒指定寄出前確認的寄出時間，不會自動寄出' : !at ? '寄出前確認時間格式不對（例：2027/01/20 20:00）' : '';
  return {
    live: !!(NF_CTX && NF_CTX.meta && NF_CTX.meta.live),
    delivery: {
      on: String(kv['寄出前確認開關'] || '').trim() === '開',
      at: atText,
      sentAt: done && done === atText ? done : '',
      problem: deliveryProblem,
    },
    pickup: {
      on: String(kv['取貨提醒開關'] || '').trim() === '開',
      problem: nfHeatingCardProblem_(settings),
    },
  };
}

/** WebPOS 設定自動寄出前確認：on 開關、at 時間（空字串＝清除） */
function nfSetDeliveryReminder_(on, at) {
  if (on !== undefined && on !== null) nfSetKv_('寄出前確認開關', on ? '開' : '關');
  if (at !== undefined && at !== null) {
    var text = String(at).trim();
    if (text) {
      var d = nfParseReminderAt_(text);
      if (!d) throw new Error('寄出前確認時間格式不對（例：2027/01/20 20:00）');
      text = nfFormatReminderAt_(d);
    }
    nfSetKvText_('寄出前確認時間', text);
  }
  nfEnsureDailyTrigger_();
  return nfReminderStatus_();
}

/** 寫入文字（不讓試算表把日期時間自動轉成日期格式） */
function nfSetKvText_(key, value) {
  nfEnsureKv_([key]);
  var sh = nfSheet_(NF.SHEET_SETTINGS);
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setNumberFormat('@').setValue(value);
      return;
    }
  }
}

/** 每 10 分鐘（時間驅動觸發）：寄出前確認時間到了就寄「寄出前確認」 */
function nfDeliveryReminderTick() {
  var all = nfProps_().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('YEAR_') !== 0) return;
    try {
      var meta = JSON.parse(all[k]);
      if (!meta.live) return;
      var envYear = k.slice(5).split(':');
      nfUseYear_(envYear[0], envYear[1]);
      var st = nfReminderStatus_();
      if (!st.delivery.on || st.delivery.problem || st.delivery.sentAt) return;
      if (Date.now() < nfParseReminderAt_(st.delivery.at).getTime()) return;
      nfMailSend_('preShip', null, null, { retry: true, auto: true });
      nfProps_().setProperty(NF_PRESHIP_DONE_PREFIX + NF_CTX.env + ':' + NF_CTX.year, st.delivery.at);
    } catch (e) {
      try {
        MailApp.sendEmail({ to: NF.STORE_EMAIL, subject: '【年菜】自動寄出前確認執行失敗', body: k + '\n' + (e && e.stack ? e.stack : e), name: NF.SENDER_NAME });
      } catch (e2) { console.error(e2); }
    }
  });
}

/**
 * 自動取貨提醒（每天 08:00 由 nfDailyPickupReminder 呼叫）：小卡沒問題才寄；
 * 有問題而且明天有人要取貨 → 不寄，改寄信告訴店家原因。回傳寄送結果或 { skipped: 原因 }
 */
function nfAutoPickupReminder_(dateIso) { // dateIso：只限 dev 測試指定「明天」，正式排程不傳
  var settings = nfReadSettings_();
  var problem = nfHeatingCardProblem_(settings);
  if (problem) {
    var plan = nfMailPlan_('pickupReminder', dateIso || null, null);
    var waiting = plan.list.filter(function (x) { return !x.reason; });
    if (waiting.length) {
      MailApp.sendEmail({
        to: NF.STORE_EMAIL,
        subject: '【年菜】明天的取貨提醒沒有寄出（' + waiting.length + ' 位）',
        body: '原因：' + problem + '\n\n請到試算表「設定」填好「加熱說明小卡ID」後，從 WebPOS 年菜管理頁「寄信」→「取貨提醒」手動寄出：\n'
          + waiting.map(function (x) { return '・' + x.name; }).join('\n'),
        name: NF.SENDER_NAME,
      });
    }
    return { skipped: problem, waiting: waiting.length };
  }
  return nfMailSend_('pickupReminder', null, dateIso || null, { retry: true, auto: true });
}

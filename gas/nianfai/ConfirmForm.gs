/**
 * 客人確認改用 Google 表單（每個年度一份「年菜確認」表單）
 *
 * Apps Script 網頁在手機 App 內建瀏覽器、多個 Google 帳號登入時常出現「很抱歉，目前無法開啟檔案」，
 * Google 表單在任何手機、任何瀏覽器、有沒有登入都能開。流程：
 *   信裡的確認按鈕 → 直接送出已填好的表單（訂單、確認內容、確認碼）→ 客人看到表單的感謝畫面 → 記錄客人已確認
 * 點一下就完成（像取消訂閱電子報）。信箱的安全掃描可能在送達時自動打開連結，所以寄出後 3 分鐘內的確認不算
 * （掃描通常在送達當下就跑完）。確認碼含簽章，別人改不了別筆訂單。
 * 先前寄出的信（Apps Script 確認頁）仍然有效（Mail.gs nfAckGet_／nfAckPost_）。
 */
var NF_CONFIRM_FORM_CACHE = null;

function nfConfirmForm_() {
  if (NF_CONFIRM_FORM_CACHE && NF_CONFIRM_FORM_CACHE.key === NF_CTX.key) return NF_CONFIRM_FORM_CACHE.form;
  var meta = NF_CTX.meta;
  var form = null;
  if (meta.confirmFormId) { try { form = FormApp.openById(meta.confirmFormId); } catch (e) { form = null; } }
  if (!form) {
    form = FormApp.create(NF_CTX.year + ' 年菜確認' + (NF_CTX.env === 'dev' ? '（測試）' : ''));
    form.setTitle('咕咕義小餐館｜年菜確認')
      .setDescription('請確認下方的訂單資訊，沒問題請按「提交」完成確認。\n如需修改訂單或收件資訊，請洽咕咕義小餐館官方 LINE。')
      .setCollectEmail(false)
      .setAllowResponseEdits(false)
      .setShowLinkToRespondAgain(false)
      .setConfirmationMessage('✓ 已收到您的確認，謝謝！\n如需修改訂單或收件資訊，請洽咕咕義小餐館官方 LINE。');
    var ids = {
      order: form.addTextItem().setTitle('訂單').setRequired(true).getId(),
      what: form.addTextItem().setTitle('確認內容').setRequired(true).getId(),
      code: form.addTextItem().setTitle('確認碼（請勿修改）').setRequired(true).getId(),
    };
    if (meta.folderId) { try { DriveApp.getFileById(form.getId()).moveTo(DriveApp.getFolderById(meta.folderId)); } catch (e2) { /* 留在根目錄也可以 */ } }
    ScriptApp.newTrigger('nfOnConfirmForm').forForm(form).onFormSubmit().create();
    meta.confirmFormId = form.getId();
    meta.confirmIds = ids;
    nfSaveMeta_(NF_CTX.env, NF_CTX.year, meta);
  }
  NF_CONFIRM_FORM_CACHE = { key: NF_CTX.key, form: form };
  return form;
}

/** 這封信的確認連結：預先填好訂單、確認內容、確認碼的表單網址 */
function nfConfirmUrl_(row, type) {
  var form = nfConfirmForm_();
  var ids = NF_CTX.meta.confirmIds;
  var key = NF_CTX.env + '|' + NF_CTX.year + '|' + type + '|' + row.id;
  var last5 = String(row.last5 || '');
  var onsite = last5.indexOf(NF.ONSITE_PREFIX) === 0;
  var orderText = (row.name || '') + '｜' + (onsite ? '訂購編號 ' + last5.slice(NF.ONSITE_PREFIX.length) : '訂單時間 ' + String(row.id).replace(/#\d+$/, ''));
  var item = function (id) { return form.getItemById(id).asTextItem(); };
  var prefilled = form.createResponse()
    .withItemResponse(item(ids.order).createResponse(orderText))
    .withItemResponse(item(ids.what).createResponse(NF_ACK_TEXT[type].btn))
    .withItemResponse(item(ids.code).createResponse(key + '~' + nfOpenToken_(key)))
    .toPrefilledUrl();
  // 預填網址（viewform）改成直接送出（formResponse＋submit）：點一下就送出並顯示感謝畫面
  return prefilled.replace('/viewform?', '/formResponse?') + '&submit=Submit';
}

var NF_ACK_MIN_DELAY = 3 * 60 * 1000; // 寄出後 3 分鐘內的確認視為信箱自動掃描，不記錄

/** 記錄客人已確認（表單提交、舊確認頁共用）：回傳 { ok, already, at } */
function nfAckRecord_(key, sig) {
  var a = nfAckParse_(key, sig);
  if (!a || !nfProps_().getProperty(nfYearKey_(a.env, a.year))) return { ok: false };
  nfUseYear_(a.env, a.year);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var res = { ok: true, a: a };
  try {
    var st = nfMailState_(a.id);
    var sentAt = st[a.type] ? new Date(String(st[a.type].at).replace(/\//g, '-').replace(' ', 'T') + '+08:00') : null;
    if (!st[a.type]) res.ok = false;
    else if (st[a.type].ackAt) res.already = st[a.type].ackAt;
    else if (sentAt && !isNaN(sentAt) && Date.now() - sentAt.getTime() < NF_ACK_MIN_DELAY) res.tooSoon = true; // 多半是信箱掃描
    else {
      res.at = st[a.type].ackAt = nfFormatTimestamp_(new Date());
      nfProps_().setProperty(nfMailKey_(a.id), JSON.stringify(st));
    }
  } finally { lock.releaseLock(); }
  if (res.at) { try { nfSyncOrderSheets_(); } catch (e) { /* 下次同步時會顯示 */ } }
  return res;
}

/** 「年菜確認」表單提交（可安裝觸發）：讀確認碼、驗簽章、記錄 */
function nfOnConfirmForm(e) {
  if (!e || !e.response) return;
  var answers = e.response.getItemResponses();
  var code = '';
  answers.forEach(function (r) { if (String(r.getItem().getTitle()).indexOf('確認碼') === 0) code = String(r.getResponse() || ''); });
  var i = code.lastIndexOf('~');
  if (i < 0) return;
  var res = nfAckRecord_(code.slice(0, i), code.slice(i + 1));
  if (!res.ok) console.warn('確認碼無效或找不到寄信紀錄：' + code);
}

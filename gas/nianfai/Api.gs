/**
 * Web App 入口（部署為「網頁應用程式」，執行身分：我，存取權：所有人）
 * 一律驗證密鑰（指令碼屬性 WEBPOS_SECRET），回應一律 JSON：{ ok: true, ... } 或 { ok: false, error }
 * Apps Script 不能自訂 HTTP 狀態碼，WebPOS 要看 JSON 裡的 ok 判斷成功與否。
 * 每個請求都帶 env（dev／prod）與 year，先切換到該年度的試算表與表單。
 *
 * doPost action：
 *   createYear        建立當年度試算表、表單、分頁、保護範圍、觸發條件（FormBuild.gs）
 *   syncSettings      WebPOS 品項／價格／日期 → 「設定」
 *   planFormSync      同步到表單：只列出差異
 *   applyFormSync     同步到表單：套用
 *   checkForm         檢查表單對應（開賣前必須通過）
 *   protect           重新套用保護範圍
 *   rebuildTabs       依目前「設定」重建宅配／自取（保留手動欄）、查詢、統計、備料表（不動表單回應）
 *   syncOrders        重新整理宅配／自取（平常表單送出、修改表單回應時會自動做）
 *   mailPreview       寄信預覽：{ type: preShip｜shipped｜pickupReminder, date }→ 可寄名單、跳過原因、剩餘額度
 *   mailSend          寄信：{ type, ids, date }（ids 為預覽確認過的訂單編號）
 *   setReminder       取貨提醒自動寄送開關 { on }
 *   diagnose          回傳回應分頁、觸發條件、各分頁前幾列的計算結果（排查用）
 *   resetTestData     只限 dev：清空表單回應、修改紀錄與送單紀錄（WebPOS「一鍵清空測試資料」）
 *   goLive            測試完畢正式上線：清空表單回覆、表單回應（刪列，正式客人從第 2 列開始）、修改紀錄、
 *                     送單紀錄並重建分頁；每個年度只能做一次（之後拒絕，避免誤刪正式訂單）
 *   backToTesting     只限 dev：把年度改回測試中，方便重複測試正式上線流程
 *   setAccepting      開關表單（WebPOS 開賣／收單時呼叫）
 *   submitOrder       WebPOS 現場單送進表單（WebposSubmit.gs）
 *   finishProduction  寫入停售上限並立即檢查（製作完成）
 *   ping              連線測試
 * doGet action（一個專案只能有一個 doGet，用參數區分）：
 *   demand            各品項總訂購量（套餐已拆）、已送進表單的現場單流水號、表單是否開放
 *   ping              連線測試
 */
function doPost(e) {
  // 客人在確認頁按「確認」（HTML 表單送出，不需要密鑰，用簽章驗證）
  if (e && e.parameter && e.parameter.action === 'ack') {
    try { return nfAckPost_(e.parameter.k, e.parameter.s); } catch (err) { return HtmlService.createHtmlOutput('系統忙碌，請稍後再試'); }
  }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!nfSecret_() || body.secret !== nfSecret_()) return nfJson_({ ok: false, error: '密鑰錯誤' });
    // 記下網頁應用程式網址（開信追蹤圖片用；自動排程寄信時沒有請求可以參考）
    if (body.webAppUrl && body.webAppUrl !== nfProps_().getProperty('WEB_APP_URL')) nfProps_().setProperty('WEB_APP_URL', body.webAppUrl);
    if (body.action === 'createYear') return nfJson_(nfCreateYear_(body));
    if (body.action === 'ping') return nfJson_(nfPing_(body.env, body.year));
    nfUseYear_(body.env, body.year);
    switch (body.action) {
      case 'syncSettings':
        var written = nfWriteSettingsFromWebpos_(body);
        // 品項有變（增減、改名、改順序、套餐組成）→ 宅配／自取欄位跟著換，統計／備料表／查詢一併重建
        if (NF_CTX.ss.getSheetByName(NF.SHEET_DELIVERY)) nfSyncOrderSheets_();
        return nfJson_({ ok: true, items: written.items });
      case 'planFormSync':
        var plan = nfPlanFormSync_();
        return nfJson_({ ok: true, changes: plan.changes, warnings: plan.warnings, hasResponses: plan.hasResponses });
      case 'applyFormSync':
        return nfJson_({ ok: true, changes: nfApplyFormSync_().changes });
      case 'checkForm':
        var chk = nfCheckForm_();
        return nfJson_({ ok: true, passed: chk.ok, problems: chk.problems });
      case 'protect':
        return nfJson_({ ok: true, result: nfApplyProtections_() });
      case 'rebuildTabs':
        var built = nfBuildTabs_(nfReadSettings_());
        nfApplyProtections_();
        return nfJson_({ ok: true, result: built });
      case 'syncOrders':
        return nfJson_({ ok: true, result: nfSyncOrderSheets_() });
      case 'mailOverview':
        return nfJson_({ ok: true, result: nfMailOverview_() });
      case 'mailPreview':
        return nfJson_({ ok: true, result: nfMailPreview_(body.type, body.date) });
      case 'mailSend':
        return nfJson_({ ok: true, result: nfMailSend_(body.type, body.ids, body.date) });
      case 'testSubmit':
        return nfJson_({ ok: true, result: nfTestSubmit_(body.order) });
      case 'testStatus':
        return nfJson_({ ok: true, result: nfTestStatus_(body.id) });
      case 'testFollowUp':
        return nfJson_({ ok: true, result: nfTestFollowUp_(body.id, body.ship) });
      case 'testClearOpened':
        return nfJson_({ ok: true, result: nfTestClearOpened_() });
      case 'testFormat':
        return nfJson_({ ok: true, result: nfTestFormat_(body.sheet, body.a1, body.fmt) });
      case 'testConfirmUrl':
        return nfJson_({ ok: true, result: nfTestConfirmUrl_(body.id, body.type) });
      case 'testCell':
        return nfJson_({ ok: true, result: nfTestCell_(body.sheet, body.a1) });
      case 'removeFormImages':
        return nfJson_({ ok: true, result: nfRemoveFormImages_() });
      case 'formLinks':
        return nfJson_({ ok: true, result: nfFormLinks_() });
      case 'fixFormTimeTexts':
        return nfJson_({ ok: true, result: nfFixFormTimeTexts_() });
      case 'mailSample':
        return nfJson_({ ok: true, result: nfMailSample_(body.to, body.types) });
      case 'setReminder':
        nfSetKv_('取貨提醒開關', body.on ? '開' : '關');
        nfEnsureDailyTrigger_();
        return nfJson_({ ok: true, reminderOn: !!body.on });
      case 'diagnose':
        return nfJson_({ ok: true, result: nfDiagnose_() });
      case 'resetTestData':
        return nfJson_({ ok: true, result: nfResetTestData_() });
      case 'goLive':
        return nfJson_({ ok: true, result: nfGoLive_(body.accepting) });
      case 'backToTesting':
        if (NF_CTX.env !== 'dev') throw new Error('只有測試環境可以回到測試');
        NF_CTX.meta.live = false; delete NF_CTX.meta.liveAt;
        nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
        nfForm_().setAcceptingResponses(true);
        return nfJson_({ ok: true });
      case 'setAccepting':
        nfForm_().setAcceptingResponses(!!body.accepting);
        return nfJson_({ ok: true, formAccepting: nfForm_().isAcceptingResponses() });
      case 'submitOrder':
        return nfJson_(nfSubmitWebposOrder_(body.order));
      case 'finishProduction':
        nfSetSelloutCap_(body.itemId, body.itemName, Number(body.cap));
        return nfJson_({ ok: true, sellout: nfCheckSellout_('製作完成：' + (body.itemName || body.itemId)) });
      default:
        return nfJson_({ ok: false, error: '未知的 action：' + body.action });
    }
  } catch (err) {
    return nfJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ack') return nfAckGet_(p.k, p.s); // 客人確認頁
  if (p.action === 'ackdo') { // 確認頁上的「確認」連結：記錄客人已確認
    try { return nfAckPost_(p.k, p.s); } catch (err) { return HtmlService.createHtmlOutput('系統忙碌，請稍後再試'); }
  }
  if (p.action === 'open') { // 開信追蹤，不需要密鑰
    try { nfRecordOpen_(p.k, p.s); } catch (err) { console.error(err); }
    return ContentService.createTextOutput('');
  }
  try {
    if (!nfSecret_() || p.secret !== nfSecret_()) return nfJson_({ ok: false, error: '密鑰錯誤' });
    if (p.action === 'ping') return nfJson_(nfPing_(p.env, p.year));
    if (p.action === 'demand') {
      nfUseYear_(p.env, p.year);
      var d = nfComputeDemand_();
      return nfJson_({
        ok: true,
        year: d.settings.year,
        demandById: d.demandById,
        demandByName: d.demandByName,
        orderedById: d.orderedById,
        onsiteSeqs: d.onsiteSeqs,
        orderCount: d.orderCount,
        formAccepting: nfForm_().isAcceptingResponses(),
        updatedAt: nfFormatTimestamp_(new Date()),
      });
    }
    return nfJson_({ ok: false, error: '未知的 action：' + p.action });
  } catch (err) {
    return nfJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** 連線測試：GAS 有沒有回應；該年度建立了沒（沒建立也算連線成功） */
function nfPing_(env, year) {
  var raw = year ? nfProps_().getProperty(nfYearKey_(env, year)) : null;
  if (!raw) return { ok: true, created: false };
  nfUseYear_(env, year);
  var settings = nfReadSettings_();
  return {
    ok: true,
    created: true,
    spreadsheet: nfSpreadsheet_().getName(),
    spreadsheetUrl: nfSpreadsheet_().getUrl(),
    formUrl: nfForm_().getPublishedUrl(),
    formEditUrl: nfForm_().getEditUrl(),
    year: settings.year,
    items: settings.items.length,
    formAccepting: nfForm_().isAcceptingResponses(),
    live: !!NF_CTX.meta.live,
    liveAt: NF_CTX.meta.liveAt || null,
    reminderOn: String(settings.kv['取貨提醒開關'] || '').trim() === '開',
    sender: Session.getEffectiveUser().getEmail(), // 信件實際寄件帳號（顯示名稱是「咕咕義小餐館」）
    mailQuota: nfMailQuota_(),
    hasOrderSheets: !!nfSpreadsheet_().getSheetByName(NF.SHEET_DELIVERY),
  };
}

/** 排查用：回應分頁、表單、觸發條件、各分頁前幾列的顯示值 */
function nfDiagnose_() {
  var ss = nfSpreadsheet_();
  var form = nfForm_();
  var out = {
    spreadsheet: ss.getName(),
    sheets: ss.getSheets().map(function (sh) { return { name: sh.getName(), lastRow: sh.getLastRow(), lastCol: sh.getLastColumn(), formUrl: sh.getFormUrl() || '' }; }),
    formId: form.getId(),
    formDestinationId: (function () { try { return form.getDestinationId(); } catch (e) { return 'ERR ' + e; } })(),
    formResponses: form.getResponses().length,
    formAccepting: form.isAcceptingResponses(),
    formDescription: form.getDescription(),
    formTimeTexts: form.getItems().map(function (it) { return it.getHelpText(); }) // 表單各段說明裡和取貨時間有關的行
      .join('\n').split('\n').filter(function (l) { return /取貨時間|GMT|1899/.test(l); }),
    triggers: ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getTriggerSourceId && t.getTriggerSourceId() === ss.getId(); })
      .map(function (t) { return t.getHandlerFunction() + ':' + t.getEventType(); }),
    projectTriggers: ScriptApp.getProjectTriggers() // 整個專案（含每天 08:00 取貨提醒）
      .filter(function (t) { return !t.getTriggerSourceId || !t.getTriggerSourceId() || t.getEventType() === ScriptApp.EventType.CLOCK; })
      .map(function (t) { return t.getHandlerFunction() + ':' + t.getEventType(); }),
  };
  var dump = function (name, fromRow, nRows, nCols) {
    var sh = ss.getSheetByName(name);
    if (!sh) return null;
    var lc = Math.min(sh.getLastColumn() || 1, nCols);
    return sh.getRange(fromRow, 1, nRows, lc).getDisplayValues();
  };
  var resp = ss.getSheetByName(NF.SHEET_RESPONSES);
  var tail = function (name, headerRows, n, nCols) { // 標題列＋最後 n 列
    var sh = ss.getSheetByName(name);
    if (!sh) return null;
    var lr = sh.getLastRow();
    var lc = Math.min(sh.getLastColumn() || 1, nCols);
    var head = sh.getRange(1, 1, headerRows, lc).getDisplayValues();
    var from = Math.max(headerRows + 1, lr - n + 1);
    var rows = lr >= from ? sh.getRange(from, 1, lr - from + 1, lc).getDisplayValues().map(function (r, i) { return [String(from + i)].concat(r); }) : [];
    return { head: head, rows: rows };
  };
  out.responses = resp ? tail(NF.SHEET_RESPONSES, 1, 5, 40) : null;
  out.delivery = tail(NF.SHEET_DELIVERY, 1, 8, 40);
  out.pickup = tail(NF.SHEET_PICKUP, 1, 8, 40);
  out.stats = dump(NF.SHEET_STATS, 1, 22, 10);
  out.prep = dump(NF.SHEET_PREP, 1, 45, 12);
  out.lookup = dump(NF.SHEET_LOOKUP, 1, 8, 12);
  return out;
}

/** 只限 dev：WebPOS「一鍵清空測試資料」時一起清空測試試算表，避免流水號重新開始後跟舊回應撞號 */
function nfResetTestData_() {
  if (NF_CTX.env !== 'dev') throw new Error('只有測試環境可以清空回應');
  return nfClearAllResponses_();
}

/** 測試完畢正式上線：清空所有測試回應，之後正式客人從表單回應第 2 列開始；每個年度只能做一次 */
function nfGoLive_(accepting) {
  if (NF_CTX.meta.live) throw new Error(NF_CTX.year + ' 年已經正式上線（' + (NF_CTX.meta.liveAt || '') + '），不能再清空');
  var result = nfClearAllResponses_();
  NF_CTX.meta.live = true;
  NF_CTX.meta.liveAt = nfFormatTimestamp_(new Date());
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
  nfForm_().setAcceptingResponses(!!accepting); // 正式上線後表單開關跟著 WebPOS 開賣狀態
  return { cleared: result.cleared, liveAt: NF_CTX.meta.liveAt };
}

function nfClearAllResponses_() {
  var form = nfForm_();
  form.deleteAllResponses();
  var resp = nfSheet_(NF.SHEET_RESPONSES);
  var last = resp.getLastRow();
  // 測試環境直接刪列（正式環境取消訂單仍是清除內容、不刪列）：Google 表單會記住下一筆寫在哪一列，
  // 只清內容的話新回應會接在舊的最後一列後面；刪列後再重建分頁，公式範圍也一起重設
  if (last > 1) resp.deleteRows(2, last - 1);
  nfClearMailStates_();
  nfBuildTabs_(nfReadSettings_(), { reset: true }); // 宅配／自取（含手動欄、取消列）、修改紀錄清空重建
  nfApplyProtections_();
  var prefix = 'SUB_' + NF_CTX.env + ':' + NF_CTX.year + ':';
  var props = nfProps_();
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(prefix) === 0) props.deleteProperty(k); });
  return { cleared: Math.max(last - 1, 0) };
}

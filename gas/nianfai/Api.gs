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
 *   rebuildTabs       依目前「設定」重建訂單整理／供需庫存／備料表／修改紀錄（不動表單回應）
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
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!nfSecret_() || body.secret !== nfSecret_()) return nfJson_({ ok: false, error: '密鑰錯誤' });
    if (body.action === 'createYear') return nfJson_(nfCreateYear_(body));
    if (body.action === 'ping') return nfJson_(nfPing_(body.env, body.year));
    nfUseYear_(body.env, body.year);
    switch (body.action) {
      case 'syncSettings':
        return nfJson_({ ok: true, items: nfWriteSettingsFromWebpos_(body).items });
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
    triggers: ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getTriggerSourceId && t.getTriggerSourceId() === ss.getId(); })
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
  out.orders = (function () { // 訂單整理：只取有資料的最後 5 列（公式欄會延伸到第 1002 列，用時間戳記判斷）
    var sh = ss.getSheetByName(NF.SHEET_ORDERS);
    if (!sh) return null;
    var lc = Math.min(sh.getLastColumn(), 40);
    var all = sh.getRange(1, 1, Math.min(sh.getLastRow(), NF_DATA_ROWS + 2), lc).getDisplayValues();
    var tsCol = all[NF_ORDERS_HEADER_ROW - 1].indexOf('時間戳記');
    var filled = all.map(function (r, i) { return [String(i + 1)].concat(r); }).filter(function (r, i) { return i >= NF_ORDERS_FIRST_ROW - 1 && tsCol >= 0 && r[tsCol + 1]; });
    return { head: all.slice(0, NF_ORDERS_HEADER_ROW), rows: filled.slice(-5) };
  })();
  out.ordersFormulas = ss.getSheetByName(NF.SHEET_ORDERS) ? ss.getSheetByName(NF.SHEET_ORDERS).getRange(3, 1, 1, 12).getFormulas()[0] : null;
  out.stock = dump(NF.SHEET_STOCK, 1, 16, 15);
  out.prep = dump(NF.SHEET_PREP, 1, 15, 12);
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
  var log = nfSpreadsheet_().getSheetByName(NF.SHEET_LOG);
  if (log && log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 6).clearContent();
  nfBuildTabs_(nfReadSettings_()); // 訂單整理（含手動欄）、供需庫存、備料表重新建立
  nfApplyProtections_();
  var prefix = 'SUB_' + NF_CTX.env + ':' + NF_CTX.year + ':';
  var props = nfProps_();
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(prefix) === 0) props.deleteProperty(k); });
  return { cleared: Math.max(last - 1, 0) };
}

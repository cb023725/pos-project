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
  };
}

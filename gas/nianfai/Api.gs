/**
 * Web App 入口（部署為「網頁應用程式」，執行身分：我，存取權：任何人）
 * 一律驗證密鑰（指令碼屬性 WEBPOS_SECRET），回應一律是 JSON：{ ok: true, ... } 或 { ok: false, error }
 * Apps Script 不能自訂 HTTP 狀態碼，WebPOS 要看 JSON 裡的 ok 判斷成功與否。
 *
 * doPost action：
 *   submitOrder       WebPOS 現場單送進表單（WebposSubmit.gs）
 *   syncSettings      WebPOS 品項／價格／取貨日 → 「設定」
 *   finishProduction  寫入停售上限並立即檢查（製作完成）
 *   ping              連線測試
 * doGet action（一個專案只能有一個 doGet，用參數區分）：
 *   demand            各品項總訂購量（套餐已拆）、已送進表單的現場單流水號、表單是否開放
 *   ping              連線測試
 *   （開信追蹤之後加在這裡）
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!nfSecret_() || body.secret !== nfSecret_()) return nfJson_({ ok: false, error: '密鑰錯誤' });
    switch (body.action) {
      case 'submitOrder':
        return nfJson_(nfSubmitWebposOrder_(body.order));
      case 'syncSettings':
        var res = nfWriteSettingsFromWebpos_(body);
        return nfJson_({ ok: true, items: res.items });
      case 'finishProduction':
        nfSetSelloutCap_(body.itemId, body.itemName, Number(body.cap));
        return nfJson_({ ok: true, sellout: nfCheckSellout_('製作完成：' + (body.itemName || body.itemId)) });
      case 'ping':
        return nfJson_(nfPing_());
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
    if (p.action === 'demand') {
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
    if (p.action === 'ping') return nfJson_(nfPing_());
    return nfJson_({ ok: false, error: '未知的 action：' + p.action });
  } catch (err) {
    return nfJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function nfPing_() {
  var settings = nfReadSettings_();
  return {
    ok: true,
    spreadsheet: nfSpreadsheet_().getName(),
    year: settings.year,
    items: settings.items.length,
    formAccepting: nfForm_().isAcceptingResponses(),
  };
}

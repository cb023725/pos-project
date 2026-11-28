/**
 * 訂購量計算（給 WebPOS 年菜管理頁顯示「庫存 vs 訂購量」）
 *
 * 需求 = 「表單回應」所有有效列（線上＋已送進表單的現場單），套餐依「設定」的組成拆成單品。
 * 不自動停售、不自動關表單（2026-11-27 Yw 決定）；「設定」的「停售上限」欄已不使用。
 */
function nfComputeDemand_() {
  var settings = nfReadSettings_();
  var data = nfReadResponses_();
  var cols = nfMapColumns_(data.headers, settings);
  var demandByName = {};
  var orderedByName = {}; // 各品項被點的原始份數（套餐不拆，給年菜庫存「套餐」列顯示份數）
  var onsiteSeqs = [];
  var orderCount = 0;
  data.rows.forEach(function (row, i) {
    var order = nfParseOrder_(row, cols, settings, i + 2);
    if (!order) return;
    orderCount++;
    if (order.isOnsite && order.seqLabel) onsiteSeqs.push(order.seqLabel);
    order.items.forEach(function (x) {
      orderedByName[x.item.name] = (orderedByName[x.item.name] || 0) + x.qty;
      if (x.item.isBundle && x.item.composition.length) {
        x.item.composition.forEach(function (c) {
          demandByName[c.item.name] = (demandByName[c.item.name] || 0) + c.qty * x.qty;
        });
      } else {
        demandByName[x.item.name] = (demandByName[x.item.name] || 0) + x.qty;
      }
    });
  });
  var demandById = {};
  var orderedById = {};
  settings.items.forEach(function (it) {
    if (it.id && demandByName[it.name]) demandById[it.id] = demandByName[it.name];
    if (it.id && orderedByName[it.name]) orderedById[it.id] = orderedByName[it.name];
  });
  return { settings: settings, demandByName: demandByName, demandById: demandById, orderedById: orderedById, onsiteSeqs: onsiteSeqs, orderCount: orderCount };
}


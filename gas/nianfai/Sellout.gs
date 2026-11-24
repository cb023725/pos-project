/**
 * 需求與停售（handoff 第 2 節「庫存與停售」）
 *
 * 需求 = 「表單回應」所有有效列（線上＋已送進表單的現場單），套餐依「設定」的組成拆成單品。
 * 任一已設停售上限的品項需求 ≥ 上限 → 關閉整份表單並寄信通知 Yw。
 * 套餐需求拆成組成計入，所以組成停售時套餐也會一起達標（表單整份關閉）。
 */
function nfComputeDemand_() {
  var settings = nfReadSettings_();
  var data = nfReadResponses_();
  var cols = nfMapColumns_(data.headers, settings);
  var demandByName = {};
  var onsiteSeqs = [];
  var orderCount = 0;
  data.rows.forEach(function (row, i) {
    var order = nfParseOrder_(row, cols, settings, i + 2);
    if (!order) return;
    orderCount++;
    if (order.isOnsite && order.seqLabel) onsiteSeqs.push(order.seqLabel);
    order.items.forEach(function (x) {
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
  settings.items.forEach(function (it) {
    if (it.id && demandByName[it.name]) demandById[it.id] = demandByName[it.name];
  });
  return { settings: settings, demandByName: demandByName, demandById: demandById, onsiteSeqs: onsiteSeqs, orderCount: orderCount };
}

function nfCheckSellout_(reason) {
  var d = nfComputeDemand_();
  var reached = d.settings.items.filter(function (it) {
    return it.cap !== null && !isNaN(it.cap) && (d.demandByName[it.name] || 0) >= it.cap;
  });
  var form = nfForm_();
  var closedNow = false;
  if (reached.length && form.isAcceptingResponses()) {
    form.setAcceptingResponses(false);
    closedNow = true;
    var lines = reached.map(function (it) {
      return '・' + it.name + '：需求 ' + (d.demandByName[it.name] || 0) + ' ／ 上限 ' + it.cap;
    }).join('\n');
    try {
      MailApp.sendEmail({
        to: NF.STORE_EMAIL,
        subject: '【年菜】已達停售上限，表單已自動關閉',
        body: '觸發：' + (reason || '') + '\n\n' + lines + '\n\n表單關閉後只能從 WebPOS 新增訂單。',
        name: NF.SENDER_NAME,
      });
    } catch (err) {
      console.error('停售通知寄送失敗：' + err);
    }
  }
  return {
    closedNow: closedNow,
    formAccepting: form.isAcceptingResponses(),
    reached: reached.map(function (it) { return it.name; }),
  };
}

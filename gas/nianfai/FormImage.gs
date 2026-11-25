/**
 * 表單說明圖片、短網址
 *
 * Google 表單的說明只能是純文字（不能粗體、顏色），所以由 WebPOS 依同一份資料畫成圖片（標題、價格、重點用顏色），
 * 這裡放到表單最上方。重新產生會替換同一張圖（題目 ID 記在 meta.ids.descImage）。原本的文字說明不動，
 * Yw 可以自己決定要不要刪掉。
 * 短網址用 Google 表單官方的 forms.gle（FormApp.shortenFormUrl），存在 meta.shortUrl。
 */
function nfFormTextData_() {
  var s = nfReadSettings_();
  var kv = s.kv;
  var bundle = s.items.filter(function (it) { return it.isBundle; })[0];
  return {
    year: s.year,
    greeting: String(kv['表單問候語'] || ''),
    bundle: bundle ? { name: bundle.name, price: bundle.price, composition: bundle.composition.map(function (c) { return { name: c.item.name, qty: c.qty }; }) } : null,
    singles: s.items.filter(function (it) { return !it.isBundle; }).map(function (it) { return { name: it.name, price: it.price, inBundle: it.inBundle }; }),
    shippingFee: s.shippingFee,
    singleMax: s.singleMax,
    freeThreshold: s.freeThreshold,
    address: String(kv['店址'] || ''),
    phone: String(kv['電話'] || ''),
    line: String(kv['LINE'] || ''),
  };
}

function nfSetDescImage_(pngBase64) {
  if (!pngBase64) throw new Error('沒有圖片');
  var form = nfForm_();
  var blob = Utilities.newBlob(Utilities.base64Decode(pngBase64), 'image/png', '年菜說明.png');
  var ids = NF_CTX.meta.ids = NF_CTX.meta.ids || {};
  var item = null;
  if (ids.descImage) { try { item = form.getItemById(ids.descImage); } catch (e) { item = null; } }
  if (item) {
    item.asImageItem().setImage(blob);
  } else {
    var img = form.addImageItem().setImage(blob).setTitle('');
    form.moveItem(img.getIndex(), 0); // 放在最上方（說明文字下面、第一題之前）
    ids.descImage = img.getId();
    item = img;
  }
  try { item.asImageItem().setWidth(740).setAlignment(FormApp.Alignment.CENTER); } catch (e2) { /* 舊表單不支援就略過 */ }
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
  return { itemId: ids.descImage };
}

/**
 * 兩張圖放到題目上方：套餐圖在套餐題前、單點圖在單點表格前（重新產生替換同一張），
 * 並把表單說明換成新版文字（優惠、宅配、自取、諮詢與 LINE 連結；菜單改看圖片）。
 * 先前放在最上方的整張說明圖拿掉。
 */
function nfSetFormImages_(bundleB64, singlesB64) {
  var form = nfForm_();
  var ids = NF_CTX.meta.ids = NF_CTX.meta.ids || {};
  var getItem = function (id) { try { return id ? form.getItemById(id) : null; } catch (e) { return null; } };
  var place = function (key, b64, targetId, name) {
    var target = getItem(targetId);
    if (!b64 || !target) return null;
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', name);
    var item = getItem(ids[key]);
    if (item) item.asImageItem().setImage(blob);
    else { item = form.addImageItem().setImage(blob).setTitle(''); ids[key] = item.getId(); }
    try { item.asImageItem().setWidth(740).setAlignment(FormApp.Alignment.CENTER); } catch (e) { /* 略過 */ }
    // 移到目標題目正上方
    var ti = target.getIndex(), ii = item.getIndex();
    form.moveItem(ii, ii < ti ? ti - 1 : ti);
    return item.getId();
  };
  var bundleName = Object.keys(ids.bundles || {})[0];
  var out = {
    bundle: place('bundleImage', bundleB64, bundleName ? ids.bundles[bundleName] : null, '年菜套餐.png'),
    singles: place('gridImage', singlesB64, ids.grid, '年菜單點.png'),
  };
  var old = getItem(ids.descImage);
  if (old) { form.deleteItem(old); delete ids.descImage; }
  form.setDescription(nfFormTexts_(nfReadSettings_()).description);
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
  return out;
}

function nfFormLinks_() {
  var form = nfForm_();
  var url = form.getPublishedUrl();
  if (!NF_CTX.meta.shortUrl || NF_CTX.meta.shortUrlFor !== url) {
    try {
      NF_CTX.meta.shortUrl = form.shortenFormUrl(url);
      NF_CTX.meta.shortUrlFor = url;
      nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
    } catch (e) { return { url: url, short: null, error: String(e.message || e) }; }
  }
  return { url: url, short: NF_CTX.meta.shortUrl };
}

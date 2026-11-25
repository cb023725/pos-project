/**
 * 表單短網址（forms.gle，FormApp.shortenFormUrl，存在 meta.shortUrl），年菜管理頁顯示短網址與海報用 QR code。
 *
 * nfRemoveFormImages_：拿掉先前試做放在表單上的菜單圖片（meta.ids.descImage／bundleImage／gridImage），
 * 並把表單說明還原成原本的文字版（Yw 決定自己手動調整格式，不用圖片）。
 */
function nfRemoveFormImages_() {
  var form = nfForm_();
  var ids = NF_CTX.meta.ids = NF_CTX.meta.ids || {};
  var removed = 0;
  ['descImage', 'bundleImage', 'gridImage'].forEach(function (k) {
    if (!ids[k]) return;
    try { var it = form.getItemById(ids[k]); if (it) { form.deleteItem(it); removed++; } } catch (e) { /* 已經被刪 */ }
    delete ids[k];
  });
  form.setDescription(nfFormTexts_(nfReadSettings_()).description);
  nfSaveMeta_(NF_CTX.env, NF_CTX.year, NF_CTX.meta);
  return { removed: removed };
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

# 待清理項目（Tech Debt）

已知但刻意延後處理的項目，每項都寫明原因與處理時機。

---

## 1. `menu_items.nianfai_production_qty` 欄位已停用

- **記錄日期：** 2026-11-27
- **處理時機：** 正式環境年菜上線並穩定運作後
- **狀態：** 待處理

### 現況

修正單 #01 之後，年菜的製作入庫量改在庫存管理頁的「年菜庫存」維護。2026-11-27 起「製作完成」與停售功能已整個移除（見 §2），也不再讀這個欄位。前端也沒有任何地方會寫入它。

### 為什麼暫時保留

1. **部署用的 migration 還需要讀它：** `supabase/migrations/20261124c_nianfai_stock_category.sql` 建立 5 個年菜庫存時，會把這個欄位的舊數量搬進新庫存。所以欄位必須存在到這支 migration 跑完。
2. **刪欄位無法復原：** 欄位一刪資料就沒了。保留一個空欄位對資料庫沒有負擔。
3. **程式仍有對應：** 一般菜單 API 還在讀寫這個欄位，見 `server.js` 菜單列表的 `nianfaiProductionQty: r.nianfai_production_qty`，以及菜單更新的 `updates.nianfai_production_qty`。只刪欄位不刪程式，菜單更新會失敗。

### 容易誤會的地方

年菜品項 API（`/api/nianfai/items`）回傳的 `nianfaiProductionQty`，值其實是**對應年菜庫存的數量**（`isSeasonalStock ? refStock : null`），不是這個資料庫欄位，只是名稱沒改。`src/pages/NianfaiAdmin.js` 用的就是這個值。

### 處理方式（三件事一起做，先在 dev 驗證）

1. 新增一支 migration：`alter table public.menu_items drop column if exists nianfai_production_qty;`
2. 刪除 `server.js` 菜單 API 中讀寫這個欄位的兩行。
3. 把年菜品項 API 與 `NianfaiAdmin.js` 中的 `nianfaiProductionQty` 改名為 `nianfaiStockQty`。
4. 同步更新 `schema.sql` 的欄位說明。

---

## 2. 停售功能移除後留下的欄位與 Sheet 欄

- **記錄日期：** 2026-11-27
- **處理時機：** 和 §1 一起，正式環境年菜上線並穩定運作後
- **狀態：** 待處理

### 背景

2026-11-27 Yw 決定：年菜不連動停售、不自動關 Google 表單（表單由 Yw 自己關），年菜管理頁只顯示庫存與訂購量，並顯示 Google 表單目前是開放或關閉。
已移除：「製作完成」按鈕與 `/api/nianfai/items/:id/finish-production`、WebPOS 停售計算（年菜品項不再回傳 `soldOut`／`nianfaiSelloutCap`）、結帳後的停售檢查、GAS 的 `finishProduction` action、`nfCheckSellout_`、`nfSetSelloutCap_`、表單送出時的停售檢查。

### 還留著、但已經沒有作用的

1. **`menu_items.nianfai_sellout_cap` 欄位**（migration `20261123b_nianfai_phase2_sellout.sql` 新增）：不會再被寫入。`server.js` 只剩兩處把它清成 null（重設測試資料、正式上線），以及同步到 Sheet「設定」時帶出（永遠是空的）。
2. **Sheet「設定」品項表的「停售上限」欄**（`gas/nianfai/Settings.gs` 的 `NF_SETTINGS_ITEM_HEADERS`）：GAS 不再讀它。直接刪欄會讓後面的「製作入庫」欄位位置跑掉，要連同 `nfReadSettings_` 的欄位對應一起改。

### 為什麼暫時保留

刪欄位不能復原；Sheet 欄位位置牽涉讀設定的程式，改錯會讓品項、價格讀錯。現在留著不影響任何功能。

### 處理方式

1. migration：`alter table public.menu_items drop column if exists nianfai_sellout_cap;`，同時刪掉 `server.js` 裡清空與同步這個欄位的程式。
2. GAS：「設定」品項表移除「停售上限」欄，調整 `NF_SETTINGS_ITEM_HEADERS` 與讀取欄位的索引，跑 `node gas/tools/gas_mock_test.js` 全部通過後再部署。

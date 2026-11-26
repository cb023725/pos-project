# 待清理項目（Tech Debt）

已知但刻意延後處理的項目，每項都寫明原因與處理時機。

---

## 1. `menu_items.nianfai_production_qty` 欄位已停用

- **記錄日期：** 2026-11-27
- **處理時機：** 正式環境年菜上線並穩定運作後
- **狀態：** 待處理

### 現況

修正單 #01 之後，年菜的製作入庫量改在庫存管理頁的「年菜庫存」維護。按下「製作完成」時，停售上限取自對應年菜庫存當下的數量（見 `server.js` 的 `/api/nianfai/items/:id/finish-production`），不再讀這個欄位。前端也沒有任何地方會寫入它。

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

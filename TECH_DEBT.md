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

---

## 3. 一般營運：沒有桌號的孤兒訂單 #449（2026-06-02）

- **記錄日期：** 2026-11-29（2026-11-27 正式環境部署年菜後檢查時發現）
- **處理時機：** 資料清理隨時可做（關帳後）；程式修正排在年菜上線穩定後
- **狀態：** 待處理
- **分類：** 一般營運（和年菜無關）

### 歷史

正式環境訂單 #449 的內容（2026-11-27 只讀查詢）：

| 欄位 | 值 |
|---|---|
| 開單 | 2026-06-02 16:51（台北） |
| 類型／桌號 | 內用，桌號是**空字串**，`tables_used` 空 |
| 單號 | 1（送廚時才派） |
| 品項 | 松阪豬拌麵 ×1，280 元 |
| 狀態 | `paid`，`cleared_at` 空 |
| 發票 | #478 `INV-1780390300087`，已開立，280 元，開單後約 6 秒結帳 |

它有 `pickup_time`（開單後 20 分鐘）和 `needs_utensils = true`，這兩個通常是外帶才有。推測當時其實是外帶，但點餐頁沒帶到桌號（例如重新整理或從沒有桌號的路徑進入點餐頁），只是推測，無法從資料確認。
之後近半年都一直是 `paid`，2026-11-27 部署檢查 `/api/orders/active` 時才看到（`DEPLOY_PROD_NIANFAI.md` 第 9 節也有記）。

### 漏洞

1. **建立訂單不檢查桌號：** `server.js` `/api/orders/new` 只判斷 `od.table === '外帶'`。桌號是空的也照樣建立，`order_type` 會被當成「內用」，而且因為 `od.table` 是空的，不會寫入 `tables`。
2. **沒有任何地方能把它歸檔：**
   - 內用訂單只有「清桌」（`/api/tables/:tableNumber/reset`）會改成 `archived_paid`，而清桌是從 `tables` 找訂單，這張單沒有桌位紀錄。
   - 外帶頁只列 `table === '外帶'` 的訂單，點餐頁、桌位頁也都是用桌號比對。
   - 結果這張單在所有畫面都看不到，也就永遠停在 `paid`。
3. **類型標錯：** 報表 RPC 用 `order_type`，這張被算成內用 1 位客人；報表的桌號欄位則因為空字串退回顯示「外帶」，前後不一致。

### 目前影響

- **營業額正確：** 發票是有效的，6/2 營業額本來就包含這 280 元，關帳和錢櫃不受影響。
- **只是殘留：** 一直出現在 `/api/orders/active` 的結果裡，各頁面都會過濾掉，畫面看不到。
- **dev 會被清掉：** dev 的「一鍵清空測試資料」會刪所有 `paid` 訂單，dev 有同樣情況會被清掉；正式環境沒有這個按鈕（伺服器拒絕）。

### 處理方式

1. **資料清理（Yw 在 Supabase SQL Editor 執行）：** `data-fixes/prod-archive-orphan-order-449.sql`。
   - 只把狀態改成 `archived_paid`、補 `cleared_at`，和正常清桌的結果一樣。
   - 不刪訂單和發票，也不改類型，報表數字不變。
   - 會先確認剛好 1 筆符合：id 449、`paid`、桌號空、不是年菜、發票已開立，否則停止。
2. **防止再發生（先在 dev 驗證）：**
   - `/api/orders/new`：桌號是空的直接回 400「缺少桌號」；前端點餐頁在沒有桌號時不送單，提示回桌位頁重新進入。
   - 安全網：伺服器啟動或關帳時，查出 `status in ('open','served','paid')` 但桌號空、也不是外帶或年菜的訂單。在桌位頁顯示「有 N 張沒有桌號的訂單」，並提供「歸檔」按鈕，按下才改狀態，不自動改。
3. **一次性檢查正式環境有沒有其他孤兒訂單：**

   ```sql
   select id, status, order_type, table_number, timestamp at time zone 'Asia/Taipei' as 開單, total
   from public.orders
   where status in ('open','served','paid') and coalesce(table_number,'') = '' and is_nianfai is not true;
   ```


---

## 4. GitHub 上的 main 落後正式環境；正式環境 `.env` 沒有異地備份

- **記錄日期：** 2026-11-29
- **處理時機：** 年菜季結束、正式環境穩定之後
- **狀態：** 待處理
- **分類：** 一般營運（版本與備份）

### 現況

| 位置 | 版本 |
|---|---|
| 正式環境 `~/pos-project` 的本機 main | 和 `feature/nianfai` 相同（2026-11-29 為 ff01427 之後），就是目前正式在跑的程式 |
| GitHub `origin/feature/nianfai` | 2026-11-29 已推送，和正式環境相同 |
| GitHub `origin/main` | 還停在 dcb13d5（年菜開發前，dev 一鍵清空按鈕），比本機 main 落後 130 個 commit |

- 本機 main 只比 GitHub main 多出新的 commit，沒有分岔，之後可以直接 fast-forward。
- 目前正式程式在 GitHub 上只存在 `feature/nianfai` 分支。這個分支被刪掉或改寫的話，GitHub 上就沒有正式版本的程式。

### 為什麼現在不推 main

Yw 交代過不要推 main，要等年菜季結束、確定穩定之後再決定。

### `.env` 沒有備份

- 正式環境的 `~/pos-project/.env` 存有 Supabase 連線資訊、年菜 GAS 密鑰等，在 `.gitignore` 裡，不會、也不該推上 GitHub。
- 目前只存在這台 Mac。電腦壞了，程式可以從 GitHub 還原，但 `.env` 要重新從 Supabase、GAS 後台找回各項金鑰。
- 建議 Yw 自己把 `.env` 內容存進密碼管理器之類的安全地方。Claude 不讀、也不在對話顯示正式 `.env`。

### 處理方式

1. 年菜季結束、確認穩定後，Yw 決定方式：
   - 直接推：`cd ~/pos-project && git push origin main`（fast-forward，不需要 force）。
   - 或者在 GitHub 開 PR，把 `feature/nianfai` 合進 main。
2. 推完確認 `git rev-list --count origin/main..main` 是 0。
3. 之後的部署流程照舊：先 commit 到 `feature/nianfai`，再 ff 到正式環境。看要不要改成每次部署後也推 main。
4. `.env` 備份由 Yw 自己處理，完成後在這裡標記。

---

## 5. 正式資料庫開放匿名讀取發票、菜單、庫存紀錄（Vercel 儀表板遺留）

- **記錄日期：** 2026-11-29（dev／正式資料庫結構比對時發現）
- **處理時機：** Yw 確認 Vercel 儀表板還有沒有在用之後
- **狀態：** 待 Yw 決定
- **分類：** 一般營運（資料安全）

### 現況

正式資料庫有 3 條 dev 沒有的權限規則：`invoices`、`menu_items`、`inventory_logs` 各一條「allow anon read」（`for select to public using (true)`）。來源是 `schema.sql` 第 265 行起，註解寫明是給 Vercel 儀表板用的，也寫了風險：

> 拿到儀表板網址的人可讀到全部營業額；改用 report_sessions 後可考慮移除。

- 匿名金鑰（anon key）本來就是設計給前端公開使用的。所以拿到儀表板網址、從網頁裡取得匿名金鑰的人，可以直接讀**所有發票**（金額、品項、時間）、菜單和庫存異動紀錄。
- 另外 `get_orders_customer_count` 是 security definer，也開放給 anon 呼叫，可以繞過 orders 的權限讀到訂單人數。
- WebPOS 本身用 service key，不受這些規則影響。拿掉不會影響 WebPOS、報表頁、錢櫃。

### 儀表板實際用到什麼（2026-11-29 查 `~/webopos-dashboard`，Yw 確認還在用）

儀表板是 Vercel 上的靜態頁 `index.html`，沒有登入，網頁裡帶著匿名金鑰。它讀的資料：

| 讀什麼 | 用途 | 需要的權限 |
|---|---|---|
| `report_sessions` RPC | KPI、期間比較、日趨勢 | 函式本身（不靠 policy） |
| `invoices`（今天的逐張發票：金額、時間、品項、桌號、單號） | 只有「今日各時段」小時圖 | **invoices 匿名讀取**（但規則開放的是全部歷史發票） |
| `get_orders_customer_count` RPC | 今天發票對應的人數 | 函式本身 |
| `menu_items`（庫存類品項的名稱、庫存、門檻） | 庫存區塊 | menu_items 匿名讀取 |
| `inventory_logs` | **沒有用到** | — |

- 週報、月報（GitHub Actions `reports/send-report.js`）只呼叫 RPC。
- 月備份（`monthly-backup.js`）用 service role key，不受 policy 影響。

### 處理方式（建議，儀表板照常可用）

1. **`inventory_logs` 的匿名讀取可以直接拿掉**，沒有任何地方用到：
   `drop policy if exists "allow anon read" on public.inventory_logs;`
2. **發票改成只給今天的小時彙總：**
   - 新增 security definer 函式（例如 `report_today_hourly()`），只回傳今天每小時的營業額、冷凍包金額、人數，沒有單筆發票、品項、單號。
   - 儀表板 `index.html` 的小時圖改呼叫它，`get_orders_customer_count` 也不用了。
   - 確認儀表板正常後，拿掉 invoices 的匿名讀取，並 revoke `get_orders_customer_count` 的 anon 權限。
   - 這樣拿到網址的人最多只看到彙總數字，跟現在 KPI 區塊看到的一樣。
3. **`menu_items` 匿名讀取先保留：** 庫存區塊要用，內容是菜單、價格、庫存，不含營業額或個資。之後要收緊，可以照第 2 點改成函式。
4. **順序：**
   - dev 先建函式、改儀表板本機測試。
   - Yw 在正式 SQL Editor 建函式（只新增，不影響現有）。
   - 部署儀表板（push `webopos-dashboard`，Vercel 自動部署），確認畫面正常。
   - 最後 Yw 執行拿掉 policy 的 SQL。
   - 跑 `data-fixes/schema-fingerprint-1-summary.sql` 更新比對結果。
5. dev 不補這 3 條規則。

### 原本的處理方式（儀表板沒在用時才適用，保留參考）



1. Yw 確認 Vercel 儀表板還有沒有在用。
2. **沒在用：** Yw 在正式 SQL Editor 執行以下 SQL（只拿掉匿名讀取，不動資料）：

   ```sql
   drop policy if exists "allow anon read" on public.invoices;
   drop policy if exists "allow anon read" on public.menu_items;
   drop policy if exists "allow anon read" on public.inventory_logs;
   revoke execute on function public.get_orders_customer_count(integer[]) from anon, authenticated;
   ```

   同時更新 `schema.sql` 的說明，跑完再用 `data-fixes/schema-fingerprint-1-summary.sql` 確認權限規則兩邊都剩 2 條。
3. **還在用：** 改成讓儀表板只呼叫彙總函式（`report_sessions`，不含個資與單筆發票），再拿掉這 3 條。
4. dev 不補這 3 條。


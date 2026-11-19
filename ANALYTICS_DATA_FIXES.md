# 營運資料一致性修正清單（給 Claude Code）

建立日期：2026-11-19
適用範圍：
- `pos-project`：WebPOS，包含 `server.js`、`src/pages/Reports.js`、`InvoiceManagement.js`、`CashDrawer.js`
- `webopos-dashboard`：Vercel 上的 `index.html`，以及 `reports/send-report.js`（GitHub Actions 週報、月報）

目標：同一段期間的營收、來客、訂單數、午晚餐拆分、客單價，四個地方要算出**完全相同**的數字，而且不能因為 Supabase 一次最多回傳 1,000 筆而默默少算。

> 只改計算口徑與資料抓取方式，不要改動既有交易資料。任何資料表變更都要先寫成 migration 檔，並請使用者確認後再執行。

---

## 0. 已確認的決策（不要再改）

| 項目 | 決定 |
| --- | --- |
| 分析起始日 | `2026-06-01`。5/22 以前每週只記錄 2–4 天，而且完全沒有週末，資料不完整 |
| 營收的事實來源 | `invoices.status = '已開立'`。不要用 `orders.total` |
| 營業日 | `invoices.payment_time` 轉成 Asia/Taipei 時區後的日期 |
| 一張訂單 | 至少有一張有效發票的 `orders.id`。分次結帳時一張訂單會有多張發票，一律以 `order_id` 去重 |
| 來客數 | 每張訂單只取一次 `orders.customer_count`（以訂單為準）。**不可**把各張發票上的 `customer_count` 加總：一桌 4 人開 3 張發票，來客是 4 人，不是 12 人 |
| 餐期 | 依開單時間 `orders.timestamp`（台灣時間）：15:45 以前算**午餐**，15:45 以後算**晚餐**。營業時間是 12:00–15:00、16:30–20:00，時間落在營業時間外的單會自動歸到最近的餐期 |
| 冷凍包 | 品項的 `category = '冷凍包'`，含海味XO醬。營收要另外計算，不算在餐點營收內 |
| 營業額 = 實收 | **所有營業額一律用實收**：有效發票 `total` 合計 + `adjustments.amount`（退款為負、補差價為正）。使用者要看的是實際收到的錢 |
| 餐點實收 | 有效發票 `items_snapshot` 各品項 `price × quantity` 的合計（排除冷凍包），再加上該訂單的 adjustments。折扣一律算在餐點這一邊。不可用目前菜單價重算 |
| 客單價 | **餐點實收** ÷ 來客數（內用加外帶，以訂單人數計） |
| 折扣、退款（adjustments） | 日期歸到原發票的營業日，用 `original_invoice_id` 對回訂單 |
| 只買冷凍包的訂單 | 不算來客（這類訂單人數通常是 0） |

---

## 1. 目前各處算法不一致的地方（2026-11-19 檢查）

| 項目 | POS 報表（Reports.js） | Vercel dashboard | 週報、月報（send-report.js） | 修正為 |
| --- | --- | --- | --- | --- |
| 資料是否完整 | ✅ `/api/orders/report` 有用 `fetchAllRows` 分頁 | ❌ `.limit(5000)` 實際最多只拿到最新 1,000 張發票（約 2.5 個月），更早的期間與「vs 上期」比較會少算 | ❌ `rollingInv`（月報抓約 5 個月）與 `histLightInv`（抓 730 天）都超過 1,000 筆，被截斷 | 全部改為分頁抓取，或改用第 2 節的 RPC |
| 午晚餐分界 | 依**結帳**時間：11:00–16:00 算午餐、16:01–22:00 算晚餐 | 依結帳**小時**：11–15 點午餐、16–22 點晚餐 | 同 dashboard；範圍外的單直接被丟掉 | 依開單時間，15:45 分界 |
| 冷凍包判斷 | 讀 `category_settings` 裡的非營業額類別（預設是冷凍包） | 品項 `category === '冷凍包'` | 品項 category，沒有時用**目前菜單的名稱**對照 | 品項 `category = '冷凍包'`；若保留 `category_settings`，三處要讀同一份設定 |
| 客單價分子 | 總額扣掉非營業額品項，未扣折扣 | `aggInvoices` 未扣折扣；`aggSimple`（上期比較用）用**含冷凍包的總額** ❌ | 扣冷凍包、扣折扣 ✅ | 餐點實收 ÷ 來客 |
| 折扣、退款 | 另外列出 | **沒有計入** | 依調整的**建立日**計入 | 依原發票日期計入淨營收 |
| 來客數 | 訂單人數優先 ✅ | 透過 RPC 取訂單人數 ✅ | 透過 service role 取訂單人數 ✅；沒設定金鑰時會改用發票人數 | 一律用訂單人數，抓不到時要報錯，不可靜默改用發票人數 |
| 營業日數 | 有發票的日子 | 有發票的日子 | 有發票的日子 | 改用第 3 節的 `store_calendar` |

預期差異的規模：10 月午餐來客用舊規則算是 295 人、新規則是 296 人，餐期規則的影響很小。主要的錯誤來源是**資料被截斷**與**上期比較的客單價算法**。

---

## 2. 修正方向：共用一個 Supabase RPC（單一來源）

不要在四個地方各自實作同一套算法，改在 Supabase 建立一個 `security definer` 函式，回傳已經彙總好、不含個資的資料，四個地方都呼叫它。彙總後一天只有兩列（午、晚各一），不會碰到 1,000 筆的上限。

```sql
-- migration：supabase/migrations/20261120_report_sessions.sql
-- 回傳每個營業日 × 餐期的彙總，不含任何個資
create or replace function public.report_sessions(p_start date, p_end date)
returns table (
  business_date date,
  meal_period text,          -- 'lunch' | 'dinner'
  orders int,                -- 有有效發票的訂單數
  dine_in_orders int,        -- 內用桌次
  takeout_orders int,
  customers int,             -- 訂單人數加總（不含純冷凍包訂單）
  dine_in_customers int,
  gross_revenue numeric,     -- 有效發票 total 合計（折扣前）
  adjustment_amount numeric, -- 依原發票日期歸屬（退款為負）
  net_revenue numeric,       -- 實收 = gross_revenue + adjustment_amount；畫面上的「營業額」一律用這個
  frozen_revenue numeric,
  meal_net_revenue numeric   -- 餐點實收 = 品項金額（排除冷凍包）+ adjustment_amount；客單價分子
)
language sql security definer set search_path = public as $$
  with inv as (
    select i.* from invoices i where i.status = '已開立'
  ), ord as (
    select o.id, o.order_type, o.customer_count,
           (min(i.payment_time) at time zone 'Asia/Taipei')::date as business_date,
           case when ((o.timestamp at time zone 'Asia/Taipei')::time < time '15:45')
                then 'lunch' else 'dinner' end as meal_period,
           sum(i.total) as gross
    from orders o join inv i on i.order_id = o.id
    group by o.id
  ), items as (
    select i.order_id,
           sum(case when it->>'category' = '冷凍包' then (it->>'price')::numeric * coalesce((it->>'quantity')::numeric,1) else 0 end) as frozen,
           sum(case when coalesce(it->>'category','') <> '冷凍包' then (it->>'price')::numeric * coalesce((it->>'quantity')::numeric,1) else 0 end) as meal
    from inv i, jsonb_array_elements(coalesce(i.items_snapshot,'[]')) it
    group by i.order_id
  ), adj as (
    select i.order_id, sum(a.amount) as amount
    from adjustments a join inv i on i.id = a.original_invoice_id group by i.order_id
  )
  select o.business_date, o.meal_period,
         count(*)::int,
         count(*) filter (where o.order_type = '內用')::int,
         count(*) filter (where o.order_type = '外帶')::int,
         coalesce(sum(o.customer_count) filter (where coalesce(it.meal,0) > 0),0)::int,
         coalesce(sum(o.customer_count) filter (where o.order_type = '內用' and coalesce(it.meal,0) > 0),0)::int,
         sum(o.gross),
         coalesce(sum(adj.amount),0),
         sum(o.gross) + coalesce(sum(adj.amount),0),
         coalesce(sum(it.frozen),0),
         coalesce(sum(it.meal),0) + coalesce(sum(adj.amount),0)
  from ord o left join items it on it.order_id = o.id left join adj on adj.order_id = o.id
  where o.business_date between p_start and p_end
  group by 1, 2 order by 1, 2;
$$;
grant execute on function public.report_sessions(date, date) to anon, authenticated;
```

> 上面函式的查詢主體已在 2026-11-19 以唯讀 SELECT 在正式資料庫執行過，2026 年 10 月的結果與第 7 節驗收數字完全一致。之後加上的 `net_revenue`、`meal_net_revenue` 只是把已驗證的欄位相加。建立函式（`create function`）屬於資料庫變更，請使用者確認後再執行。

每個地方怎麼改：

- **`webopos-dashboard/index.html`**：KPI、午晚餐分頁、上期比較改用 `sb.rpc('report_sessions', …)`。小時分佈圖仍需要逐張發票時，必須分頁抓取（`range(from, to)` 迴圈），不可依賴 `.limit()`。刪除 `aggSimple`，或讓它改用餐點營收。
- **`reports/send-report.js`**：本期、上期、滾動平均、歷史排名都改用 RPC。品項排行仍需要逐張發票時，用 `Range` header 分頁。抓不到訂單人數時要中止並發出錯誤通知，不可靜默改用發票人數。
- **`pos-project/server.js`**：新增 `/api/report/sessions?start=&end=`，轉呼叫 RPC；`/api/orders/report` 的回傳加上 `openedAt`（`orders.timestamp`）。
- **`src/pages/Reports.js`**：`applyTimeSlot` 與 KPI 的午晚餐判斷改用 `openedAt` 和 15:45 分界；KPI 改用 sessions API。
- **`InvoiceManagement.js`、`CashDrawer.js`**：屬於帳務用途，以發票與結帳時間為準是正確的，不需要改；但畫面上的「營業額」要和 RPC 的 `net_revenue` 對得上。
- 四個地方顯示的「營業額」與「客單價」一律改用 `net_revenue` 與 `meal_net_revenue ÷ customers`。

---

## 3. WebPOS 需要新增或修正的功能

| # | 項目 | 原因 | 做法 |
| --- | --- | --- | --- |
| 3.1 | **店休與只休午餐** | 店休日期目前只存在 `app_settings.store_holiday_dates` 這一個 JSON 字串，從 2026/7/15 才開始記，也無法表示「只休午餐」（例如 6/2、10/2）。缺了這個，就沒辦法區分「沒開店」和「沒客人」 | 新增 `store_calendar(date primary key, lunch_open bool, dinner_open bool, note text)`，在 POS 設定頁可以標記全天休或只休午餐、晚餐。把 `store_holiday_dates` 現有的日期轉進新表。報表的營業日數與場次改依此表計算 |
| 3.2 | **入座與清桌時間** | 入座時間的定義是「開單到清桌」。目前清桌時間只能用 `orders.updated_at` 推估，但作廢、合併等操作也會更新它 | 未來功能：`orders` 新增 `cleared_at`（`/api/tables/:t/reset` 時寫入）；入座時間沿用開單時間 `orders.timestamp` |
| 3.5 | **併桌與桌位人數**（未來功能） | 一張訂單只記一個桌號，但實際會發生：多人組併桌（記 A7，實際坐 A6+A7）、兩人點太多改坐兩張兩人桌、有空位就多給一桌。所以目前算不出正確的翻桌率，也無法判斷各桌的實際使用率 | ① 桌位人數設定：A5、A8 是四人桌，A1–A4、A6、A7 是兩人桌，合計 20 席。② 訂單可記錄多張桌子（例如 `tables_used text[]`），併桌、加桌時點一下即可。③ 報表只在**客滿時段**計算：客滿次數與時長，以及客滿時的座位效率（入座人數 ÷ 20 席）。非客滿時段多給一桌不影響營收，不需要計算翻桌率 |
| 3.6 | **客滿婉拒／候位次數**（未來功能） | 客滿時的流失需求目前完全沒有紀錄，這是判斷「假日晚餐是否真的到頂」最直接的資料 | 在 POS 加一個「客滿婉拒」按鈕，按一下記一筆：時間、人數（選填）、婉拒或候位。報表只需每個餐期的次數與人數 |
| 3.3 | **人數以訂單為準** | 有 132 張訂單的發票人數和訂單人數不同，多半是發票多 1 人，代表結帳後人數被改過 | 報表一律讀 `orders.customer_count`（第 0 節）。不需要鎖定人數，但若結帳後改人數，可在 `inventory_logs` 類似的表留一筆紀錄（選做） |
| 3.4 | `invoices.payment_method` 一直是空的 | 目前只收現金，沒有影響 | 若未來加入其他付款方式，要開始寫入這個欄位 |

---

## 4. schema.sql 與 migrations

**現況**：`schema.sql` 是手寫的建表腳本，但資料庫後來又在 Supabase 後台或程式中加了欄位，這份檔案沒有同步更新。實際與檔案不同的地方：

- `customers` 多了 `name`、`phone`、`email`，原本的 `names`、`phones` 陣列也還在
- `invoices` 多了 `payment_method`、`items`（舊欄位）
- `orders.send_time`、`finish_time` 實際是 `bigint`，`order_date` 是 `text`
- `adjustments` 完全不在檔案內（`id uuid`、`amount numeric`、`affected_items jsonb`）
- `menu_items.price`、`sort_order`、`stock` 實際是 `numeric`，`consumes` 是 `jsonb`

照這份 `schema.sql` 重建資料庫，程式會出錯。

**修正**：

1. 從正式資料庫重新產生 schema，二選一：
   - `npx supabase db dump --schema-only --db-url "$SUPABASE_DB_URL" > supabase/schema.sql`（需要 Docker，這台 2015 MacBook 跑起來可能吃力）
   - 或請 Claude Code 依 `information_schema.columns` 的查詢結果手動重寫 `schema.sql`，再由使用者到 SQL Editor 比對
2. 之後任何資料表變更都寫成 `supabase/migrations/YYYYMMDD_說明.sql`，不要再直接在後台改。
3. 把 `init.sql` 與 `schema.sql` 尾段的 TRUNCATE 移到 `scripts/danger/`，檔名註明會清空資料，執行前要先備份。

---

## 5. 定期備份

目前專案是 Supabase **Free** 方案（2026-11-19 確認），沒有可下載的每日備份，所以要自己做。

**使用者的決定：每月把全部資料表匯出成 CSV，寄到信箱備存。**

做法：在 `webopos-dashboard` 新增 `reports/monthly-backup.js` 與 `.github/workflows/monthly-backup.yml`，沿用週報現有的 Gmail 寄信設定（`GMAIL_APP_PASSWORD`）與 `SUPABASE_SERVICE_ROLE_KEY`。

1. **排程**：每月 1 日台灣時間 09:00，在午餐開店前；cron 寫成 `0 1 1 * *`（UTC）。另保留 `workflow_dispatch`，可以手動觸發。
2. **匯出**：`orders`、`invoices`、`adjustments`、`menu_items`、`customers`、`app_settings`、`inventory_logs`、`remark_groups`、`tables`，每張表一個 CSV。一律用 `Range` header 分頁抓完，不可受 1,000 筆上限影響；每張表的筆數寫進信件內文，方便核對。
3. **壓縮並加密**：打包成 `gugu_backup_YYYY-MM.zip`，用 AES 加密（例如 `7z a -p"$BACKUP_PASSWORD" -mhe=on`），密碼存成 GitHub secret `BACKUP_PASSWORD`，請使用者另外抄下保存。備份含有客人姓名、電話、email，不可寄送未加密的檔案。
4. **寄送**：寄到使用者信箱，主旨例如「咕咕義資料備份 2026-11」。目前資料約 7.5 MB，每月約增加 1 MB；超過 20 MB 時改為只寄當月新增或變動的資料，並通知使用者。
5. **失敗處理**：任何一張表抓取失敗或筆數為 0，就寄出錯誤通知，不要寄出不完整的備份。

還原方式：解壓縮後用 Supabase Table Editor 的 Import CSV，或寫一個一次性的匯入腳本。還原前一定要先確認目標資料庫。

**手動備份（做任何資料修正之前）**：在 SQL Editor 執行，結果用 Export → Download CSV 存下：

```sql
select 'orders' t, count(*) n, json_agg(x order by x.id)::text d from orders x
union all select 'invoices', count(*), json_agg(x order by x.id)::text from invoices x
union all select 'adjustments', count(*), json_agg(x order by x.created_at)::text from adjustments x
union all select 'menu_items', count(*), json_agg(x order by x.id)::text from menu_items x
union all select 'customers', count(*), json_agg(x order by x.id)::text from customers x
union all select 'app_settings', count(*), json_agg(x order by x.key)::text from app_settings x;
```

---

## 6. 報表輸出分成兩部分

### 6A. 給經營者看的畫面（WebPOS 報表、Vercel dashboard）

目標是一眼看出每天收了多少錢，只放必要資訊，全部用第 2 節的 RPC 計算：

| 項目 | 全天 | 午餐 | 晚餐 |
| --- | --- | --- | --- |
| 實收營業額（不含冷凍包） | ✓ | ✓ | ✓ |
| 來客數 | ✓ | ✓ | ✓ |
| 客單價（餐點實收 ÷ 來客） | ✓ | ✓ | ✓ |
| 冷凍包營業額（另列） | ✓ | | |

另外加一個比較基準：「和前 4 週同一個星期幾的平均相比」的增減百分比。其他細節不要放在這個畫面，交給 6B 由 AI 分析。

### 6B. 下載分析 CSV（只放在 WebPOS）

- 在 WebPOS 報表頁新增「下載分析資料」按鈕：選日期區間（預設從 2026-06-01 到今天），下載 `gugu_analysis_YYYYMMDD-YYYYMMDD.zip`。
- **不要放在 Vercel**：Vercel 頁面是公開網址，拿到連結的人就能下載全部營運資料（使用者已確認）。
- 壓縮檔內含下面三份 CSV，加上一份 `DATA_DICTIONARY.md`（內容就是第 0 節的定義），讓 AI 每次都用同樣的定義解讀。
- 用途：讓 AI 分析午餐與晚餐、平日與假日、不同月份的差異，以及營業額是否在下滑。

分析固定只需要以下三份資料，全部不含個資：

| 檔案 | 一列 = | 欄位 |
| --- | --- | --- |
| `meal_period_sessions.csv` | 一個營業日 × 餐期 | `business_date, weekday, day_type, meal_period, is_open, dine_in_orders, dine_in_customers, takeout_orders, customers, net_revenue, meal_net_revenue, frozen_revenue` |
| `order_items.csv` | 一個品項行 | `order_id, business_date, meal_period, order_type, menu_item_id, item_name, display_category（主餐 / 小點 / 飲品 / 冷凍包）, unit_price, quantity, line_revenue` |
| `orders_fact.csv` | 一張訂單 | `order_id, business_date, meal_period, opened_at, order_type, table_number, customer_count, net_revenue, meal_net_revenue, frozen_revenue, meal_item_qty` |

`order_items.line_revenue` 是品項原價（折扣前），用來分析品項組成；營業額與客單價一律以 sessions 與 orders_fact 的實收欄位為準。

外部事件（廣告設定變更、菜單調價、營業時間變動）只需要一份手動紀錄，三個欄位就夠：`date, change, note`。

**不再保留**：`daily_operations`（可由 sessions 彙總）、`adjustments.csv`（6 個月只有 5 筆、合計 −$165）、發票張數、`has_*` 旗標、作廢與棄單數。

**一律排除的個資**：`customers` 整張表、`orders.customer_name`、`customer_phone`、`customer_id`、`special_notes`、`pickup_time`、`items[].remarks`、`adjustments.reason_note`、`customers.email`。

---

## 7. 驗收數字（用 2026-11-19 匯出的資料、依第 0 節規則算出）

修正後，POS 報表、Vercel dashboard、週報或月報、RPC 對同一期間都要得到以下數字：

| 期間 | 營業日 | 訂單 | 來客 | 實收營業額 | 冷凍包 | 餐點實收 | 客單價 | 午餐來客 / 餐點實收 | 晚餐來客 / 餐點實收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-05（四）～11-11（三） | 6 | 113 | 228 | $81,145 | $3,280 | $77,865 | $342 | 76 / $25,725 | 152 / $52,140 |
| 2026-10-01～10-31 | 24 | 424 | 844 | $300,425 | $13,400 | $287,025 | $340 | 296 / $102,690 | 548 / $184,335 |
| 2026-07-01～07-31（含折扣） | 23 | 415 | 872 | $309,405 | $16,720 | $292,685 | $336 | 306 / $102,955 | 566 / $189,730 |

11 月與 10 月這兩段沒有折扣、退款，所以實收等於發票金額。7 月是用來驗證折扣有沒有正確扣除：發票合計 $309,575，當月 3 筆調整合計 −$170（7/6 −$35、7/20 −$35、7/30 −$100），實收是 $309,405。三段期間只買冷凍包的訂單，人數都是 0。

---

## 8. 安全事項（請使用者手動處理）

- 2026-11-19 的分析過程中，`.env` 裡的 Supabase secret key 出現在對話紀錄裡，也曾在瀏覽器被使用（被 Supabase 拒絕）。請到 Supabase 重新產生，再更新 `.env` 和 GitHub secret `SUPABASE_SERVICE_ROLE_KEY`。
- `webopos-dashboard/index.html` 內含 anon key，而 `invoices` 開放用 anon key 讀取，所以拿到這個網址的人可以讀到全部營業額與品項。若網址可能外流，可改成只透過 `report_sessions` 這個 RPC 讀取彙總資料，並關閉 `invoices` 的 anon 讀取權限（Vercel 頁面要同步修改）。

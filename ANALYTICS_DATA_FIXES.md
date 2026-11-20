# 營運資料一致性修正清單（給 Claude Code）

建立日期：2026-11-19 ｜ 最後更新：2026-11-20

適用範圍：
- `pos-project`：WebPOS，包含 `server.js`、`src/pages/Reports.js`、`InvoiceManagement.js`、`CashDrawer.js`
- `webopos-dashboard`：Vercel 上的 `index.html`，以及 `reports/send-report.js`（GitHub Actions 週報、月報）

目標：同一段期間的營收、來客、訂單數、午晚餐拆分、客單價，四個地方要算出**完全相同**的數字，而且不能因為 Supabase 一次最多回傳 1,000 筆而默默少算。

> 只改計算口徑與資料抓取方式，不要改動既有交易資料。任何資料表變更都要先寫成 migration 檔，並請使用者確認後再執行。

---

## 進度總覽（2026-11-20）

### ✅ 已完成

- **第 1、2 節**：四個地方（POS 報表、Vercel dashboard、週報/月報、WebPOS）的營業額／客單價／來客數全部改用 `report_sessions` RPC，不再各自計算。
- **第 3 節**：`store_calendar` 店休日曆（含只休午餐/晚餐、設定頁）、`orders.cleared_at`／`tables_used`（入座清桌時間、併桌記錄）、客滿婉拒／候位按鈕，全部上線。
- **第 5 節**：`webopos-dashboard` 每月備份（`monthly-backup.js` + GitHub Actions，7z 加密、上傳 Artifact）已上線。
- **第 6A/6B 節**：報表頁 KPI 卡片、「下載分析資料」（`meal_period_sessions.csv`／`order_items.csv`／`orders_fact.csv`／`external_events.csv`／`daily_traffic.csv`／`DATA_DICTIONARY.md`）全部上線。
- **第 9 節**：`report_items`／`report_attach` RPC 已建立並套用到 dev + prod；`order_items.csv` 改由 `report_items` 產生。
- **第 10 節**：新舊客紀錄——POS 開單標記、報表新客／舊客統計卡片、`daily_traffic.csv` 的新舊客欄位，全部完成。
- **效能（2026-11-20 新增項目，原文件沒有）**：報表頁、發票管理頁、關帳頁原本每次進頁面都無條件抓全部歷史發票，隨營業時間增長越來越慢。改成：
  - `report_sessions`、`/api/orders/report`、`/api/invoices` 都改成按需要的日期範圍抓取，不夠才動態擴大重抓。
  - 新增 `report_order_invoices` RPC，把原本「先查發票、再依 order_id 查訂單」兩次依序查詢合併成資料庫端一次 join。
  - 報表頁拿掉整頁阻擋式 loading，改成分兩階段載入（先顯示「今天」、背景補齊比較基準），進頁面立刻看到版面與數字。
  - `fetchAllRowsParallel`：筆數超過單頁上限時，先查總筆數再平行分頁，取代逐頁循序等待。

### ⬜ 刻意不做／使用者已決定

- 10.1 原本規劃的「關帳時若有未標記訂單要提醒經營者補標」：**已取消**。開單已預設新客，正常情況不會再出現未標記訂單（上線前的舊資料除外，本來就刻意不回補），不需要這個提醒。
- 10.4 舊試算表資料（2026/3 起的每日新客數、廣告花費）維持不匯入 `orders`。

### ⬜ 還沒做（需要使用者再確認才進行）

- **第 8 節**：Supabase service role key 重新產生（安全事項，使用者手動處理）。
- **第 9 節**：POS「銷售排行」頁、週報 email 的品項排行／加點率邏輯改用 `report_items`／`report_attach`——**已明確決定先不做**，這兩個功能目前各自重算但運作正常，風險與效益不成比例，之後有需要再評估。
- **第 9 節選配**：`menu_items` 新增 `cost`（食材成本）欄位，需要使用者提供各品項成本後才做。
- **第 11 節（新增）**：見下方，把四個報表 RPC 共用的查詢邏輯整合成一個共同的基礎定義。

---

## 11. 待處理：把報表用的 RPC 整合成共同的基礎定義

**背景**：2026-11-20 的效能修正新增了 `report_order_invoices`，加上原本就有的 `report_sessions`、`report_items`、`report_attach`，目前共有 **4 個獨立的 SQL 函式**，但每一個都各自重複定義同一段「有效發票（`status = '已開立'`）＋ 以 `payment_time` 轉台灣時區得出 `business_date` ＋ 以 `orders.timestamp` 15:45 分界得出 `meal_period`」的 join 邏輯。

**風險**：四段邏輯分開寫、分開維護，之後若要調整定義（例如餐期分界時間、營業日判斷方式），很容易改了一個函式卻漏改其他三個，導致四個地方的數字又開始不一致——這正是最初第 1 節想解決的問題，現在用多個 RPC 的方式又在資料庫端重演一次。

**做法（建議，尚未實作）**：抽出一個共用的 SQL view 或函式（例如 `report_base_orders`），只做「有效發票 join 訂單、算出 business_date／meal_period」這一步，讓 `report_sessions`、`report_items`、`report_attach`、`report_order_invoices` 都改成在這個共用結果上面做各自的彙總，而不是各自重新 join 一次。改動前要先確認效能不會因為多一層 view 而變差（尤其 `report_order_invoices` 現在是未分頁單一 join，速度敏感）。

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
| 只買冷凍包的訂單 | 不算來客，也不算組數（這類訂單人數通常是 0） |
| 組數 | 有有效發票、且有餐點的訂單數（內用 + 外帶）。已用 2026-11-05～11-11 驗證：與手動 Traffic Record 的全日組數 111、全日人數 228 完全相同 |
| 新客／舊客 | 以「組」為單位，存在 `orders.is_new_group`：新客組 true、舊客組 false。組內只要有一人來過就是舊客組（視為回頭客推薦，不算廣告帶來的轉換）；沒印象、確定沒來過或不常來的，視為新客。由同一位經營者依印象判斷，可以隨時修改。新客人數 = 新客組的人數合計；新客 + 舊客 = 全部人數與組數，午晚餐分開計算 |

---

## 1. 目前各處算法不一致的地方（2026-11-19 檢查，已於 2026-11-19～20 全部修正）

| 項目 | POS 報表（Reports.js） | Vercel dashboard | 週報、月報（send-report.js） | 修正為 |
| --- | --- | --- | --- | --- |
| 資料是否完整 | ✅ `/api/orders/report` 有用分頁 | ❌ `.limit(5000)` 實際最多只拿到最新 1,000 張發票 | ❌ `rollingInv`、`histLightInv` 都超過 1,000 筆，被截斷 | ✅ 全部改用 `report_sessions` RPC |
| 午晚餐分界 | 依結帳時間 | 依結帳小時 | 同 dashboard | ✅ 依開單時間，15:45 分界 |
| 冷凍包判斷 | 讀 `category_settings` | 品項 category | 品項 category，對照目前菜單 | ✅ 統一讀品項 `category = '冷凍包'` |
| 客單價分子 | 未扣折扣 | 含冷凍包的總額 ❌ | 扣冷凍包、扣折扣 ✅ | ✅ 餐點實收 ÷ 來客 |
| 折扣、退款 | 另外列出 | 沒有計入 | 依建立日計入 | ✅ 依原發票日期計入淨營收 |
| 來客數 | 訂單人數優先 ✅ | 透過 RPC 取訂單人數 ✅ | 抓不到金鑰時會靜默改用發票人數 | ✅ 一律用訂單人數 |
| 營業日數 | 有發票的日子 | 有發票的日子 | 有發票的日子 | ✅ 改用 `store_calendar` |

---

## 2. 共用 RPC：`report_sessions`（已上線）

四個地方（POS 報表、Vercel dashboard、週報月報、分析 CSV）的營業額／客單價／來客數都改由 `report_sessions(p_start, p_end)` 計算，不再各自重算。函式定義見 `supabase/migrations/20261119_analytics_foundation.sql`（基礎版）與 `20261119b_new_returning_customers.sql`（加入新舊客欄位後的版本，為目前線上實際使用的版本）。

---

## 3. WebPOS 功能（已上線）

| # | 項目 | 狀態 |
| --- | --- | --- |
| 3.1 | 店休與只休午餐（`store_calendar`，設定頁可標記） | ✅ 已上線 |
| 3.2 | 入座與清桌時間（`orders.cleared_at`） | ✅ 已上線 |
| 3.5 | 併桌與桌位人數（`tables.seats`、`orders.tables_used`） | ✅ 已上線 |
| 3.6 | 客滿婉拒／候位次數（`turnaways` 表 + 桌況頁按鈕） | ✅ 已上線 |
| 3.3 | 人數以訂單為準 | ✅ 已內建在 `report_sessions` 的定義裡 |
| 3.4 | `invoices.payment_method` 一直是空的 | 目前只收現金，沒有影響，暫不處理 |

---

## 4. schema.sql 與 migrations

`schema.sql` 已依正式資料庫重新產生並保持同步。之後任何資料表變更都寫成 `supabase/migrations/YYYYMMDD_說明.sql`，不要直接在 Supabase 後台改。

---

## 5. 定期備份（已上線）

`webopos-dashboard/reports/monthly-backup.js` + `.github/workflows/monthly-backup.yml`：每月 1 日台灣時間跑一次，匯出全部資料表成 CSV、用密碼保護的 7z 壓縮，透過 GitHub Actions Artifact 提供下載，寄一封含連結的通知信（不含附件，避免 Gmail 擋信）。

**手動備份（做任何資料修正之前）**：在 Supabase SQL Editor 執行，結果用 Export → Download CSV 存下：

```sql
select 'orders' t, count(*) n, json_agg(x order by x.id)::text d from orders x
union all select 'invoices', count(*), json_agg(x order by x.id)::text from invoices x
union all select 'adjustments', count(*), json_agg(x order by x.created_at)::text from adjustments x
union all select 'menu_items', count(*), json_agg(x order by x.id)::text from menu_items x
union all select 'customers', count(*), json_agg(x order by x.id)::text from customers x
union all select 'app_settings', count(*), json_agg(x order by x.key)::text from app_settings x;
```

---

## 6. 報表輸出（已上線）

### 6A. 給經營者看的畫面（WebPOS 報表、Vercel dashboard）

營業額、來客數、客單價、冷凍包營業額（全天／午餐／晚餐），加上新舊客統計（見第 10 節）與「和前 4 週同一個星期幾的平均相比」的增減百分比。全部用 `report_sessions` 計算。

### 6B. 下載分析 CSV（只放在 WebPOS）

報表頁「下載分析資料」按鈕，下載 `gugu_analysis_YYYYMMDD-YYYYMMDD.zip`，內含 `meal_period_sessions.csv`、`order_items.csv`、`orders_fact.csv`、`external_events.csv`、`daily_traffic.csv`、`DATA_DICTIONARY.md`。欄位定義見 `server.js` 的 `DATA_DICTIONARY_MD`。

**一律排除的個資**：`customers` 整張表、`orders.customer_name`、`customer_phone`、`customer_id`、`special_notes`、`pickup_time`、`items[].remarks`、`adjustments.reason_note`、`customers.email`。

---

## 7. 驗收數字（用 2026-11-19 匯出的資料、依第 0 節規則算出，供日後回歸測試參考）

| 期間 | 營業日 | 訂單 | 來客 | 實收營業額 | 冷凍包 | 餐點實收 | 客單價 | 午餐來客 / 餐點實收 | 晚餐來客 / 餐點實收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-05（四）～11-11（三） | 6 | 113 | 228 | $81,145 | $3,280 | $77,865 | $342 | 76 / $25,725 | 152 / $52,140 |
| 2026-10-01～10-31 | 24 | 424 | 844 | $300,425 | $13,400 | $287,025 | $340 | 296 / $102,690 | 548 / $184,335 |
| 2026-07-01～07-31（含折扣） | 23 | 415 | 872 | $309,405 | $16,720 | $292,685 | $336 | 306 / $102,955 | 566 / $189,730 |

7 月用來驗證折扣有沒有正確扣除：發票合計 $309,575，當月 3 筆調整合計 −$170，實收是 $309,405。三段期間只買冷凍包的訂單，人數都是 0。

---

## 8. 安全事項（請使用者手動處理，尚未確認完成）

- `.env` 裡的 Supabase service role key 曾經在對話紀錄中出現、也曾在瀏覽器被使用過（被 Supabase 拒絕）。請到 Supabase 重新產生，再更新 `.env` 和 GitHub secret `SUPABASE_SERVICE_ROLE_KEY`。
- `webopos-dashboard/index.html` 內含 anon key，而 `invoices` 開放用 anon key 讀取，拿到這個網址的人可以讀到全部營業額與品項。若網址可能外流，可改成只透過 `report_sessions` RPC 讀取彙總資料，並關閉 `invoices` 的 anon 讀取權限。

---

## 9. 品項分析用的函式（已建立，部分套用）

`report_items`、`report_attach` 已建立並套用到 dev + prod（見 `supabase/migrations/20261120_report_items.sql`），與 `report_sessions` 共用相同的有效發票、營業日、餐期定義。

**已套用**：WebPOS「下載分析資料」的 `order_items.csv` 改由 `report_items` 產生（grain 從「每筆品項行」改為「日×餐期×內用外帶×品項×單價」彙總，新增 `orders_with_item` 欄位）。

**已決定暫不做**：POS「銷售排行」頁（`Reports.js` 的 `RankingTab`）與週報 email 的品項排行／加點率邏輯，目前都是各自獨立計算但運作正常，改用新 RPC 屬於中～大型重構，風險與效益不成比例，先維持現狀。

**選配、尚未做**：`menu_items` 新增 `cost numeric`（每份食材成本）。成本若會變動，結帳時也要寫進 `items_snapshot` 的 `cost`，歷史毛利才不會被之後的調整蓋掉。需要使用者提供各品項的成本後才做。

---

## 10. 新舊客紀錄：取代手動的 Traffic Record 試算表（已上線）

目標：WebPOS 自動產生和 `2026_11_Traffic_Record.xlsx` 相同的客流資料，取代手動填試算表。

### 10.1 POS：在訂單上標記新客／舊客 ✅ 已上線

- 開單／點餐畫面有「新客／舊客」切換按鈕，操作方式比照人數設定：隨時可以改，結帳前、結帳後都可以。
- 開單時預設為新客（`is_new_group = true`），認出是熟客就切換成舊客。寫入方式：`PATCH /api/orders/:id`。
- 內用與外帶都有這個按鈕。併單時，以保留下來的那張訂單為準，任一張是舊客、合併後就是舊客。
- 上線前的訂單一律是空值（null），不回補。

### 10.2 經營者畫面（WebPOS 報表） ✅ 已上線

報表頁新增新客／舊客卡片：全天、午餐、晚餐分開顯示新客人數／組數、舊客人數／組數、新客比例；有未標記的訂單時顯示「未標記 N 組」。

### 10.3 下載客流 CSV ✅ 已上線

分析匯出壓縮檔內加入 `daily_traffic.csv`，一天一列（含店休日），欄位比照 11 月 Traffic Record。欄位定義見 `server.js` 的 `DATA_DICTIONARY_MD`。

**建議並行 2 週**：上線後兩週內，試算表與 POS 同時記錄，比對每天的人數、組數、新客數；一致後再停用試算表。

### 10.4 舊資料（維持不做）

舊的試算表（2026/3 起的每日新客數、廣告花費）暫不匯入。若之後要比較，另外建一張獨立的歷史表匯入，**不要寫進 orders**。

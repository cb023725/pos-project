-- init.sql
-- 開始營業初始化
-- 保留：menu_items / remark_groups / customers / app_settings 設定值
-- 清除：orders / invoices / inventory_logs / 桌況 / 點餐暫存

-- 清除發票（FK 參考 orders，需先刪）
TRUNCATE TABLE invoices RESTART IDENTITY CASCADE;

-- 清除訂單
TRUNCATE TABLE orders RESTART IDENTITY CASCADE;

-- 清除庫存異動記錄
TRUNCATE TABLE inventory_logs RESTART IDENTITY;

-- 重置桌況
UPDATE tables SET status = 'idle', order_id = NULL, updated_at = NOW();

-- 清除點餐暫存（保留 category_settings / quick_tags / reserve_amount）
DELETE FROM app_settings WHERE key IN ('pending_transactions', 'last_close_time', 'last_close_order_id');

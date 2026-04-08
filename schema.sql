-- schema.sql
-- 在 Supabase SQL Editor 執行此腳本，建立或補齊所有資料表欄位
-- 可安全重複執行（使用 IF NOT EXISTS）

-- ================================================================
-- menu_items
-- ================================================================
CREATE TABLE IF NOT EXISTS menu_items (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    price       INTEGER,
    category    TEXT,
    sort_order  INTEGER DEFAULT 99,
    print_name  TEXT DEFAULT '',
    sold_out    BOOLEAN DEFAULT FALSE,
    stock       INTEGER,
    consumes    TEXT[],
    image_url   TEXT,
    thresholds  JSONB DEFAULT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 補齊舊版資料表缺少的欄位
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS thresholds JSONB DEFAULT NULL;

-- ================================================================
-- remark_groups
-- ================================================================
CREATE TABLE IF NOT EXISTS remark_groups (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT DEFAULT 'single',
    required        BOOLEAN DEFAULT FALSE,
    options         JSONB DEFAULT '[]',
    applies_to      JSONB DEFAULT '[]',
    option_item_map JSONB DEFAULT '{}',
    sort_order      INTEGER DEFAULT 99,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- tables
-- ================================================================
CREATE TABLE IF NOT EXISTS tables (
    table_number  TEXT PRIMARY KEY,
    status        TEXT DEFAULT 'idle',
    order_id      INTEGER,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- orders
-- ================================================================
CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    table_number    TEXT,
    order_type      TEXT DEFAULT '內用',
    status          TEXT DEFAULT 'open',
    items           JSONB DEFAULT '[]',
    total           INTEGER DEFAULT 0,
    sub_total       INTEGER DEFAULT 0,
    paid_amount     INTEGER DEFAULT 0,
    daily_order_no  INTEGER DEFAULT 1,
    customer_count  INTEGER DEFAULT 1,
    customer_name   TEXT DEFAULT '',
    customer_phone  TEXT DEFAULT '',
    customer_id     INTEGER,
    needs_utensils  BOOLEAN DEFAULT FALSE,
    pickup_time     TEXT,
    send_time       TEXT,
    finish_time     TEXT,
    order_date      TIMESTAMPTZ,
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- invoices
-- ================================================================
CREATE TABLE IF NOT EXISTS invoices (
    id              SERIAL PRIMARY KEY,
    invoice_number  TEXT,
    order_id        INTEGER REFERENCES orders(id),
    status          TEXT DEFAULT '已開立',
    amount          INTEGER DEFAULT 0,
    total           INTEGER DEFAULT 0,
    items           JSONB DEFAULT '[]',
    items_snapshot  JSONB DEFAULT '[]',
    table_name      TEXT DEFAULT '',
    order_type      TEXT DEFAULT '內用',
    daily_order_no  INTEGER DEFAULT 1,
    customer_count  INTEGER DEFAULT 1,
    payment_time    TIMESTAMPTZ,
    void_time       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- customers
-- ================================================================
CREATE TABLE IF NOT EXISTS customers (
    id          SERIAL PRIMARY KEY,
    names       TEXT[] DEFAULT '{}',
    phones      TEXT[] DEFAULT '{}',
    notes       TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- app_settings
-- ================================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- inventory_logs
-- ================================================================
CREATE TABLE IF NOT EXISTS inventory_logs (
    id            SERIAL PRIMARY KEY,
    item_id       TEXT,
    item_name     TEXT,
    change_amount INTEGER DEFAULT 0,
    note          TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 完成
-- ================================================================
SELECT 'Schema 建立/補齊完成 ✅' AS result;


-- ================================================================
-- ██████████████████████████████████████████████████████████████
-- 開始營業初始化（僅在需要時執行，會清除點餐資料）
-- ██████████████████████████████████████████████████████████████
-- 保留：menu_items（含庫存數量/threshold/consumes）、remark_groups、
--       customers、app_settings（category_settings/quick_tags/reserve_amount）
-- 清除：orders、invoices、inventory_logs、桌況、pending_transactions、關帳紀錄
-- ================================================================

-- 清除訂單（先清 invoices 因有 FK 參考 orders）
-- TRUNCATE TABLE invoices RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE orders   RESTART IDENTITY CASCADE;

-- 重置桌況
-- UPDATE tables SET status = 'idle', order_id = NULL, updated_at = NOW();

-- 清除庫存異動記錄
-- TRUNCATE TABLE inventory_logs RESTART IDENTITY;

-- 清除 app_settings 中的點餐相關暫存
-- DELETE FROM app_settings WHERE key IN ('pending_transactions', 'last_close_time', 'last_close_order_id');

-- 確認結果
-- SELECT 'orders', COUNT(*) FROM orders
-- UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
-- UNION ALL SELECT 'inventory_logs', COUNT(*) FROM inventory_logs
-- UNION ALL SELECT 'tables (non-idle)', COUNT(*) FROM tables WHERE status != 'idle'
-- UNION ALL SELECT 'app_settings', COUNT(*) FROM app_settings;

-- 0027_is_test_supply_chain.sql
-- 供应链与顾客订单测试数据标记：所有业务表增加 is_test，历史数据全部为 false。
-- 清理接口只删除 is_test = true 的行；子表由主表生成时继承标记。
-- 加法迁移，可回滚，不删列删表。

BEGIN;

ALTER TABLE shops                     ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE warehouses                ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE suppliers                 ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE shop_suppliers            ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE catalog_skus              ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE product_skus              ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE product_stocks            ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE product_sku_stocks        ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE warehouse_stocks          ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE stock_movements           ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE shop_requisitions         ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE shop_requisition_items    ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE demand_plans              ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE demand_plan_items         ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_orders           ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_order_items      ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE orders                    ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE order_items               ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE order_payments            ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE document_events           ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- 部分索引：清理时只扫测试行，避免全表扫描
CREATE INDEX IF NOT EXISTS shops_is_test_idx              ON shops (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS warehouses_is_test_idx         ON warehouses (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS suppliers_is_test_idx          ON suppliers (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS product_skus_is_test_idx       ON product_skus (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS product_sku_stocks_is_test_idx ON product_sku_stocks (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS warehouse_stocks_is_test_idx   ON warehouse_stocks (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS stock_movements_is_test_idx    ON stock_movements (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS shop_requisitions_is_test_idx  ON shop_requisitions (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS demand_plans_is_test_idx       ON demand_plans (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS purchase_orders_is_test_idx    ON purchase_orders (is_test) WHERE is_test;
CREATE INDEX IF NOT EXISTS orders_is_test_idx             ON orders (is_test) WHERE is_test;

-- 清理权限：仅 super_admin
INSERT INTO admin_permissions (code, module, action, name)
VALUES
  ('test_data.read',    'system', 'read',   '测试数据-查看统计'),
  ('test_data.cleanup', 'system', 'delete', '测试数据-清理')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('test_data.read', 'test_data.cleanup')
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code LIKE 'test_data.%');
-- DELETE FROM admin_permissions WHERE code LIKE 'test_data.%';
-- DROP INDEX IF EXISTS shops_is_test_idx;
-- DROP INDEX IF EXISTS warehouses_is_test_idx;
-- DROP INDEX IF EXISTS suppliers_is_test_idx;
-- DROP INDEX IF EXISTS product_skus_is_test_idx;
-- DROP INDEX IF EXISTS product_sku_stocks_is_test_idx;
-- DROP INDEX IF EXISTS warehouse_stocks_is_test_idx;
-- DROP INDEX IF EXISTS stock_movements_is_test_idx;
-- DROP INDEX IF EXISTS shop_requisitions_is_test_idx;
-- DROP INDEX IF EXISTS demand_plans_is_test_idx;
-- DROP INDEX IF EXISTS purchase_orders_is_test_idx;
-- DROP INDEX IF EXISTS orders_is_test_idx;
-- ALTER TABLE shops DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE warehouses DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE shop_suppliers DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE catalog_skus DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE product_skus DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE product_stocks DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE product_sku_stocks DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE warehouse_stocks DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE stock_movements DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE shop_requisitions DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE shop_requisition_items DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE demand_plans DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE demand_plan_items DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE purchase_orders DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE orders DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE order_items DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE order_payments DROP COLUMN IF EXISTS is_test;
-- ALTER TABLE document_events DROP COLUMN IF EXISTS is_test;
-- COMMIT;

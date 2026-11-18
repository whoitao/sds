-- 0026_purchase_demand_plan.sql
-- 采购单可选关联需求计划：从需求计划明细生成采购单时带入，手工采购保持为空。
-- 加法迁移，可回滚，不删旧列。
BEGIN;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS demand_plan_id uuid REFERENCES demand_plans (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_orders_demand_plan_idx
  ON purchase_orders (demand_plan_id)
  WHERE demand_plan_id IS NOT NULL;

COMMIT;

-- 回滚：
-- BEGIN;
-- DROP INDEX IF EXISTS purchase_orders_demand_plan_idx;
-- ALTER TABLE purchase_orders DROP COLUMN IF EXISTS demand_plan_id;
-- COMMIT;

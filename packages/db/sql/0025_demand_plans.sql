-- 0025_demand_plans.sql
-- 需求汇总：交付日 + 仓库 + SKU，多门店已审核要货合并；支持人工采纳数量与采购路径。
-- 加法迁移，可回滚，不删旧表旧列。
BEGIN;

CREATE TABLE IF NOT EXISTS demand_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_no varchar(32) NOT NULL,
  delivery_date date NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'collecting',
  is_current boolean NOT NULL DEFAULT true,
  total_skus integer NOT NULL DEFAULT 0,
  total_requested_qty numeric(14, 2) NOT NULL DEFAULT 0,
  remark text,
  decided_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_plans_status_check
    CHECK (status IN ('collecting', 'decided', 'superseded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS demand_plans_no_unique
  ON demand_plans (plan_no);
CREATE UNIQUE INDEX IF NOT EXISTS demand_plans_version_unique
  ON demand_plans (delivery_date, warehouse_id, version);
-- 同一交付日 + 仓库只保留一个当前版本；重算会生成新版本并把旧版本置为非当前
CREATE UNIQUE INDEX IF NOT EXISTS demand_plans_current_unique
  ON demand_plans (delivery_date, warehouse_id)
  WHERE is_current = true;

CREATE TABLE IF NOT EXISTS demand_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_plan_id uuid NOT NULL REFERENCES demand_plans (id) ON DELETE CASCADE,
  catalog_sku_id uuid NOT NULL REFERENCES catalog_skus (id) ON DELETE RESTRICT,
  item_name varchar(100) NOT NULL,
  spec_name varchar(50),
  unit varchar(20) NOT NULL,
  category_id uuid REFERENCES catalog_categories (id) ON DELETE SET NULL,
  category_name varchar(50),
  total_requested_qty numeric(14, 2) NOT NULL,
  final_qty numeric(14, 2) NOT NULL,
  purchase_path varchar(24) NOT NULL DEFAULT 'centralized',
  shop_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_plan_items_qty_check
    CHECK (total_requested_qty >= 0 AND final_qty >= 0),
  CONSTRAINT demand_plan_items_path_check
    CHECK (purchase_path IN ('centralized', 'central_kitchen', 'regional_whitelist'))
);

CREATE UNIQUE INDEX IF NOT EXISTS demand_plan_items_catalog_unique
  ON demand_plan_items (demand_plan_id, catalog_sku_id);
CREATE INDEX IF NOT EXISTS demand_plan_items_category_idx
  ON demand_plan_items (demand_plan_id, category_name);

INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('demand.read',  'demand', 'read',  '需求汇总-查看'),
  ('demand.write', 'demand', 'write', '需求汇总-汇总与调整')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('demand.read', 'demand.write')
WHERE r.code IN ('super_admin', 'ops_manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'demand.read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行，仅在确认没有需求计划被采购单引用后使用）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code LIKE 'demand.%');
-- DELETE FROM admin_permissions WHERE code LIKE 'demand.%';
-- DROP TABLE IF EXISTS demand_plan_items;
-- DROP TABLE IF EXISTS demand_plans;
-- COMMIT;

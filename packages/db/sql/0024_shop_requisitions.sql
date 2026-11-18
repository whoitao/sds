-- 0024_shop_requisitions.sql
-- 门店要货单 + 管理员门店数据范围（加法迁移，可回滚，不删旧表旧列）
BEGIN;

-- 1) 管理员门店数据范围：与 admin_user_warehouses 同思路。
--    没有绑定的非超管保持“全部门店”，避免升级后把现有 ops_manager 锁死；
--    一旦存在绑定，就只允许看绑定门店（店长场景）。
CREATE TABLE IF NOT EXISTS admin_user_shops (
  admin_user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, shop_id)
);

CREATE INDEX IF NOT EXISTS admin_user_shops_shop_idx
  ON admin_user_shops (shop_id);

-- 2) 门店要货单
CREATE TABLE IF NOT EXISTS shop_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_no varchar(32) NOT NULL,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  expected_date date NOT NULL,
  time_window varchar(16) NOT NULL DEFAULT 'all_day',
  status varchar(16) NOT NULL DEFAULT 'draft',
  remark text,
  submitted_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_requisitions_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'withdrawn')),
  CONSTRAINT shop_requisitions_time_window_check
    CHECK (time_window IN ('morning', 'afternoon', 'all_day'))
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_requisitions_no_unique
  ON shop_requisitions (requisition_no);
CREATE INDEX IF NOT EXISTS shop_requisitions_shop_date_idx
  ON shop_requisitions (shop_id, expected_date, created_at);
CREATE INDEX IF NOT EXISTS shop_requisitions_status_idx
  ON shop_requisitions (status, expected_date);

-- 同一门店同一交付日只允许一张“已提交/已审核”的要货单；
-- 草稿可以有多张，提交时由接口做幂等返回或唯一索引兜底。
CREATE UNIQUE INDEX IF NOT EXISTS shop_requisitions_active_unique
  ON shop_requisitions (shop_id, expected_date)
  WHERE status IN ('submitted', 'approved');

-- 3) 要货明细
CREATE TABLE IF NOT EXISTS shop_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES shop_requisitions (id) ON DELETE CASCADE,
  product_sku_id uuid NOT NULL REFERENCES product_skus (id) ON DELETE RESTRICT,
  catalog_sku_id uuid REFERENCES catalog_skus (id) ON DELETE RESTRICT,
  item_name varchar(100) NOT NULL,
  spec_name varchar(50),
  category_id uuid REFERENCES catalog_categories (id) ON DELETE SET NULL,
  category_name varchar(50),
  unit varchar(20) NOT NULL,
  requested_qty numeric(12, 2) NOT NULL,
  approved_qty numeric(12, 2),
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_requisition_items_qty_check CHECK (requested_qty > 0),
  CONSTRAINT shop_requisition_items_approved_qty_check
    CHECK (approved_qty IS NULL OR approved_qty >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_requisition_items_sku_unique
  ON shop_requisition_items (requisition_id, product_sku_id);
CREATE INDEX IF NOT EXISTS shop_requisition_items_catalog_idx
  ON shop_requisition_items (catalog_sku_id);

-- 4) 权限字典与授予
INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('requisitions.read',   'requisitions', 'read',   '要货单-查看'),
  ('requisitions.write',  'requisitions', 'write',  '要货单-新建编辑提交撤回'),
  ('requisitions.review', 'requisitions', 'review', '要货单-审核')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p
  ON p.code IN ('requisitions.read', 'requisitions.write', 'requisitions.review')
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p
  ON p.code IN ('requisitions.read', 'requisitions.write', 'requisitions.review')
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'requisitions.read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行，仅在没有要货业务数据后使用）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code LIKE 'requisitions.%');
-- DELETE FROM admin_permissions WHERE code LIKE 'requisitions.%';
-- DROP TABLE IF EXISTS shop_requisition_items;
-- DROP TABLE IF EXISTS shop_requisitions;
-- DROP TABLE IF EXISTS admin_user_shops;
-- COMMIT;

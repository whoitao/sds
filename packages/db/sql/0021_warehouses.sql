-- 0021_warehouses.sql
-- 仓库主数据与仓权限（加法迁移，可回滚，不删旧表旧列）
-- 依据 docs/prd/SDS-PRD.md 11.9「仓库主数据」建议：
--   warehouses(id, code, name, type hq/regional, address, cold_zone_supported, status)
--   + admin_user_warehouses(admin_user_id, warehouse_id)
BEGIN;

-- 1) 仓库主数据
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL,
  name varchar(100) NOT NULL,
  type varchar(16) NOT NULL DEFAULT 'hq',
  address text,
  cold_zone_supported boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_type_check CHECK (type IN ('hq', 'regional')),
  CONSTRAINT warehouses_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_code_unique ON warehouses (code);
CREATE INDEX IF NOT EXISTS warehouses_status_idx ON warehouses (status);
CREATE INDEX IF NOT EXISTS warehouses_type_idx ON warehouses (type);

-- 2) 管理员可见仓库范围：没有记录的人看不到任何仓库（super_admin 由接口层放行）
CREATE TABLE IF NOT EXISTS admin_user_warehouses (
  admin_user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS admin_user_warehouses_warehouse_idx
  ON admin_user_warehouses (warehouse_id);

-- 3) 首期只启用一个总部仓；已有仓库时不重复播种
INSERT INTO warehouses (code, name, type, address, cold_zone_supported, status)
SELECT 'HQ', '总部仓', 'hq', NULL, true, 'active'
WHERE NOT EXISTS (SELECT 1 FROM warehouses)
ON CONFLICT (code) DO NOTHING;

-- 4) 权限字典与授予
INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('warehouse.read',  'warehouse', 'read',  '仓库-查看'),
  ('warehouse.write', 'warehouse', 'write', '仓库-新建编辑')
ON CONFLICT (code) DO NOTHING;

-- super_admin：全部新增权限
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('warehouse.read', 'warehouse.write')
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ops_manager：仓库维护（实际可见范围仍受 admin_user_warehouses 限制）
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('warehouse.read', 'warehouse.write')
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer：只读
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'warehouse.read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行，仅在没有仓库业务数据写入后使用）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code LIKE 'warehouse.%');
-- DELETE FROM admin_permissions WHERE code LIKE 'warehouse.%';
-- DROP TABLE IF EXISTS admin_user_warehouses;
-- DROP TABLE IF EXISTS warehouses;
-- COMMIT;

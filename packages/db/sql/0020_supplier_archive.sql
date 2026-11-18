-- 0020_supplier_archive.sql
-- 供应商从「门店附属」升级为「平台级主体 + 门店供货关系」。
-- 全部为加法改动：不删表、不删列；旧 shop_id 重命名为 legacy_shop_id 并保留历史值。
-- 回滚见文件末尾注释。

BEGIN;

-- 1) 平台级主体字段
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS code varchar(32);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS settlement_method varchar(32);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_no varchar(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email varchar(120);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_purchase_at timestamptz;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merged_into_id uuid;

-- 2) 旧 shop_id → legacy_shop_id，可空，删门店不再级联删供应商
DO $$
DECLARE
  fk record;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'shop_id'
  ) THEN
    -- 先移除引用 shop_id 的旧外键（约束名可能是自动生成的）
    FOR fk IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'suppliers'::regclass
        AND contype = 'f'
        AND pg_get_constraintdef(oid) LIKE '%(shop_id)%'
    LOOP
      EXECUTE format('ALTER TABLE suppliers DROP CONSTRAINT %I', fk.conname);
    END LOOP;

    ALTER TABLE suppliers ALTER COLUMN shop_id DROP NOT NULL;
    ALTER TABLE suppliers RENAME COLUMN shop_id TO legacy_shop_id;
  END IF;
END $$;

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_legacy_shop_id_fkey;
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_legacy_shop_id_fkey
  FOREIGN KEY (legacy_shop_id) REFERENCES shops (id) ON DELETE SET NULL;

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_merged_into_id_fkey;
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_merged_into_id_fkey
  FOREIGN KEY (merged_into_id) REFERENCES suppliers (id) ON DELETE SET NULL;

-- 3) 索引
ALTER INDEX IF EXISTS suppliers_shop_idx RENAME TO suppliers_legacy_shop_idx;
CREATE INDEX IF NOT EXISTS suppliers_legacy_shop_idx
  ON suppliers (legacy_shop_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_code_unique
  ON suppliers (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers (name);

-- 4) 供应商与门店的供货关系
CREATE TABLE IF NOT EXISTS shop_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_suppliers_unique
  ON shop_suppliers (supplier_id, shop_id);
CREATE INDEX IF NOT EXISTS shop_suppliers_shop_idx
  ON shop_suppliers (shop_id, status);
CREATE INDEX IF NOT EXISTS shop_suppliers_supplier_idx
  ON shop_suppliers (supplier_id);

-- 5) 历史数据回填：旧的门店附属供应商 = 一条供货关系
INSERT INTO shop_suppliers (supplier_id, shop_id, status)
SELECT
  s.id,
  s.legacy_shop_id,
  CASE WHEN s.status = 'disabled' THEN 'disabled' ELSE 'active' END
FROM suppliers s
WHERE s.legacy_shop_id IS NOT NULL
ON CONFLICT (supplier_id, shop_id) DO NOTHING;

-- 6) 权限字典与授予
INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('suppliers.read',  'suppliers', 'read',  '供应商-查看'),
  ('suppliers.write', 'suppliers', 'write', '供应商-新建编辑')
ON CONFLICT (code) DO NOTHING;

-- super_admin：全部新增权限
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('suppliers.read', 'suppliers.write')
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer：只读
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'suppliers.read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ops_manager：沿用既有采购维护能力，避免升级后无法新建/编辑供应商
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('suppliers.read', 'suppliers.write')
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行，仅在没有新数据写入后使用）：
-- BEGIN;
-- DROP TABLE IF EXISTS shop_suppliers;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id IN (SELECT id FROM admin_permissions WHERE code LIKE 'suppliers.%');
-- DELETE FROM admin_permissions WHERE code LIKE 'suppliers.%';
-- DROP INDEX IF EXISTS suppliers_name_idx;
-- DROP INDEX IF EXISTS suppliers_code_unique;
-- DROP INDEX IF EXISTS suppliers_legacy_shop_idx;
-- ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_merged_into_id_fkey;
-- ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_legacy_shop_id_fkey;
-- ALTER TABLE suppliers RENAME COLUMN legacy_shop_id TO shop_id;
-- ALTER TABLE suppliers ALTER COLUMN shop_id SET NOT NULL;
-- ALTER TABLE suppliers ADD CONSTRAINT suppliers_shop_id_fkey
--   FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS merged_into_id;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS last_purchase_at;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS email;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS tax_no;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS settlement_method;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS address;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS code;
-- COMMIT;

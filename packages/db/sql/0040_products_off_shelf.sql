-- 0040_products_off_shelf.sql
-- 店长可控制自己门店的商品上下架，但不获得改价/规格编辑的 products.write。
-- 加法迁移，可重复执行。

BEGIN;

INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('products.off_shelf', 'products', 'off_shelf', '门店商品上下架')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'products.off_shelf'
WHERE r.code IN ('store_manager', 'ops_manager', 'super_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id = (SELECT id FROM admin_permissions WHERE code = 'products.off_shelf');
-- DELETE FROM admin_permissions WHERE code = 'products.off_shelf';
-- COMMIT;

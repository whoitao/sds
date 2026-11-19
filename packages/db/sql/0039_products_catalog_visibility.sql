-- 0039_products_catalog_visibility.sql
-- 门店分类可见性使用窄权限：店长可控制自己门店的分类显隐，但不获得改价/上下架的 products.write。
-- 加法迁移，可重复执行。

BEGIN;

INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('products.catalog_visibility', 'products', 'catalog_visibility', '门店分类可见性')
ON CONFLICT (code) DO NOTHING;

-- 店长：默认可操作绑定门店的分类显隐；运营与超管保持可维护
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'products.catalog_visibility'
WHERE r.code IN ('store_manager', 'ops_manager', 'super_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 店长不应拥有门店改价/上下架权限（0038 未授予；若被手工勾选则回收，
-- 门店分类显隐改由上面的窄权限承担）
DELETE FROM admin_role_permissions
 WHERE role_id = (SELECT id FROM admin_roles WHERE code = 'store_manager')
   AND permission_id = (SELECT id FROM admin_permissions WHERE code = 'products.write');

COMMIT;

-- 回滚（手工执行）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE permission_id = (SELECT id FROM admin_permissions WHERE code = 'products.catalog_visibility');
-- DELETE FROM admin_permissions WHERE code = 'products.catalog_visibility';
-- COMMIT;
-- 注：回滚不恢复手工授予过的 products.write，避免重新打开店长越权。

-- 0038_store_manager_role.sql
-- 店长角色：只管理 admin_user_shops 绑定的门店，覆盖订单、库存、要货、报损与只读视图。
-- 加法迁移，可重复执行。

BEGIN;

INSERT INTO admin_roles (code, name, description, is_system) VALUES
  ('store_manager', '店长', '仅管理绑定门店的订单、库存、要货与报损', true)
ON CONFLICT (code) DO NOTHING;

-- 本店读写：订单 / 库存 / 要货（不含审核）；报损复用 inventory.write
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN (
  'orders.read', 'orders.write',
  'inventory.read', 'inventory.write',
  'requisitions.read', 'requisitions.write'
)
WHERE r.code = 'store_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 只读：店铺 / 商品 / 报表
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('shops.read', 'products.read', 'reports.read')
WHERE r.code = 'store_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- 回滚（手工执行）：
-- BEGIN;
-- DELETE FROM admin_role_permissions
--  WHERE role_id = (SELECT id FROM admin_roles WHERE code = 'store_manager');
-- DELETE FROM admin_user_roles
--  WHERE role_id = (SELECT id FROM admin_roles WHERE code = 'store_manager');
-- DELETE FROM admin_roles WHERE code = 'store_manager';
-- COMMIT;

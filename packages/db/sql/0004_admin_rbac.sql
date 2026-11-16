-- 0004_admin_rbac.sql
-- 后台管理员 ABAC 权限模型：角色 / 权限项 / 角色权限授予（含属性条件）/ 管理员角色绑定
-- 全部为新增对象，幂等可重复执行

CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(50) NOT NULL,
  name varchar(50) NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_code_unique ON admin_roles (code);

CREATE TABLE IF NOT EXISTS admin_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) NOT NULL,
  module varchar(32) NOT NULL,
  action varchar(32) NOT NULL,
  name varchar(64) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_permissions_code_unique ON admin_permissions (code);
CREATE INDEX IF NOT EXISTS admin_permissions_module_idx ON admin_permissions (module);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES admin_roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES admin_permissions (id) ON DELETE CASCADE,
  conditions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_role_permissions_unique
  ON admin_role_permissions (role_id, permission_id);
CREATE INDEX IF NOT EXISTS admin_role_permissions_role_idx
  ON admin_role_permissions (role_id);

CREATE TABLE IF NOT EXISTS admin_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES admin_roles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_user_roles_unique
  ON admin_user_roles (admin_user_id, role_id);
CREATE INDEX IF NOT EXISTS admin_user_roles_user_idx
  ON admin_user_roles (admin_user_id);

-- 默认角色
INSERT INTO admin_roles (code, name, description, is_system) VALUES
  ('super_admin', '平台管理员', '拥有全部后台权限', true),
  ('ops_manager', '运营管理员', '管理业务用户、店铺与商品等日常运营', true),
  ('viewer', '只读观察员', '仅可查看各模块列表与详情', true)
ON CONFLICT (code) DO NOTHING;

-- 权限项字典（18 项）
INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('users.read',            'users',     'read',   '用户-查看'),
  ('users.write',           'users',     'write',  '用户-新建编辑'),
  ('admins.read',           'admins',    'read',   '管理员-查看'),
  ('admins.write',          'admins',    'write',  '管理员-新建编辑'),
  ('roles.read',            'roles',     'read',   '角色权限-查看'),
  ('roles.write',           'roles',     'write',  '角色权限-编辑'),
  ('shops.read',            'shops',     'read',   '店铺-查看'),
  ('shops.write',           'shops',     'write',  '店铺-新建编辑'),
  ('shops.members.write',   'shops',     'members','店铺-店长绑定'),
  ('products.read',         'products',  'read',   '商品-查看'),
  ('products.write',        'products',  'write',  '商品-新建编辑'),
  ('orders.read',           'orders',    'read',   '订单-查看'),
  ('orders.write',          'orders',    'write',  '订单-处理'),
  ('inventory.read',        'inventory', 'read',   '库存-查看'),
  ('inventory.write',       'inventory', 'write',  '库存-调整'),
  ('purchases.read',        'purchases', 'read',   '采购-查看'),
  ('purchases.write',       'purchases', 'write',  '采购-新建编辑'),
  ('reports.read',          'reports',   'read',   '报表-查看')
ON CONFLICT (code) DO NOTHING;

-- super_admin：全部权限，无条件
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
CROSS JOIN admin_permissions p
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer：全部只读权限，无条件
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.action = 'read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ops_manager：日常运营权限，无条件
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN (
  'users.read', 'users.write',
  'shops.read', 'shops.write',
  'products.read', 'products.write',
  'orders.read',
  'inventory.read',
  'purchases.read',
  'reports.read'
)
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ops_manager：ABAC 条件授予——已暂停（suspended）的店铺不允许再改店长
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id,
       '{"attr":"resource.status","op":"neq","value":"suspended"}'::jsonb
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'shops.members.write'
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO UPDATE SET conditions = EXCLUDED.conditions;

-- 现存管理员全部绑定 super_admin，避免升级后把自己锁在门外
INSERT INTO admin_user_roles (admin_user_id, role_id)
SELECT a.id, r.id
FROM admin_users a
JOIN admin_roles r ON r.code = 'super_admin'
ON CONFLICT (admin_user_id, role_id) DO NOTHING;

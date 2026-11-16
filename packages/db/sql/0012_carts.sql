-- 0012 购物车：carts（按顾客 + 门店一车） + cart_items（商品条目）
-- 口径：
--   * 购物车必须绑定登录顾客（customer_id NOT NULL），游客不落库；
--   * 一车一店（customer_id + shop_id 唯一），与 PRD「跨店不可合并下单」一致，
--     也让后台可以按门店直接筛选；
--   * 条目只存 product_id + quantity，单价/小计读取时按当前有效价
--     coalesce(products.price, catalog_products.default_price) 计算，不锁价；
--   * 清空或删到 0 条时直接删 carts 行，后台列表不展示空车。

BEGIN;

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  remark varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS carts_customer_shop_unique ON carts (customer_id, shop_id);
CREATE INDEX IF NOT EXISTS carts_shop_updated_idx ON carts (shop_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS carts_updated_idx ON carts (updated_at DESC);

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_product_unique ON cart_items (cart_id, product_id);
CREATE INDEX IF NOT EXISTS cart_items_product_idx ON cart_items (product_id);

-- 权限：购物车为只读管理（后台不修改顾客篮子），新增一个 read 权限
INSERT INTO admin_permissions (code, module, action, name, description) VALUES
  ('carts.read', 'carts', 'read', '购物车-查看', '查看顾客购物车列表、条目数、金额与明细')
ON CONFLICT (code) DO NOTHING;

-- super_admin / ops_manager / viewer 默认授予 carts.read
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'carts.read'
WHERE r.code IN ('super_admin', 'ops_manager', 'viewer')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

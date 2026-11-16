-- 0008 多店商品库：总部标准分类/商品 + 门店商品引用列 + 门店级库存
-- 决策口径（已拍板）：
--   * 分类：共享分类树（catalog_categories），门店只能隐藏；
--   * 价格：总部 default_price 建议价 + 门店 products.price 可覆盖（NULL = 跟随）；
--   * 上下架：门店 is_available 自主 + 总部 is_blocked 强制下架；
--   * 库存：严格门店级，只在 product_stocks（挂 products 行），总部商品表不含任何库存字段。
-- 本迁移全部为增量、可空或带默认值，对现有读写向后兼容。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) 总部分类树：结构与 categories 一致，去掉 shop_id
CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog_categories (id) ON DELETE RESTRICT,
  level smallint NOT NULL DEFAULT 1,
  name varchar(50) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  icon_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_categories_level_check CHECK (level IN (1, 2)),
  CONSTRAINT catalog_categories_level_parent_check
    CHECK ((level = 1 AND parent_id IS NULL) OR (level = 2 AND parent_id IS NOT NULL)),
  CONSTRAINT catalog_categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- 同级名唯一：NULLS NOT DISTINCT 让顶级分类之间也互斥
CREATE UNIQUE INDEX IF NOT EXISTS catalog_categories_sibling_name_unique
  ON catalog_categories (parent_id, name) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS catalog_categories_parent_idx
  ON catalog_categories (parent_id, sort_order);

-- 2) 总部商品库：只存共享字段（名称/描述/图片/单位/建议价），不含库存、不含上下架
CREATE TABLE IF NOT EXISTS catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES catalog_categories (id) ON DELETE SET NULL,
  name varchar(100) NOT NULL,
  description text,
  image_url text,
  unit varchar(20) NOT NULL,
  default_price numeric(10, 2) NOT NULL CHECK (default_price >= 0),
  stock_type product_stock_type NOT NULL DEFAULT 'tracked',
  status varchar(16) NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_products_status_check CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS catalog_products_category_idx ON catalog_products (category_id);
CREATE INDEX IF NOT EXISTS catalog_products_status_idx ON catalog_products (status, created_at);

-- 3) 门店商品引用总部商品：共享字段以总部为准，门店只保留本地覆盖字段
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid
    REFERENCES catalog_products (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

-- price 可空：NULL = 跟随 catalog_products.default_price；本地独有商品仍必须有价
ALTER TABLE products ALTER COLUMN price DROP NOT NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_price_required_for_local;
ALTER TABLE products
  ADD CONSTRAINT products_price_required_for_local
  CHECK (catalog_product_id IS NOT NULL OR price IS NOT NULL);

-- 一个门店对同一个总部商品只能有一行
CREATE UNIQUE INDEX IF NOT EXISTS products_shop_catalog_unique
  ON products (shop_id, catalog_product_id)
  WHERE catalog_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_catalog_idx ON products (catalog_product_id);

-- 复合外键目标：保证库存行的 shop_id 与商品行归属一致
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_id_shop_unique;
ALTER TABLE products ADD CONSTRAINT products_id_shop_unique UNIQUE (id, shop_id);

-- 4) 门店级库存：库存只属于门店，任何库存字段都不进 catalog_products / 不随共享字段下发
CREATE TABLE IF NOT EXISTS product_stocks (
  product_id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_stocks_product_fk
    FOREIGN KEY (product_id, shop_id) REFERENCES products (id, shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_stocks_shop_idx ON product_stocks (shop_id);

-- 5) 权限码：总部商品库读写/发布/强制下架、店铺一键铺货
INSERT INTO admin_permissions (code, module, action, name) VALUES
  ('catalog.read',          'catalog', 'read',          '总部商品库-查看'),
  ('catalog.write',         'catalog', 'write',         '总部商品库-新建编辑'),
  ('catalog.publish',       'catalog', 'publish',       '总部商品库-发布'),
  ('catalog.force_offline', 'catalog', 'force_offline', '总部商品库-强制下架'),
  ('shops.catalog_push',    'shops',   'catalog_push',  '店铺-一键铺货')
ON CONFLICT (code) DO NOTHING;

-- super_admin：新增权限全部授予
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN (
  'catalog.read', 'catalog.write', 'catalog.publish', 'catalog.force_offline', 'shops.catalog_push'
)
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- viewer：总部商品库只读
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code = 'catalog.read'
WHERE r.code = 'viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ops_manager：日常运营可维护/发布总部商品并给店铺货；强制下架留给超管
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN (
  'catalog.read', 'catalog.write', 'catalog.publish', 'shops.catalog_push'
)
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

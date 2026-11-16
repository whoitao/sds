-- 0015 SKU 层：总部规格、门店规格、购物车切 SKU
-- 口径：
--   * 库存不再按商品（SPU），改为按门店 SKU；
--   * 每个存量商品回填一个「标准装」默认 SKU，保证迁移后立即可售；
--   * 数量模式 integer / decimal_2，存量按单位推断，运营可在后台复核；
--   * 购物车增加 product_sku_id，旧 product_id 暂时保留，代码切换完成后再清理。
-- 幂等写法，可重复执行。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quantity_mode') THEN
    CREATE TYPE quantity_mode AS ENUM ('integer', 'decimal_2');
  END IF;
END
$$;

-- 1) 总部规格：不持有库存
CREATE TABLE IF NOT EXISTS catalog_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id uuid NOT NULL REFERENCES catalog_products (id) ON DELETE CASCADE,
  spec_name varchar(50) NOT NULL,
  barcode varchar(64),
  unit varchar(20) NOT NULL,
  default_price numeric(10, 2) NOT NULL CHECK (default_price >= 0),
  stock_type product_stock_type NOT NULL DEFAULT 'tracked',
  quantity_mode quantity_mode NOT NULL DEFAULT 'integer',
  is_default boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_skus_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_skus_product_spec_unique
  ON catalog_skus (catalog_product_id, spec_name);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_skus_default_unique
  ON catalog_skus (catalog_product_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS catalog_skus_product_idx
  ON catalog_skus (catalog_product_id, status, sort_order);

-- 2) 门店规格：库存最小单位
CREATE TABLE IF NOT EXISTS product_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  catalog_sku_id uuid REFERENCES catalog_skus (id) ON DELETE RESTRICT,
  spec_name varchar(50) NOT NULL,
  barcode varchar(64),
  unit varchar(20) NOT NULL,
  price numeric(10, 2),
  stock_type product_stock_type NOT NULL DEFAULT 'tracked',
  quantity_mode quantity_mode NOT NULL DEFAULT 'integer',
  is_available boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_skus_product_fk
    FOREIGN KEY (product_id, shop_id) REFERENCES products (id, shop_id) ON DELETE CASCADE,
  CONSTRAINT product_skus_price_required_for_local
    CHECK (catalog_sku_id IS NOT NULL OR price IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_skus_product_spec_unique
  ON product_skus (product_id, spec_name);
CREATE UNIQUE INDEX IF NOT EXISTS product_skus_id_shop_unique
  ON product_skus (id, shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_skus_shop_catalog_sku_unique
  ON product_skus (shop_id, catalog_sku_id) WHERE catalog_sku_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_skus_default_unique
  ON product_skus (product_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS product_skus_product_idx
  ON product_skus (product_id, is_available, sort_order);
CREATE INDEX IF NOT EXISTS product_skus_shop_idx ON product_skus (shop_id);
CREATE INDEX IF NOT EXISTS product_skus_barcode_idx
  ON product_skus (shop_id, barcode) WHERE barcode IS NOT NULL;

-- 3) 存量总部商品回填默认 SKU
INSERT INTO catalog_skus (
  catalog_product_id, spec_name, unit, default_price, stock_type, quantity_mode,
  is_default, status, sort_order
)
SELECT cp.id,
       '标准装',
       cp.unit,
       cp.default_price,
       cp.stock_type,
       CASE
         WHEN lower(cp.unit) IN ('斤', 'kg', '千克', 'l', '升', 'ml', '毫升')
           THEN 'decimal_2'::quantity_mode
         ELSE 'integer'::quantity_mode
       END,
       true,
       'active',
       0
FROM catalog_products cp
WHERE NOT EXISTS (SELECT 1 FROM catalog_skus s WHERE s.catalog_product_id = cp.id)
ON CONFLICT DO NOTHING;

-- 4) 存量门店商品回填默认 SKU（关联总部商品）
INSERT INTO product_skus (
  shop_id, product_id, catalog_sku_id, spec_name, barcode, unit, price,
  stock_type, quantity_mode, is_available, is_default, sort_order
)
SELECT p.shop_id,
       p.id,
       cs.id,
       cs.spec_name,
       cs.barcode,
       cs.unit,
       p.price,
       cs.stock_type,
       cs.quantity_mode,
       p.is_available,
       true,
       cs.sort_order
FROM products p
JOIN catalog_skus cs
  ON cs.catalog_product_id = p.catalog_product_id AND cs.is_default
WHERE p.catalog_product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM product_skus ps WHERE ps.product_id = p.id)
ON CONFLICT DO NOTHING;

-- 5) 存量门店本地商品回填默认 SKU
INSERT INTO product_skus (
  shop_id, product_id, catalog_sku_id, spec_name, barcode, unit, price,
  stock_type, quantity_mode, is_available, is_default, sort_order
)
SELECT p.shop_id,
       p.id,
       NULL,
       '标准装',
       NULL,
       p.unit,
       p.price,
       p.stock_type,
       CASE
         WHEN lower(p.unit) IN ('斤', 'kg', '千克', 'l', '升', 'ml', '毫升')
           THEN 'decimal_2'::quantity_mode
         ELSE 'integer'::quantity_mode
       END,
       p.is_available,
       true,
       0
FROM products p
WHERE p.catalog_product_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM product_skus ps WHERE ps.product_id = p.id)
ON CONFLICT DO NOTHING;

-- 6) 购物车切 SKU：旧 product_id 暂时保留，避免一次性大改
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS product_sku_id uuid;

UPDATE cart_items ci
SET product_sku_id = ps.id
FROM product_skus ps
WHERE ps.product_id = ci.product_id
  AND ps.is_default
  AND ci.product_sku_id IS NULL;

-- 防御：理论上每个商品都有默认 SKU；若仍有脏数据，删除无法映射的购物车条目
DELETE FROM cart_items WHERE product_sku_id IS NULL;

ALTER TABLE cart_items
  ALTER COLUMN quantity TYPE numeric(12, 2) USING quantity::numeric(12, 2);
ALTER TABLE cart_items ALTER COLUMN product_sku_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_product_sku_fk'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_product_sku_fk
      FOREIGN KEY (product_sku_id) REFERENCES product_skus (id) ON DELETE CASCADE;
  END IF;
END
$$;

DROP INDEX IF EXISTS cart_items_cart_product_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_sku_unique
  ON cart_items (cart_id, product_sku_id);
CREATE INDEX IF NOT EXISTS cart_items_product_sku_idx
  ON cart_items (product_sku_id);

COMMIT;

-- 0005_products.sql
-- 对应 PRD 5.4 categories / 5.5 products。当前库中尚无这两张表，全部为新增。
-- 幂等写法，可重复执行。PRD 未定义 SKU，按商品级单规格建表。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_stock_type') THEN
    CREATE TYPE product_stock_type AS ENUM ('tracked', 'untracked');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  name varchar(50) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  icon_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  name varchar(100) NOT NULL,
  description text,
  image_url text,
  price numeric(10, 2) NOT NULL,
  unit varchar(20) NOT NULL,
  stock_type product_stock_type NOT NULL DEFAULT 'tracked',
  is_available boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_shop_name_unique ON categories (shop_id, name);
CREATE INDEX IF NOT EXISTS categories_shop_idx ON categories (shop_id);
CREATE INDEX IF NOT EXISTS products_shop_idx ON products (shop_id);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);

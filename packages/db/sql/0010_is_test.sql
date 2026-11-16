-- 0010 测试数据标记：总部商品库与门店商品行都能区分冒烟/演示数据
-- 清理时按 is_test 先删门店行（product_stocks 随 products 级联），再删总部商品

BEGIN;

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMIT;

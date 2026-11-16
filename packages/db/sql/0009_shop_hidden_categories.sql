-- 0009 共享分类可见性：门店只能隐藏总部共享分类，不再维护自己的分类树
-- 分类写接口在 P5 起下线；存量门店 categories 仅作为历史数据保留（商品行仍可引用）

BEGIN;

CREATE TABLE IF NOT EXISTS shop_hidden_categories (
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  catalog_category_id uuid NOT NULL REFERENCES catalog_categories (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, catalog_category_id)
);

CREATE INDEX IF NOT EXISTS shop_hidden_categories_shop_idx
  ON shop_hidden_categories (shop_id);

COMMIT;

-- 0023_stock_locations.sql
-- 0.3 库存地点维度与成本字段（加法迁移，可回滚，不删列不删表）
-- 口径（PRD 11.4.1 / 11.4.3）：
--   * `stock_movements` 增加地点维度：location_type('shop'|'warehouse') + location_id；
--     历史流水全部回填为 location_type='shop'、location_id=shop_id，语义与改前一致；
--   * 唯一键改为以 location 为第一维，门店流水唯一性等价于原 (shop_id, sku, ...)；
--   * `product_sku_stocks` 补 avg_unit_cost / reserved_qty；本轮仅存储与展示，不参与扣减；
--   * 新增 `warehouse_stocks`：仓库层余额，sku_id 指向总部规格 catalog_skus（仓库持有总部规格，
--     分拨到门店时再映射为门店 SKU；本表不存门店 SKU）。
BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1) 流水地点维度
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS location_type varchar(16) NOT NULL DEFAULT 'shop',
  ADD COLUMN IF NOT EXISTS location_id uuid;

UPDATE stock_movements
   SET location_id = shop_id
 WHERE location_id IS NULL;

ALTER TABLE stock_movements ALTER COLUMN location_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_location_type_check'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_location_type_check
      CHECK (location_type IN ('shop', 'warehouse'));
  END IF;
END
$$;

-- 2) 唯一键调整为 (location, sku, movement_type, reference_type, reference_id)
DROP INDEX IF EXISTS stock_movements_biz_unique;
DROP INDEX IF EXISTS stock_movements_initial_unique;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_biz_unique
  ON stock_movements (
    location_type, location_id, product_sku_id, movement_type, reference_type, reference_id
  )
  WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_initial_unique
  ON stock_movements (location_type, location_id, product_sku_id)
  WHERE movement_type = 'initial';
CREATE INDEX IF NOT EXISTS stock_movements_location_idx
  ON stock_movements (location_type, location_id, created_at DESC);

-- 3) 门店 SKU 余额补成本与预留
ALTER TABLE product_sku_stocks
  ADD COLUMN IF NOT EXISTS avg_unit_cost numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_qty numeric(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_sku_stocks_avg_cost_check'
  ) THEN
    ALTER TABLE product_sku_stocks
      ADD CONSTRAINT product_sku_stocks_avg_cost_check CHECK (avg_unit_cost >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_sku_stocks_reserved_check'
  ) THEN
    ALTER TABLE product_sku_stocks
      ADD CONSTRAINT product_sku_stocks_reserved_check CHECK (reserved_qty >= 0);
  END IF;
END
$$;

-- 4) 仓库层库存余额（本轮只建表，不接入任何记账逻辑）
CREATE TABLE IF NOT EXISTS warehouse_stocks (
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  sku_id uuid NOT NULL REFERENCES catalog_skus (id) ON DELETE RESTRICT,
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_qty numeric(12, 2) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  avg_unit_cost numeric(10, 2) NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, sku_id)
);

CREATE INDEX IF NOT EXISTS warehouse_stocks_sku_idx ON warehouse_stocks (sku_id);

COMMIT;

-- 回滚（手工执行，仅在没有仓库层库存写入后使用）：
-- BEGIN;
-- DROP TABLE IF EXISTS warehouse_stocks;
-- ALTER TABLE product_sku_stocks
--   DROP CONSTRAINT IF EXISTS product_sku_stocks_reserved_check,
--   DROP CONSTRAINT IF EXISTS product_sku_stocks_avg_cost_check,
--   DROP COLUMN IF EXISTS reserved_qty,
--   DROP COLUMN IF EXISTS avg_unit_cost;
-- DROP INDEX IF EXISTS stock_movements_location_idx;
-- DROP INDEX IF EXISTS stock_movements_initial_unique;
-- DROP INDEX IF EXISTS stock_movements_biz_unique;
-- CREATE UNIQUE INDEX stock_movements_biz_unique
--   ON stock_movements (shop_id, product_sku_id, movement_type, reference_type, reference_id)
--   WHERE reference_id IS NOT NULL;
-- CREATE UNIQUE INDEX stock_movements_initial_unique
--   ON stock_movements (shop_id, product_sku_id) WHERE movement_type = 'initial';
-- ALTER TABLE stock_movements
--   DROP CONSTRAINT IF EXISTS stock_movements_location_type_check,
--   DROP COLUMN IF EXISTS location_id,
--   DROP COLUMN IF EXISTS location_type;
-- COMMIT;

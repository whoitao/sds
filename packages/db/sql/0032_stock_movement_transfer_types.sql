-- 0032 分拨单库存流水类型与流水唯一键调整
-- 加法迁移：只新增枚举值，不删列不删表。
-- 1) stock_movement_type 增加 transfer_out（仓库发出）/ transfer_in（门店收货）；
-- 2) 同一分拨单可能分多次部分发货、部分收货，需要为每次批次各记一条流水，
--    因此把「单据 + SKU 只能一条流水」的唯一键排除 reference_type='warehouse_transfer'；
--    其余单据（采购入库、销售出库、盘点等）仍保持原唯一性约束。
-- 回滚见文件末尾说明：枚举值 PostgreSQL 不支持直接删除，回滚仅恢复唯一键。

ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'transfer_in';

-- 门店流水唯一键：放行分拨收货流水（同一分拨单多批次收货）
DROP INDEX IF EXISTS stock_movements_biz_unique;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_biz_unique
  ON stock_movements (
    location_type, location_id, product_sku_id, movement_type, reference_type, reference_id
  )
  WHERE reference_id IS NOT NULL
    AND reference_type IS DISTINCT FROM 'warehouse_transfer';

-- 仓库流水唯一键：放行分拨发出流水（同一分拨单多批次发货）
DROP INDEX IF EXISTS stock_movements_warehouse_biz_unique;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_warehouse_biz_unique
  ON stock_movements (
    location_type, location_id, catalog_sku_id, movement_type, reference_type, reference_id
  )
  WHERE location_type = 'warehouse'
    AND catalog_sku_id IS NOT NULL
    AND reference_id IS NOT NULL
    AND reference_type IS DISTINCT FROM 'warehouse_transfer';

COMMENT ON TYPE stock_movement_type IS
  '库存流水类型：purchase_in / purchase_return / sale_out / order_return / adjustment / waste / initial / transfer_out / transfer_in';

-- ---------------------------------------------------------------------------
-- 回滚 SQL（枚举值无法安全删除，且可能已有分拨流水使用，故仅恢复原唯一键）
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS stock_movements_biz_unique;
-- CREATE UNIQUE INDEX stock_movements_biz_unique
--   ON stock_movements (location_type, location_id, product_sku_id, movement_type, reference_type, reference_id)
--   WHERE reference_id IS NOT NULL;
-- DROP INDEX IF EXISTS stock_movements_warehouse_biz_unique;
-- CREATE UNIQUE INDEX stock_movements_warehouse_biz_unique
--   ON stock_movements (location_type, location_id, catalog_sku_id, movement_type, reference_type, reference_id)
--   WHERE location_type = 'warehouse' AND catalog_sku_id IS NOT NULL AND reference_id IS NOT NULL;

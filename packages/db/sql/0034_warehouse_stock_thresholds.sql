-- 0034 仓库库存安全阈值
-- 加法迁移：仅给 warehouse_stocks 增加阈值列与索引，不改动既有库存与预留字段。
-- 语义：仓库低库存按「可用量 = quantity - reserved_qty」判断，与门店库存按 quantity 判断互不影响。
-- 默认 min_threshold = 0（与原行为一致：可用量 <= 0 即视为低库存）。

begin;

alter table warehouse_stocks
  add column if not exists min_threshold numeric(12, 2) not null default 0,
  add column if not exists max_threshold numeric(12, 2);

alter table warehouse_stocks
  drop constraint if exists warehouse_stocks_threshold_check;
alter table warehouse_stocks
  add constraint warehouse_stocks_threshold_check check (
    min_threshold >= 0
    and (max_threshold is null or max_threshold >= 0)
    and (max_threshold is null or max_threshold >= min_threshold)
  );

-- 主键 (warehouse_id, sku_id) 已经是「仓库 + 规格」的唯一索引；
-- 这里再加一个覆盖索引，预警查询只读 quantity / reserved_qty / min_threshold，可走 index-only scan。
create index if not exists warehouse_stocks_warehouse_sku_threshold_idx
  on warehouse_stocks (warehouse_id, sku_id)
  include (quantity, reserved_qty, min_threshold);

comment on column warehouse_stocks.min_threshold is '仓库安全库存下限：可用量（库存 - 预留）<= 该值时进入低库存预警';
comment on column warehouse_stocks.max_threshold is '仓库库存上限（可选），留空表示不设上限，仅作补货参考';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（仅删除本轮新增列与索引，不触碰库存、预留、流水）
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists warehouse_stocks_warehouse_sku_threshold_idx;
-- alter table warehouse_stocks drop constraint if exists warehouse_stocks_threshold_check;
-- alter table warehouse_stocks drop column if exists min_threshold, drop column if exists max_threshold;
-- commit;

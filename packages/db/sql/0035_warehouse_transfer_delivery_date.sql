-- 0035 分拨单交付日（计划联动）
-- 加法迁移：给 warehouse_transfers 增加 delivery_date，用于「已审核要货单 + 交付日 + 门店」定位草稿。
-- 手工新建的分拨单不写该字段（null），不受索引影响，行为与之前一致。
-- 唯一索引只约束「草稿 + 有交付日」：同一门店同一交付日最多一张待处理草稿，
-- 避免并发重复生成；草稿一旦分配/发出即离开索引，可重新生成新的草稿。

begin;

alter table warehouse_transfers
  add column if not exists delivery_date date;

create index if not exists warehouse_transfers_shop_delivery_idx
  on warehouse_transfers (to_shop_id, delivery_date, status);

create unique index if not exists warehouse_transfers_draft_shop_date_unique
  on warehouse_transfers (to_shop_id, delivery_date)
  where status = 'draft' and delivery_date is not null;

comment on column warehouse_transfers.delivery_date is '计划联动生成的交付日；手工新建为 null';
comment on index warehouse_transfers_draft_shop_date_unique is '同一门店 + 交付日只允许一张草稿，防止重复生成';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（仅删除本轮新增列与索引）
-- ---------------------------------------------------------------------------
-- begin;
-- drop index if exists warehouse_transfers_draft_shop_date_unique;
-- drop index if exists warehouse_transfers_shop_delivery_idx;
-- alter table warehouse_transfers drop column if exists delivery_date;
-- commit;

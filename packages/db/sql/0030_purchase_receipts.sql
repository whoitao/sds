-- 0030 总部仓采购入库质检单
-- 加法迁移：新增 purchase_receipts / purchase_receipt_items；
-- warehouse_stocks.avg_unit_cost（迁移 0023）已存在，直接用于移动加权成本，无需加列。

begin;

create table if not exists purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no varchar(32) not null,
  purchase_order_id uuid not null references purchase_orders(id) on delete restrict,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  -- 本轮只有 posted（已过账），状态流转走 document_events
  status varchar(16) not null default 'posted',
  received_at timestamptz not null default now(),
  received_by_admin_id uuid references admin_users(id) on delete set null,
  -- 本次合格入库金额（合格数量 × 到货实价）
  received_amount numeric(12, 2) not null default 0,
  remark text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_receipts_no_unique unique (receipt_no),
  constraint purchase_receipts_status_check check (status in ('posted'))
);

create index if not exists purchase_receipts_order_idx
  on purchase_receipts (purchase_order_id, received_at desc);
create index if not exists purchase_receipts_warehouse_idx
  on purchase_receipts (warehouse_id, received_at desc);

create table if not exists purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references purchase_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete restrict,
  catalog_sku_id uuid references catalog_skus(id) on delete restrict,
  item_name varchar(100) not null,
  unit varchar(20) not null,
  quantity_mode quantity_mode not null default 'integer',
  -- 应收（本次可收 = 采购数量 - 已收数量）/ 实收 / 合格 / 不合格
  expected_quantity numeric(12, 2) not null,
  received_quantity numeric(12, 2) not null,
  qualified_quantity numeric(12, 2) not null,
  rejected_quantity numeric(12, 2) not null,
  unit_cost numeric(10, 2) not null,
  -- 合格数量 × 到货实价
  amount numeric(12, 2) not null default 0,
  -- 差异原因：shortage 短装 / damaged 破损 / expired 过期 / spec_mismatch 规格不符 / other 其他
  difference_reason varchar(24),
  remark text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  constraint purchase_receipt_items_qty_check check (
    received_quantity >= 0
    and qualified_quantity >= 0
    and rejected_quantity >= 0
    and qualified_quantity + rejected_quantity = received_quantity
  ),
  constraint purchase_receipt_items_reason_check check (
    difference_reason is null
    or difference_reason in ('shortage', 'damaged', 'expired', 'spec_mismatch', 'other')
  ),
  constraint purchase_receipt_items_line_unique unique (receipt_id, purchase_order_item_id)
);

create index if not exists purchase_receipt_items_receipt_idx
  on purchase_receipt_items (receipt_id);
create index if not exists purchase_receipt_items_order_item_idx
  on purchase_receipt_items (purchase_order_item_id);

comment on table purchase_receipts is '总部仓采购入库质检单：只把合格数量写入仓库库存';
comment on table purchase_receipt_items is '入库质检明细：应收/实收/合格/不合格与差异原因，作为拒收记录';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（仅删除本轮新增表，不影响采购单与仓库库存）
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists purchase_receipt_items;
-- drop table if exists purchase_receipts;
-- commit;

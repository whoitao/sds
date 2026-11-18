-- 0031 总部仓分拨单（数据层与状态机）
-- 加法迁移：新增 warehouse_transfers / warehouse_transfer_items。
-- 成本与预留字段复用现有列：warehouse_stocks.avg_unit_cost / reserved_qty（迁移 0023），
-- product_sku_stocks.avg_unit_cost 也已存在，无需新增成本列。

begin;

create table if not exists warehouse_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no varchar(32) not null,
  -- 来源仓库与目标门店均为必填，且分属不同主体表，不存在同为主体的情况
  from_warehouse_id uuid not null references warehouses(id) on delete restrict,
  to_shop_id uuid not null references shops(id) on delete restrict,
  -- draft 草稿 / allocated 已分配 / shipped 已发出 / received 已收货 / cancelled 已取消
  status varchar(16) not null default 'draft',
  requested_by_admin_id uuid references admin_users(id) on delete set null,
  handled_by_admin_id uuid references admin_users(id) on delete set null,
  allocated_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  remark text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_transfers_no_unique unique (transfer_no),
  constraint warehouse_transfers_status_check check (
    status in ('draft', 'allocated', 'shipped', 'received', 'cancelled')
  )
);

create index if not exists warehouse_transfers_status_idx
  on warehouse_transfers (status, created_at desc);
create index if not exists warehouse_transfers_warehouse_idx
  on warehouse_transfers (from_warehouse_id, created_at desc);
create index if not exists warehouse_transfers_shop_idx
  on warehouse_transfers (to_shop_id, created_at desc);

create table if not exists warehouse_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references warehouse_transfers(id) on delete cascade,
  -- 总部规格（必填）；门店 SKU 在分配前完成映射，未映射时为空
  catalog_sku_id uuid not null references catalog_skus(id) on delete restrict,
  product_sku_id uuid references product_skus(id) on delete restrict,
  -- 申请 / 分配 / 发出 / 实收数量
  requested_quantity numeric(12, 2) not null default 0,
  allocated_quantity numeric(12, 2) not null default 0,
  shipped_quantity numeric(12, 2) not null default 0,
  received_quantity numeric(12, 2) not null default 0,
  -- 差异原因：shortage 短装 / damaged 破损 / expired 过期 / spec_mismatch 规格不符 / other 其他
  difference_reason varchar(24),
  -- 分配时冻结的仓库移动加权成本与本次分拨金额
  unit_cost numeric(10, 2) not null default 0,
  amount numeric(12, 2) not null default 0,
  remark text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_transfer_items_line_unique unique (transfer_id, catalog_sku_id),
  constraint warehouse_transfer_items_qty_check check (
    requested_quantity >= 0
    and allocated_quantity >= 0
    and shipped_quantity >= 0
    and received_quantity >= 0
    and allocated_quantity <= requested_quantity
    and shipped_quantity <= allocated_quantity
    and received_quantity <= shipped_quantity
    and amount >= 0
  ),
  constraint warehouse_transfer_items_reason_check check (
    difference_reason is null
    or difference_reason in ('shortage', 'damaged', 'expired', 'spec_mismatch', 'other')
  )
);

create index if not exists warehouse_transfer_items_transfer_idx
  on warehouse_transfer_items (transfer_id);
create index if not exists warehouse_transfer_items_catalog_sku_idx
  on warehouse_transfer_items (catalog_sku_id);
create index if not exists warehouse_transfer_items_product_sku_idx
  on warehouse_transfer_items (product_sku_id)
  where product_sku_id is not null;

comment on table warehouse_transfers is '总部仓到门店分拨单；状态流转记录在 document_events（document_type=warehouse_transfer）';
comment on table warehouse_transfer_items is '分拨单明细：申请/分配/发出/实收数量与成本；部分收货由发出与实收数量派生';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（仅删除本轮新增表，不影响仓库库存与预留量）
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists warehouse_transfer_items;
-- drop table if exists warehouse_transfers;
-- commit;

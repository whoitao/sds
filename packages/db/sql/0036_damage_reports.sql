-- 0036 报损单（门店报损 / 仓内报损）
-- 加法迁移：新建 damage_reports / damage_report_items，不改动现有库存与流水表。
-- 状态：draft → submitted → approved / rejected，全部单向；approve 才写 waste 流水并扣库存。

begin;

create table if not exists damage_reports (
  id uuid primary key default gen_random_uuid(),
  report_no varchar(32) not null,
  subject_type varchar(16) not null,
  shop_id uuid references shops(id) on delete restrict,
  warehouse_id uuid references warehouses(id) on delete restrict,
  status varchar(16) not null default 'draft',
  reason_category varchar(32) not null,
  remark text,
  review_note text,
  created_by_admin_id uuid references admin_users(id) on delete set null,
  submitted_by_admin_id uuid references admin_users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by_admin_id uuid references admin_users(id) on delete set null,
  reviewed_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint damage_reports_subject_check check (
    (subject_type = 'shop' and shop_id is not null and warehouse_id is null)
    or (subject_type = 'warehouse' and warehouse_id is not null and shop_id is null)
  ),
  constraint damage_reports_status_check check (
    status in ('draft', 'submitted', 'approved', 'rejected')
  ),
  constraint damage_reports_reason_check check (
    reason_category in ('expired', 'damaged', 'spoiled', 'other')
  )
);

create unique index if not exists damage_reports_no_unique
  on damage_reports (report_no);
create index if not exists damage_reports_shop_idx
  on damage_reports (shop_id, created_at);
create index if not exists damage_reports_warehouse_idx
  on damage_reports (warehouse_id, created_at);
create index if not exists damage_reports_status_idx
  on damage_reports (status, created_at);

create table if not exists damage_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references damage_reports(id) on delete cascade,
  -- 门店报损用 product_sku_id；仓内报损用 catalog_sku_id；另一列为空
  product_sku_id uuid references product_skus(id) on delete restrict,
  catalog_sku_id uuid references catalog_skus(id) on delete restrict,
  item_name varchar(100) not null,
  spec_name varchar(50),
  unit varchar(20) not null,
  quantity numeric(12, 2) not null,
  unit_cost numeric(10, 2) not null default 0,
  amount numeric(12, 2) not null default 0,
  remark text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  constraint damage_report_items_quantity_check check (quantity >= 0),
  constraint damage_report_items_unit_cost_check check (unit_cost >= 0),
  constraint damage_report_items_amount_check check (amount >= 0),
  constraint damage_report_items_sku_check check (
    product_sku_id is not null or catalog_sku_id is not null
  )
);

create unique index if not exists damage_report_items_shop_sku_unique
  on damage_report_items (report_id, product_sku_id)
  where product_sku_id is not null;
create unique index if not exists damage_report_items_warehouse_sku_unique
  on damage_report_items (report_id, catalog_sku_id)
  where catalog_sku_id is not null;
create index if not exists damage_report_items_report_idx
  on damage_report_items (report_id);

comment on table damage_reports is '报损单：门店报损或仓内报损，approve 时才扣减库存并写 waste 流水';
comment on table damage_report_items is '报损明细：门店侧 product_sku_id，仓库侧 catalog_sku_id';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists damage_report_items;
-- drop table if exists damage_reports;
-- commit;

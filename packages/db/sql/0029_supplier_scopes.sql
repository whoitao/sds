-- 0029 统一供货关系 supplier_scopes
-- 将门店供货关系与仓库供货关系统一到一张表；旧表 shop_suppliers 仅保留历史数据，不再双写。

begin;

create table if not exists supplier_scopes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  subject_type varchar(16) not null,
  subject_id uuid not null,
  status varchar(16) not null default 'active',
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_scopes_subject_type_check check (subject_type in ('shop', 'warehouse')),
  constraint supplier_scopes_status_check check (status in ('active', 'inactive')),
  constraint supplier_scopes_unique unique (supplier_id, subject_type, subject_id)
);

create index if not exists supplier_scopes_subject_idx
  on supplier_scopes (subject_type, subject_id, status);
create index if not exists supplier_scopes_supplier_idx
  on supplier_scopes (supplier_id, status);

-- 回填现有门店供货关系（保留状态、测试标记与时间）
insert into supplier_scopes (
  supplier_id,
  subject_type,
  subject_id,
  status,
  is_test,
  created_at,
  updated_at
)
select
  supplier_id,
  'shop',
  shop_id,
  case when status = 'active' then 'active' else 'inactive' end,
  is_test,
  created_at,
  updated_at
from shop_suppliers
on conflict (supplier_id, subject_type, subject_id) do nothing;

comment on table shop_suppliers is '已废弃（0029）：供货关系统一到 supplier_scopes，本表仅保留历史数据，不再读写';
comment on table supplier_scopes is '供应商供货范围：subject_type=shop 门店 / warehouse 总部仓';

commit;

-- ---------------------------------------------------------------------------
-- 回滚 SQL（删除新表即可；旧表 shop_suppliers 数据未被修改）
-- ---------------------------------------------------------------------------
-- begin;
-- drop table if exists supplier_scopes;
-- comment on table shop_suppliers is null;
-- commit;

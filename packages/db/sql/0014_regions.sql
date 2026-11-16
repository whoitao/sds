-- 0014_regions.sql
-- 行政区划字典：省 / 市 / 区县三级，编码关联，便于按区划聚合订单与用户。
-- 地址表在保留名称快照的同时增加区划编码列。

create table if not exists regions (
  code varchar(12) primary key,
  name varchar(60) not null,
  level smallint not null check (level between 1 and 3),
  parent_code varchar(12) references regions(code),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists regions_parent_idx on regions (parent_code);
create index if not exists regions_level_idx on regions (level);

alter table addresses add column if not exists province_code varchar(12) references regions(code);
alter table addresses add column if not exists city_code varchar(12) references regions(code);
alter table addresses add column if not exists district_code varchar(12) references regions(code);

create index if not exists addresses_district_code_idx on addresses (district_code);

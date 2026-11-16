-- 0013_addresses.sql
-- 顾客收货地址（PRD 5.11）。一个顾客可有多条，仅一条默认。
-- is_default 用部分唯一索引兜住，避免并发设置出现两条默认。

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  contact_name varchar(50) not null,
  contact_phone varchar(11) not null,
  province varchar(20),
  city varchar(20),
  district varchar(20),
  detail varchar(200) not null,
  longitude numeric(10, 7),
  latitude numeric(10, 7),
  is_default boolean not null default false,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists addresses_customer_idx on addresses (customer_id);
create unique index if not exists addresses_default_unique
  on addresses (customer_id)
  where is_default;

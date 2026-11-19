-- 0037 站点设置（站点维护开关 + SEO 默认值）
-- 加法迁移：单行表，id 恒为 1；未保存过时由应用层返回默认值。
-- 维护开关只影响顾客端展示，admin 与 /api/* 不受影响；是否在开发/预览环境生效由 web 端判断。

begin;

create table if not exists site_settings (
  id integer primary key default 1,
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default '站点正在维护，请稍后访问。',
  site_url text not null default '',
  default_title text not null default '',
  default_keywords text not null default '',
  default_description text not null default '',
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

insert into site_settings (id)
values (1)
on conflict (id) do nothing;

commit;

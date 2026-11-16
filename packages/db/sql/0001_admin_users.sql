-- 管理员账号表（与 packages/db/src/schema/admin-users.ts 保持一致）
-- 在 Supabase SQL Editor 中执行；或使用 drizzle-kit generate 生成迁移。

create table if not exists "admin_users" (
  "id" uuid primary key default gen_random_uuid(),
  "username" varchar(50) not null,
  "password_hash" text not null,
  "display_name" varchar(50) not null,
  "role" varchar(32) not null default 'platform_admin',
  "status" smallint not null default 1,
  "failed_login_count" integer not null default 0,
  "locked_until" timestamptz,
  "last_login_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create unique index if not exists "admin_users_username_unique"
  on "admin_users" ("username");

-- 密码哈希通过 `pnpm --filter @sds/api admin:create` 生成，
-- 不要手工插入明文密码。

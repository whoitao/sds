-- 0002_users.sql
-- 对应 PRD 5.1 users（用户表）。只新增，不改动已有表。
-- 幂等写法，可重复执行。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('customer', 'shop_manager', 'shop_staff', 'delivery', 'platform_admin');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone varchar(11) NOT NULL,
  name varchar(50),
  avatar_url text,
  role user_role NOT NULL DEFAULT 'customer',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);

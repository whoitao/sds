-- 0003_shops.sql
-- 对应 PRD 5.2 shops / 5.3 shop_members。当前库中尚无这两张表，全部为新增。
-- 幂等写法，可重复执行。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_status') THEN
    CREATE TYPE shop_status AS ENUM ('open', 'closed', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE member_role AS ENUM ('shop_manager', 'shop_staff', 'delivery');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  cover_url text,
  address varchar(200) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  latitude numeric(10, 7) NOT NULL,
  phone varchar(11),
  business_hours jsonb,
  status shop_status NOT NULL DEFAULT 'open',
  announcement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role member_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_members_shop_user_unique ON shop_members (shop_id, user_id);
CREATE INDEX IF NOT EXISTS shop_members_user_idx ON shop_members (user_id);
CREATE INDEX IF NOT EXISTS shops_status_idx ON shops (status);

-- 0011 顾客认证：customers（顾客资料） + customer_sessions（登录会话）
-- 口径（PRD 5.1 / 5.10）：
--   * users 仍是手机号身份主表（phone UNIQUE），顾客额外挂一条 customers 资料；
--   * customers.user_id 唯一，一个登录身份只对应一个顾客；
--   * addresses / default_address_id 留到地址模块再建，本迁移不提前引用不存在的表；
-- 登录态使用不透明 token（随机串）落库，便于服务端吊销；不用 JWT，避免额外密钥管理。

BEGIN;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  nickname varchar(50),
  real_name varchar(50),
  phone varchar(11),
  total_orders int NOT NULL DEFAULT 0,
  total_spent numeric(10, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_user_unique ON customers (user_id);
CREATE INDEX IF NOT EXISTS customers_created_at_idx ON customers (created_at DESC);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  token varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_sessions_token_unique ON customer_sessions (token);
CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx ON customer_sessions (customer_id);
CREATE INDEX IF NOT EXISTS customer_sessions_expires_idx ON customer_sessions (expires_at);

COMMIT;

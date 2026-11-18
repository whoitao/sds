-- 0022_document_events.sql
-- 单据公共设施：状态流水 + 幂等键（加法迁移，可回滚，不触碰业务表）
BEGIN;

-- 1) 单据状态流水：所有单据类型共用
CREATE TABLE IF NOT EXISTS document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type varchar(32) NOT NULL,
  document_id uuid NOT NULL,
  from_status varchar(24),
  to_status varchar(24) NOT NULL,
  operator_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  operator_name varchar(50),
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_events_doc_idx
  ON document_events (document_type, document_id, created_at);
CREATE INDEX IF NOT EXISTS document_events_created_idx
  ON document_events (created_at);

-- 2) 幂等键：同一 scope 下同一 key 只成功处理一次
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key varchar(120) PRIMARY KEY,
  scope varchar(64) NOT NULL,
  request_hash varchar(64),
  status varchar(16) NOT NULL DEFAULT 'processing',
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT idempotency_keys_status_check CHECK (status IN ('processing', 'completed'))
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS idempotency_keys_scope_idx ON idempotency_keys (scope);

COMMIT;

-- 回滚（手工执行，仅在没有业务单据接入后使用）：
-- BEGIN;
-- DROP TABLE IF EXISTS idempotency_keys;
-- DROP TABLE IF EXISTS document_events;
-- COMMIT;

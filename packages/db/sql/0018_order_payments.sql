-- 0018 支付与退款：把「下单即已付现金」补成真正的交易闭环
--   * 订单状态新增 refund_pending（顾客申请退款，等店长审核）；
--   * order_payments 一单一笔支付流水，线上支付留 external_no 便于对账；
--   * orders 增加退款结果字段，status_before_refund 记录退款被驳回时回滚到哪个状态；
--   * 取消/退款回补库存仍走 stock_movements.order_return（见 0016）。
-- 幂等写法，可重复执行。

-- 枚举新增取值必须在事务外执行，否则同一事务内无法使用
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'refund_pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_record_status') THEN
    CREATE TYPE payment_record_status AS ENUM (
      'created',
      'paid',
      'offline',
      'refunded',
      'cancelled'
    );
  END IF;
END
$$;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10, 2) CHECK (refund_amount IS NULL OR refund_amount >= 0),
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_rejected_reason text,
  ADD COLUMN IF NOT EXISTS status_before_refund order_status;

CREATE TABLE IF NOT EXISTS order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  provider varchar(32) NOT NULL DEFAULT 'sandbox',
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  status payment_record_status NOT NULL DEFAULT 'created',
  external_no varchar(64),
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_payments_status_idx ON order_payments (status);

-- 历史订单补流水：已付的按付款方式回填，未付的留 created
INSERT INTO order_payments (order_id, method, provider, amount, status, external_no, paid_at)
SELECT
  o.id,
  o.payment_method,
  CASE WHEN o.payment_method = 'cash' THEN 'offline' ELSE 'sandbox' END,
  o.total_amount,
  CASE
    WHEN o.status = 'pending_payment' THEN 'created'::payment_record_status
    WHEN o.status = 'refunded' THEN 'refunded'::payment_record_status
    WHEN o.status = 'cancelled' THEN 'cancelled'::payment_record_status
    WHEN o.payment_method = 'cash' THEN 'offline'::payment_record_status
    ELSE 'paid'::payment_record_status
  END,
  CASE WHEN o.payment_method = 'cash' THEN NULL ELSE 'BACKFILL-' || o.order_no END,
  CASE WHEN o.status = 'cancelled' THEN NULL ELSE o.paid_at END
FROM orders o
ON CONFLICT (order_id) DO NOTHING;

COMMIT;

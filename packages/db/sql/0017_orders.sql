-- 0017 订单：顾客下单（一店一单）与订单明细快照
-- 口径：
--   * 购物车按门店分组，每组选中条目生成一张订单；
--   * 下单在同一事务内扣减 product_sku_stocks 并写 sale_out 流水；
--   * 订单明细保存商品名/规格/单价快照，商品改价改名不影响历史单；
--   * 取消订单回补库存并写 order_return 流水。
-- 幂等写法，可重复执行。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'pending_payment',
      'paid',
      'preparing',
      'delivering',
      'pickup_ready',
      'completed',
      'cancelled',
      'refunded'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_type') THEN
    CREATE TYPE fulfillment_type AS ENUM ('delivery', 'pickup');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('wechat', 'cash', 'balance');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(20) NOT NULL,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  status order_status NOT NULL DEFAULT 'paid',
  fulfillment_type fulfillment_type NOT NULL,
  address_id uuid REFERENCES addresses (id) ON DELETE SET NULL,
  contact_name varchar(50),
  contact_phone varchar(11),
  address_text varchar(300),
  item_count numeric(12, 2) NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  subtotal numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee numeric(10, 2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  discount_amount numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount numeric(10, 2) NOT NULL CHECK (total_amount >= 0),
  payment_method payment_method,
  paid_at timestamptz,
  remark text,
  cancelled_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no_unique ON orders (order_no);
CREATE INDEX IF NOT EXISTS orders_shop_created_idx ON orders (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  product_sku_id uuid NOT NULL REFERENCES product_skus (id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  spec_name varchar(100),
  image_url text,
  unit varchar(20) NOT NULL,
  quantity_mode quantity_mode NOT NULL,
  unit_price numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  subtotal numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_sku_idx ON order_items (product_sku_id);

COMMIT;

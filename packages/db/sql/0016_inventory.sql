-- 0016 库存与采购：SKU 库存余额、库存流水、供应商、采购单
-- 口径：
--   * `product_sku_stocks.quantity = Σ stock_movements.quantity_change`；
--   * 采购单提交不改库存，确认收货才写 purchase_in；
--   * 数量统一 numeric(12,2)，每个 SKU 用 quantity_mode 区分整数/两位小数；
--   * 平台运营（ops_manager）补 inventory.write / purchases.write。
-- 幂等写法，可重复执行。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
    CREATE TYPE stock_movement_type AS ENUM (
      'purchase_in',
      'purchase_return',
      'sale_out',
      'order_return',
      'adjustment',
      'waste',
      'initial'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM ('draft', 'submitted', 'received', 'cancelled');
  END IF;
END
$$;

-- 1) 门店 SKU 库存余额
CREATE TABLE IF NOT EXISTS product_sku_stocks (
  product_sku_id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_threshold numeric(12, 2) NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
  max_threshold numeric(12, 2) CHECK (max_threshold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_sku_stocks_sku_fk
    FOREIGN KEY (product_sku_id, shop_id) REFERENCES product_skus (id, shop_id) ON DELETE CASCADE,
  CONSTRAINT product_sku_stocks_threshold_check
    CHECK (max_threshold IS NULL OR max_threshold >= min_threshold)
);

CREATE INDEX IF NOT EXISTS product_sku_stocks_shop_idx
  ON product_sku_stocks (shop_id);

-- 2) 库存流水：唯一事实来源
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE RESTRICT,
  product_sku_id uuid NOT NULL,
  movement_type stock_movement_type NOT NULL,
  quantity_change numeric(12, 2) NOT NULL CHECK (quantity_change <> 0),
  balance_after numeric(12, 2) NOT NULL CHECK (balance_after >= 0),
  unit_cost numeric(10, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reference_type varchar(24),
  reference_id uuid,
  operator_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  operator_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_sku_fk
    FOREIGN KEY (product_sku_id, shop_id) REFERENCES product_skus (id, shop_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_reference_check
    CHECK (reference_id IS NULL OR reference_type IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_biz_unique
  ON stock_movements (shop_id, product_sku_id, movement_type, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_initial_unique
  ON stock_movements (shop_id, product_sku_id) WHERE movement_type = 'initial';
CREATE INDEX IF NOT EXISTS stock_movements_sku_idx
  ON stock_movements (shop_id, product_sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_type_idx
  ON stock_movements (shop_id, movement_type, created_at DESC);

-- 3) 供应商
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  contact_name varchar(50),
  phone varchar(20),
  status varchar(16) NOT NULL DEFAULT 'active',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS suppliers_shop_idx ON suppliers (shop_id, status);

-- 4) 采购单
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  po_no varchar(32) NOT NULL,
  supplier_id uuid REFERENCES suppliers (id) ON DELETE SET NULL,
  supplier_name varchar(100),
  supplier_phone varchar(20),
  status purchase_order_status NOT NULL DEFAULT 'draft',
  ordered_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (ordered_amount >= 0),
  received_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  expected_at timestamptz,
  submitted_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  submitted_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  received_by_admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_po_no_unique
  ON purchase_orders (po_no);
CREATE INDEX IF NOT EXISTS purchase_orders_shop_status_idx
  ON purchase_orders (shop_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  product_sku_id uuid REFERENCES product_skus (id) ON DELETE RESTRICT,
  item_name varchar(100) NOT NULL,
  unit varchar(20) NOT NULL,
  quantity_mode quantity_mode NOT NULL DEFAULT 'integer',
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(10, 2) NOT NULL CHECK (unit_cost >= 0),
  received_quantity numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  difference_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_sku_unique
  ON purchase_order_items (purchase_order_id, product_sku_id)
  WHERE product_sku_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx
  ON purchase_order_items (purchase_order_id);

-- 5) 迁移旧库存余额：只迁默认 SKU
INSERT INTO product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
SELECT ps.id, ps.shop_id, old.quantity::numeric(12, 2), 0
FROM product_stocks old
JOIN product_skus ps ON ps.product_id = old.product_id AND ps.is_default
ON CONFLICT (product_sku_id) DO NOTHING;

-- 5.1) 0015 回填出的 SKU 也必须有零库存行，否则无法入库/盘点
INSERT INTO product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
SELECT ps.id, ps.shop_id, 0, 0
FROM product_skus ps
ON CONFLICT (product_sku_id) DO NOTHING;

-- 6) 期初流水：保证 quantity = Σ quantity_change 从迁移当天成立
INSERT INTO stock_movements (
  shop_id, product_sku_id, movement_type, quantity_change, balance_after,
  reference_type, remark
)
SELECT s.shop_id, s.product_sku_id, 'initial', s.quantity, s.quantity,
       'initial', '系统初始化'
FROM product_sku_stocks s
WHERE s.quantity > 0
ON CONFLICT DO NOTHING;

-- 7) 平台运营补库存/采购写权限
INSERT INTO admin_role_permissions (role_id, permission_id, conditions)
SELECT r.id, p.id, NULL
FROM admin_roles r
JOIN admin_permissions p ON p.code IN ('inventory.write', 'purchases.write')
WHERE r.code = 'ops_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

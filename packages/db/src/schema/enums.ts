import { pgEnum } from 'drizzle-orm/pg-core';

/** 库存追踪方式：tracked 关联库存表 / untracked 不追踪。总部商品与门店商品共用 */
export const productStockTypeEnum = pgEnum('product_stock_type', ['tracked', 'untracked']);

/** SKU 数量模式：整数商品（个/袋/箱） vs 可称重/计量商品（斤/kg/L） */
export const quantityModeEnum = pgEnum('quantity_mode', ['integer', 'decimal_2']);

export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'purchase_in',
  'purchase_return',
  'sale_out',
  'order_return',
  'adjustment',
  'waste',
  'initial'
]);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft',
  'submitted',
  'received',
  'cancelled'
]);

/** 订单状态机，与 @sds/shared 的 ORDER_STATUS 保持一致；refund_pending 由 ALTER TYPE 追加，故排在最后 */
export const orderStatusEnum = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'completed',
  'cancelled',
  'refunded',
  'refund_pending'
]);

/** 履约方式：配送上门 / 到店自取 */
export const fulfillmentTypeEnum = pgEnum('fulfillment_type', ['delivery', 'pickup']);

/** 付款方式；cash 为货到付款/到店付现金，wechat 走线上支付 */
export const paymentMethodEnum = pgEnum('payment_method', ['wechat', 'cash', 'balance']);

/** 支付流水状态：created 待支付 / paid 线上已付 / offline 线下收款 / refunded 已退 / cancelled 已作废 */
export const paymentRecordStatusEnum = pgEnum('payment_record_status', [
  'created',
  'paid',
  'offline',
  'refunded',
  'cancelled'
]);

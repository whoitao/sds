import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { addresses, customers } from './customers.ts';
import {
  fulfillmentTypeEnum,
  orderStatusEnum,
  paymentMethodEnum,
  paymentRecordStatusEnum,
  quantityModeEnum
} from './enums.ts';
import { productSkus } from './skus.ts';
import { shops } from './shops.ts';

/**
 * 顾客订单，对应迁移 0017。
 * - 一店一单：购物车按门店分组，下单时每组生成一单；
 * - 商品信息为下单时快照，门店改价/改名不影响历史订单；
 * - 地址同时保留 address_id 与文本快照，删地址不影响订单展示；
 * - 状态流转在 API 层校验，取消订单会回补库存。
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNo: varchar('order_no', { length: 20 }).notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('paid'),
    fulfillmentType: fulfillmentTypeEnum('fulfillment_type').notNull(),
    addressId: uuid('address_id').references(() => addresses.id, { onDelete: 'set null' }),
    contactName: varchar('contact_name', { length: 50 }),
    contactPhone: varchar('contact_phone', { length: 11 }),
    addressText: varchar('address_text', { length: 300 }),
    itemCount: numeric('item_count', { precision: 12, scale: 2 }).notNull().default('0'),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    deliveryFee: numeric('delivery_fee', { precision: 10, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
    paymentMethod: paymentMethodEnum('payment_method'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    remark: text('remark'),
    cancelledReason: text('cancelled_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundAmount: numeric('refund_amount', { precision: 10, scale: 2 }),
    refundReason: text('refund_reason'),
    refundRejectedReason: text('refund_rejected_reason'),
    statusBeforeRefund: orderStatusEnum('status_before_refund'),
    /** 测试/演示订单标记；清理接口只删 is_test=true */
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    orderNoUnique: uniqueIndex('orders_order_no_unique').on(t.orderNo),
    shopCreatedIdx: index('orders_shop_created_idx').on(t.shopId, t.createdAt),
    customerCreatedIdx: index('orders_customer_created_idx').on(t.customerId, t.createdAt),
    statusIdx: index('orders_status_idx').on(t.status, t.createdAt)
  })
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    productSkuId: uuid('product_sku_id')
      .notNull()
      .references(() => productSkus.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    specName: varchar('spec_name', { length: 100 }),
    imageUrl: text('image_url'),
    unit: varchar('unit', { length: 20 }).notNull(),
    quantityMode: quantityModeEnum('quantity_mode').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    orderIdx: index('order_items_order_idx').on(t.orderId),
    skuIdx: index('order_items_sku_idx').on(t.productSkuId)
  })
);

/**
 * 支付流水，对应迁移 0018。一单一笔：
 * - 线上支付（微信）先落 created，支付成功转 paid 并写 external_no；
 * - 货到付款落 offline，表示钱在配送/自取时当面收；
 * - 退款审核通过后转 refunded，订单状态变 refunded 并回补库存。
 */
export const orderPayments = pgTable(
  'order_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum('method').notNull(),
    provider: varchar('provider', { length: 32 }).notNull().default('sandbox'),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    status: paymentRecordStatusEnum('status').notNull().default('created'),
    externalNo: varchar('external_no', { length: 64 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundReason: text('refund_reason'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    statusIdx: index('order_payments_status_idx').on(t.status)
  })
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  address: one(addresses, { fields: [orders.addressId], references: [addresses.id] }),
  items: many(orderItems),
  payment: one(orderPayments, { fields: [orders.id], references: [orderPayments.orderId] })
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  sku: one(productSkus, {
    fields: [orderItems.productSkuId],
    references: [productSkus.id]
  })
}));

export const orderPaymentsRelations = relations(orderPayments, ({ one }) => ({
  order: one(orders, { fields: [orderPayments.orderId], references: [orders.id] })
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type OrderPayment = typeof orderPayments.$inferSelect;
export type NewOrderPayment = typeof orderPayments.$inferInsert;

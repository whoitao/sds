import { relations, sql } from 'drizzle-orm';
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.ts';
import { purchaseOrderStatusEnum, quantityModeEnum } from './enums.ts';
import { productSkus } from './skus.ts';
import { shops } from './shops.ts';

/** 门店供应商：平台运营按门店维护；不做供应商端登录/账期/结算。 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    contactName: varchar('contact_name', { length: 50 }),
    phone: varchar('phone', { length: 20 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopIdx: index('suppliers_shop_idx').on(t.shopId, t.status)
  })
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    poNo: varchar('po_no', { length: 32 }).notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null'
    }),
    supplierName: varchar('supplier_name', { length: 100 }),
    supplierPhone: varchar('supplier_phone', { length: 20 }),
    status: purchaseOrderStatusEnum('status').notNull().default('draft'),
    orderedAmount: numeric('ordered_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    receivedAmount: numeric('received_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    expectedAt: timestamp('expected_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    submittedByAdminId: uuid('submitted_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    receivedByAdminId: uuid('received_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    poNoUnique: uniqueIndex('purchase_orders_po_no_unique').on(t.poNo),
    shopStatusIdx: index('purchase_orders_shop_status_idx').on(
      t.shopId,
      t.status,
      t.createdAt
    )
  })
);

/**
 * 采购明细。`product_sku_id` 为空表示包装袋/清洁用品等非售卖物料：
 * 计入采购金额，但收货时不产生 SKU 库存流水。
 */
export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productSkuId: uuid('product_sku_id').references(() => productSkus.id, {
      onDelete: 'restrict'
    }),
    itemName: varchar('item_name', { length: 100 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(),
    quantityMode: quantityModeEnum('quantity_mode').notNull().default('integer'),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).notNull(),
    receivedQuantity: numeric('received_quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    differenceReason: text('difference_reason')
  },
  (t) => ({
    skuUnique: uniqueIndex('purchase_order_items_sku_unique')
      .on(t.purchaseOrderId, t.productSkuId)
      .where(sql`${t.productSkuId} is not null`),
    orderIdx: index('purchase_order_items_order_idx').on(t.purchaseOrderId)
  })
);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  shop: one(shops, { fields: [suppliers.shopId], references: [shops.id] }),
  purchaseOrders: many(purchaseOrders)
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  shop: one(shops, { fields: [purchaseOrders.shopId], references: [shops.id] }),
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id]
  }),
  items: many(purchaseOrderItems)
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id]
  }),
  sku: one(productSkus, {
    fields: [purchaseOrderItems.productSkuId],
    references: [productSkus.id]
  })
}));

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;

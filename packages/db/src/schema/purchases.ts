import { relations, sql } from 'drizzle-orm';
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
import { adminUsers } from './admin-users.ts';
import { demandPlans } from './demand-plans.ts';
import { purchaseOrderStatusEnum, quantityModeEnum } from './enums.ts';
import { catalogSkus, productSkus } from './skus.ts';
import { shops } from './shops.ts';
import { warehouses } from './warehouses.ts';

/**
 * 平台级供应商主体（迁移 0020）。
 * - `legacyShopId` 只保留历史「门店附属」形态，新供应商不再写入；
 * - 门店/仓库可见范围由 `supplier_scopes` 供货范围决定；
 * - 采购单仍保存供应商名称/电话快照，改名不影响历史单据。
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }),
    /** 历史字段：旧版按门店建供应商时写入，删门店置空，不再级联删除 */
    legacyShopId: uuid('legacy_shop_id').references(() => shops.id, {
      onDelete: 'set null'
    }),
    name: varchar('name', { length: 100 }).notNull(),
    contactName: varchar('contact_name', { length: 50 }),
    phone: varchar('phone', { length: 20 }),
    address: text('address'),
    settlementMethod: varchar('settlement_method', { length: 32 }),
    taxNo: varchar('tax_no', { length: 50 }),
    email: varchar('email', { length: 120 }),
    lastPurchaseAt: timestamp('last_purchase_at', { withTimezone: true }),
    /** 供应商合并指向的主档案；合并策略落地前保持为空 */
    mergedIntoId: uuid('merged_into_id'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    codeUnique: uniqueIndex('suppliers_code_unique')
      .on(t.code)
      .where(sql`${t.code} is not null`),
    legacyShopIdx: index('suppliers_legacy_shop_idx').on(t.legacyShopId, t.status),
    nameIdx: index('suppliers_name_idx').on(t.name)
  })
);

/** 供应商 → 门店的供货关系；迁移 0029 起仅保留历史数据，读写统一走 supplierScopes。 */
export const shopSuppliers = pgTable(
  'shop_suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    relationUnique: uniqueIndex('shop_suppliers_unique').on(t.supplierId, t.shopId),
    shopIdx: index('shop_suppliers_shop_idx').on(t.shopId, t.status),
    supplierIdx: index('shop_suppliers_supplier_idx').on(t.supplierId)
  })
);

/** 供应商统一供货范围：门店与总部仓共用（迁移 0029）。 */
export const supplierScopes = pgTable(
  'supplier_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    /** shop / warehouse */
    subjectType: varchar('subject_type', { length: 16 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    unique: uniqueIndex('supplier_scopes_unique').on(t.supplierId, t.subjectType, t.subjectId),
    subjectIdx: index('supplier_scopes_subject_idx').on(t.subjectType, t.subjectId, t.status),
    supplierIdx: index('supplier_scopes_supplier_idx').on(t.supplierId, t.status)
  })
);

export const supplierScopesRelations = relations(supplierScopes, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierScopes.supplierId],
    references: [suppliers.id]
  })
}));

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 门店采购主体；与 warehouse_id 二选一（迁移 0028） */
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    /** 总部仓采购主体；与 shop_id 二选一（迁移 0028） */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, {
      onDelete: 'restrict'
    }),
    poNo: varchar('po_no', { length: 32 }).notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null'
    }),
    supplierName: varchar('supplier_name', { length: 100 }),
    supplierPhone: varchar('supplier_phone', { length: 20 }),
    /** 需求计划关联（迁移 0026）：从计划明细生成采购单时带入，手工采购为空 */
    demandPlanId: uuid('demand_plan_id').references(() => demandPlans.id, {
      onDelete: 'set null'
    }),
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
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    poNoUnique: uniqueIndex('purchase_orders_po_no_unique').on(t.poNo),
    shopStatusIdx: index('purchase_orders_shop_status_idx').on(
      t.shopId,
      t.status,
      t.createdAt
    ),
    warehouseStatusIdx: index('purchase_orders_warehouse_status_idx').on(
      t.warehouseId,
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
    /** 总部仓采购明细指向总部规格；与 product_sku_id 二选一（迁移 0028） */
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
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
    differenceReason: text('difference_reason'),
    isTest: boolean('is_test').notNull().default(false)
  },
  (t) => ({
    skuUnique: uniqueIndex('purchase_order_items_sku_unique')
      .on(t.purchaseOrderId, t.productSkuId)
      .where(sql`${t.productSkuId} is not null`),
    catalogSkuUnique: uniqueIndex('purchase_order_items_catalog_sku_unique')
      .on(t.purchaseOrderId, t.catalogSkuId)
      .where(sql`${t.catalogSkuId} is not null`),
    orderIdx: index('purchase_order_items_order_idx').on(t.purchaseOrderId)
  })
);

/**
 * 总部仓采购入库质检单（迁移 0030）。
 * 一次到货生成一张单，只把 `purchase_receipt_items.qualified_quantity` 写入仓库库存；
 * 不合格数量仅作为拒收记录保留，待后续退货单流程使用。
 */
export const purchaseReceipts = pgTable(
  'purchase_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptNo: varchar('receipt_no', { length: 32 }).notNull(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    /** 本轮仅 posted（已过账），状态流转记录在 document_events */
    status: varchar('status', { length: 16 }).notNull().default('posted'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    receivedByAdminId: uuid('received_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 本次合格入库金额（合格数量 × 到货实价） */
    receivedAmount: numeric('received_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    receiptNoUnique: uniqueIndex('purchase_receipts_no_unique').on(t.receiptNo),
    orderIdx: index('purchase_receipts_order_idx').on(t.purchaseOrderId, t.receivedAt),
    warehouseIdx: index('purchase_receipts_warehouse_idx').on(t.warehouseId, t.receivedAt)
  })
);

/** 入库质检明细：应收/实收/合格/不合格 + 差异原因，兼作拒收记录。 */
export const purchaseReceiptItems = pgTable(
  'purchase_receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => purchaseReceipts.id, { onDelete: 'cascade' }),
    purchaseOrderItemId: uuid('purchase_order_item_id')
      .notNull()
      .references(() => purchaseOrderItems.id, { onDelete: 'restrict' }),
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
      onDelete: 'restrict'
    }),
    itemName: varchar('item_name', { length: 100 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(),
    quantityMode: quantityModeEnum('quantity_mode').notNull().default('integer'),
    /** 本次应收 = 采购数量 - 已收数量 */
    expectedQuantity: numeric('expected_quantity', { precision: 12, scale: 2 }).notNull(),
    receivedQuantity: numeric('received_quantity', { precision: 12, scale: 2 }).notNull(),
    qualifiedQuantity: numeric('qualified_quantity', { precision: 12, scale: 2 }).notNull(),
    rejectedQuantity: numeric('rejected_quantity', { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    /** shortage 短装 / damaged 破损 / expired 过期 / spec_mismatch 规格不符 / other 其他 */
    differenceReason: varchar('difference_reason', { length: 24 }),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    lineUnique: uniqueIndex('purchase_receipt_items_line_unique').on(
      t.receiptId,
      t.purchaseOrderItemId
    ),
    receiptIdx: index('purchase_receipt_items_receipt_idx').on(t.receiptId),
    orderItemIdx: index('purchase_receipt_items_order_item_idx').on(t.purchaseOrderItemId)
  })
);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  legacyShop: one(shops, { fields: [suppliers.legacyShopId], references: [shops.id] }),
  shopLinks: many(shopSuppliers),
  purchaseOrders: many(purchaseOrders)
}));

export const shopSuppliersRelations = relations(shopSuppliers, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [shopSuppliers.supplierId],
    references: [suppliers.id]
  }),
  shop: one(shops, { fields: [shopSuppliers.shopId], references: [shops.id] })
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  shop: one(shops, { fields: [purchaseOrders.shopId], references: [shops.id] }),
  warehouse: one(warehouses, {
    fields: [purchaseOrders.warehouseId],
    references: [warehouses.id]
  }),
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id]
  }),
  items: many(purchaseOrderItems),
  receipts: many(purchaseReceipts)
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id]
  }),
  sku: one(productSkus, {
    fields: [purchaseOrderItems.productSkuId],
    references: [productSkus.id]
  }),
  catalogSku: one(catalogSkus, {
    fields: [purchaseOrderItems.catalogSkuId],
    references: [catalogSkus.id]
  })
}));

export const purchaseReceiptsRelations = relations(purchaseReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseReceipts.purchaseOrderId],
    references: [purchaseOrders.id]
  }),
  warehouse: one(warehouses, {
    fields: [purchaseReceipts.warehouseId],
    references: [warehouses.id]
  }),
  items: many(purchaseReceiptItems)
}));

export const purchaseReceiptItemsRelations = relations(purchaseReceiptItems, ({ one }) => ({
  receipt: one(purchaseReceipts, {
    fields: [purchaseReceiptItems.receiptId],
    references: [purchaseReceipts.id]
  }),
  purchaseOrderItem: one(purchaseOrderItems, {
    fields: [purchaseReceiptItems.purchaseOrderItemId],
    references: [purchaseOrderItems.id]
  }),
  catalogSku: one(catalogSkus, {
    fields: [purchaseReceiptItems.catalogSkuId],
    references: [catalogSkus.id]
  })
}));

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type ShopSupplier = typeof shopSuppliers.$inferSelect;
export type NewShopSupplier = typeof shopSuppliers.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
export type PurchaseReceipt = typeof purchaseReceipts.$inferSelect;
export type NewPurchaseReceipt = typeof purchaseReceipts.$inferInsert;
export type PurchaseReceiptItem = typeof purchaseReceiptItems.$inferSelect;
export type NewPurchaseReceiptItem = typeof purchaseReceiptItems.$inferInsert;

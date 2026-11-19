import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
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
import { catalogSkus, productSkus } from './skus.ts';
import { shops } from './shops.ts';
import { warehouses } from './warehouses.ts';

/**
 * 总部仓 → 门店分拨单（迁移 0031）。
 * 状态：draft 草稿 / allocated 已分配 / shipped 已发出 / received 已收货 / cancelled 已取消；
 * 状态流转由 `document_events`（document_type=warehouse_transfer）记录。
 */
export const warehouseTransfers = pgTable(
  'warehouse_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferNo: varchar('transfer_no', { length: 32 }).notNull(),
    /** 来源仓库与目标门店均为必填，分属不同主体表 */
    fromWarehouseId: uuid('from_warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    toShopId: uuid('to_shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    /** 计划联动（要货单 → 分拨单）使用的交付日；手工新建为 null */
    deliveryDate: date('delivery_date', { mode: 'string' }),
    requestedByAdminId: uuid('requested_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    handledByAdminId: uuid('handled_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 建议收货责任人：发货时按目标门店店长自动带出，可修改；为空表示未指派 */
    receiverAdminId: uuid('receiver_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 实际收货人：代收时与建议责任人不一致 */
    receivedByAdminId: uuid('received_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 应收货截止时间：全部发出时按 SLA 写入 */
    receiveDueAt: timestamp('receive_due_at', { withTimezone: true }),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    /** 门店确认差异关闭的时间：与「全部收满」区分，二者都会进入 received */
    differenceClosedAt: timestamp('difference_closed_at', { withTimezone: true }),
    differenceCloseReason: text('difference_close_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    transferNoUnique: uniqueIndex('warehouse_transfers_no_unique').on(t.transferNo),
    statusIdx: index('warehouse_transfers_status_idx').on(t.status, t.createdAt),
    warehouseIdx: index('warehouse_transfers_warehouse_idx').on(
      t.fromWarehouseId,
      t.createdAt
    ),
    shopIdx: index('warehouse_transfers_shop_idx').on(t.toShopId, t.createdAt),
    receiverIdx: index('warehouse_transfers_receiver_idx').on(
      t.receiverAdminId,
      t.status,
      t.receiveDueAt
    )
  })
);

/**
 * 分拨单明细：总部规格 → 门店 SKU。
 * `product_sku_id` 可为空表示尚未完成门店建档映射；未映射时由服务层禁止分拨。
 * 数量约束：申请 ≥ 分配 ≥ 发出 ≥ 实收，部分收货由数量派生，不新增状态。
 */
export const warehouseTransferItems = pgTable(
  'warehouse_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => warehouseTransfers.id, { onDelete: 'cascade' }),
    catalogSkuId: uuid('catalog_sku_id')
      .notNull()
      .references(() => catalogSkus.id, { onDelete: 'restrict' }),
    productSkuId: uuid('product_sku_id').references(() => productSkus.id, {
      onDelete: 'restrict'
    }),
    requestedQuantity: numeric('requested_quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    allocatedQuantity: numeric('allocated_quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    shippedQuantity: numeric('shipped_quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    receivedQuantity: numeric('received_quantity', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** 差异原因：shortage / damaged / expired / spec_mismatch / other */
    differenceReason: varchar('difference_reason', { length: 24 }),
    /** 差异关闭时冻结的损耗数量与金额；门店库存不因损耗再变动 */
    lossQuantity: numeric('loss_quantity', { precision: 12, scale: 2 }).notNull().default('0'),
    lossAmount: numeric('loss_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    /** 分配时冻结的仓库移动加权成本与本次分拨金额 */
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).notNull().default('0'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    lineUnique: uniqueIndex('warehouse_transfer_items_line_unique').on(
      t.transferId,
      t.catalogSkuId
    ),
    transferIdx: index('warehouse_transfer_items_transfer_idx').on(t.transferId),
    catalogSkuIdx: index('warehouse_transfer_items_catalog_sku_idx').on(t.catalogSkuId),
    productSkuIdx: index('warehouse_transfer_items_product_sku_idx')
      .on(t.productSkuId)
      .where(sql`${t.productSkuId} is not null`)
  })
);

export const warehouseTransfersRelations = relations(warehouseTransfers, ({ one, many }) => ({
  fromWarehouse: one(warehouses, {
    fields: [warehouseTransfers.fromWarehouseId],
    references: [warehouses.id]
  }),
  toShop: one(shops, {
    fields: [warehouseTransfers.toShopId],
    references: [shops.id]
  }),
  items: many(warehouseTransferItems)
}));

export const warehouseTransferItemsRelations = relations(
  warehouseTransferItems,
  ({ one }) => ({
    transfer: one(warehouseTransfers, {
      fields: [warehouseTransferItems.transferId],
      references: [warehouseTransfers.id]
    }),
    catalogSku: one(catalogSkus, {
      fields: [warehouseTransferItems.catalogSkuId],
      references: [catalogSkus.id]
    }),
    productSku: one(productSkus, {
      fields: [warehouseTransferItems.productSkuId],
      references: [productSkus.id]
    })
  })
);

export type WarehouseTransfer = typeof warehouseTransfers.$inferSelect;
export type NewWarehouseTransfer = typeof warehouseTransfers.$inferInsert;
export type WarehouseTransferItem = typeof warehouseTransferItems.$inferSelect;
export type NewWarehouseTransferItem = typeof warehouseTransferItems.$inferInsert;

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.ts';
import { catalogCategories } from './catalog.ts';
import { shops } from './shops.ts';
import { catalogSkus, productSkus } from './skus.ts';

/**
 * 管理员门店数据范围（迁移 0024）。
 * - 有绑定的非超管只看绑定门店；
 * - 没有绑定的非超管保持全部门店，兼容现有 ops_manager；
 * - super_admin 由接口层放行，不受此表限制。
 */
export const adminUserShops = pgTable(
  'admin_user_shops',
  {
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.adminUserId, t.shopId] }),
    shopIdx: index('admin_user_shops_shop_idx').on(t.shopId)
  })
);

/**
 * 门店要货单（迁移 0024）。
 * 状态：draft 草稿 / submitted 已提交 / approved 已审核 / withdrawn 已撤回。
 * 同一门店 + 交付日只允许一张 submitted/approved 单据，由部分唯一索引兜底。
 */
export const shopRequisitions = pgTable(
  'shop_requisitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requisitionNo: varchar('requisition_no', { length: 32 }).notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    expectedDate: date('expected_date', { mode: 'string' }).notNull(),
    timeWindow: varchar('time_window', { length: 16 }).notNull().default('all_day'),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    remark: text('remark'),
    submittedByAdminId: uuid('submitted_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 测试/演示标记；明细从主表继承 */
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    noUnique: uniqueIndex('shop_requisitions_no_unique').on(t.requisitionNo),
    shopDateIdx: index('shop_requisitions_shop_date_idx').on(
      t.shopId,
      t.expectedDate,
      t.createdAt
    ),
    statusIdx: index('shop_requisitions_status_idx').on(t.status, t.expectedDate)
  })
);

/** 要货明细：门店 SKU 必填，总部 SKU 由接口从门店 SKU 反查后落快照。 */
export const shopRequisitionItems = pgTable(
  'shop_requisition_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requisitionId: uuid('requisition_id')
      .notNull()
      .references(() => shopRequisitions.id, { onDelete: 'cascade' }),
    productSkuId: uuid('product_sku_id')
      .notNull()
      .references(() => productSkus.id, { onDelete: 'restrict' }),
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
      onDelete: 'restrict'
    }),
    itemName: varchar('item_name', { length: 100 }).notNull(),
    specName: varchar('spec_name', { length: 50 }),
    categoryId: uuid('category_id').references(() => catalogCategories.id, {
      onDelete: 'set null'
    }),
    categoryName: varchar('category_name', { length: 50 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    requestedQty: numeric('requested_qty', { precision: 12, scale: 2 }).notNull(),
    approvedQty: numeric('approved_qty', { precision: 12, scale: 2 }),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    skuUnique: uniqueIndex('shop_requisition_items_sku_unique').on(
      t.requisitionId,
      t.productSkuId
    ),
    catalogIdx: index('shop_requisition_items_catalog_idx').on(t.catalogSkuId)
  })
);

export const shopRequisitionsRelations = relations(shopRequisitions, ({ one, many }) => ({
  shop: one(shops, { fields: [shopRequisitions.shopId], references: [shops.id] }),
  items: many(shopRequisitionItems)
}));

export const shopRequisitionItemsRelations = relations(shopRequisitionItems, ({ one }) => ({
  requisition: one(shopRequisitions, {
    fields: [shopRequisitionItems.requisitionId],
    references: [shopRequisitions.id]
  }),
  productSku: one(productSkus, {
    fields: [shopRequisitionItems.productSkuId],
    references: [productSkus.id]
  })
}));

export type ShopRequisition = typeof shopRequisitions.$inferSelect;
export type NewShopRequisition = typeof shopRequisitions.$inferInsert;
export type ShopRequisitionItem = typeof shopRequisitionItems.$inferSelect;
export type NewShopRequisitionItem = typeof shopRequisitionItems.$inferInsert;

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
import { catalogSkus, productSkus } from './skus.ts';
import { shops } from './shops.ts';
import { warehouses } from './warehouses.ts';

/**
 * 报损单（迁移 0036）。
 * 主体二选一：门店（subject_type=shop + shop_id）或仓库（warehouse=warehouse + warehouse_id）。
 * 状态：draft → submitted → approved / rejected，全部单向，驳回为终态。
 * 只有 approved 才扣减库存并写 movement_type='waste' 流水，reference_type='damage_report'。
 */
export const damageReports = pgTable(
  'damage_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportNo: varchar('report_no', { length: 32 }).notNull(),
    subjectType: varchar('subject_type', { length: 16 }).notNull(),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, {
      onDelete: 'restrict'
    }),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    reasonCategory: varchar('reason_category', { length: 32 }).notNull(),
    remark: text('remark'),
    reviewNote: text('review_note'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    submittedByAdminId: uuid('submitted_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    noUnique: uniqueIndex('damage_reports_no_unique').on(t.reportNo),
    shopIdx: index('damage_reports_shop_idx').on(t.shopId, t.createdAt),
    warehouseIdx: index('damage_reports_warehouse_idx').on(t.warehouseId, t.createdAt),
    statusIdx: index('damage_reports_status_idx').on(t.status, t.createdAt)
  })
);

/** 报损明细：门店侧用门店 SKU，仓库侧用总部规格，另一列为空。 */
export const damageReportItems = pgTable(
  'damage_report_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => damageReports.id, { onDelete: 'cascade' }),
    productSkuId: uuid('product_sku_id').references(() => productSkus.id, {
      onDelete: 'restrict'
    }),
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
      onDelete: 'restrict'
    }),
    itemName: varchar('item_name', { length: 100 }).notNull(),
    specName: varchar('spec_name', { length: 50 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }).notNull().default('0'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopSkuUnique: uniqueIndex('damage_report_items_shop_sku_unique')
      .on(t.reportId, t.productSkuId)
      .where(sql`${t.productSkuId} is not null`),
    warehouseSkuUnique: uniqueIndex('damage_report_items_warehouse_sku_unique')
      .on(t.reportId, t.catalogSkuId)
      .where(sql`${t.catalogSkuId} is not null`),
    reportIdx: index('damage_report_items_report_idx').on(t.reportId)
  })
);

export const damageReportsRelations = relations(damageReports, ({ one, many }) => ({
  shop: one(shops, { fields: [damageReports.shopId], references: [shops.id] }),
  warehouse: one(warehouses, {
    fields: [damageReports.warehouseId],
    references: [warehouses.id]
  }),
  items: many(damageReportItems)
}));

export const damageReportItemsRelations = relations(damageReportItems, ({ one }) => ({
  report: one(damageReports, {
    fields: [damageReportItems.reportId],
    references: [damageReports.id]
  }),
  productSku: one(productSkus, {
    fields: [damageReportItems.productSkuId],
    references: [productSkus.id]
  }),
  catalogSku: one(catalogSkus, {
    fields: [damageReportItems.catalogSkuId],
    references: [catalogSkus.id]
  })
}));

export type DamageReport = typeof damageReports.$inferSelect;
export type NewDamageReport = typeof damageReports.$inferInsert;
export type DamageReportItem = typeof damageReportItems.$inferSelect;
export type NewDamageReportItem = typeof damageReportItems.$inferInsert;

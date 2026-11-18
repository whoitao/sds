import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.ts';
import { catalogCategories } from './catalog.ts';
import { catalogSkus } from './skus.ts';
import { warehouses } from './warehouses.ts';

/** 需求计划明细里的门店拆分，按 jsonb 存快照，便于展开但不额外建表。 */
export interface DemandPlanShopBreakdown {
  shopId: string;
  shopName: string;
  requisitionId: string;
  requisitionNo: string;
  requestedQty: string;
  approvedQty: string;
}

/**
 * 需求汇总计划（迁移 0025）。
 * 策略：重新汇总生成新版本；旧版本标记 superseded，已被采购单引用的当前版本拒绝重算。
 */
export const demandPlans = pgTable(
  'demand_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planNo: varchar('plan_no', { length: 32 }).notNull(),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 16 }).notNull().default('collecting'),
    isCurrent: boolean('is_current').notNull().default(true),
    totalSkus: integer('total_skus').notNull().default(0),
    totalRequestedQty: numeric('total_requested_qty', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    remark: text('remark'),
    decidedByAdminId: uuid('decided_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    /** 测试/演示标记；明细从主表继承 */
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    noUnique: uniqueIndex('demand_plans_no_unique').on(t.planNo),
    versionUnique: uniqueIndex('demand_plans_version_unique').on(
      t.deliveryDate,
      t.warehouseId,
      t.version
    ),
    currentIdx: index('demand_plans_current_idx').on(t.deliveryDate, t.warehouseId)
  })
);

export const demandPlanItems = pgTable(
  'demand_plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    demandPlanId: uuid('demand_plan_id')
      .notNull()
      .references(() => demandPlans.id, { onDelete: 'cascade' }),
    catalogSkuId: uuid('catalog_sku_id')
      .notNull()
      .references(() => catalogSkus.id, { onDelete: 'restrict' }),
    itemName: varchar('item_name', { length: 100 }).notNull(),
    specName: varchar('spec_name', { length: 50 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    categoryId: uuid('category_id').references(() => catalogCategories.id, {
      onDelete: 'set null'
    }),
    categoryName: varchar('category_name', { length: 50 }),
    totalRequestedQty: numeric('total_requested_qty', { precision: 14, scale: 2 }).notNull(),
    finalQty: numeric('final_qty', { precision: 14, scale: 2 }).notNull(),
    purchasePath: varchar('purchase_path', { length: 24 }).notNull().default('centralized'),
    shopBreakdown: jsonb('shop_breakdown').$type<DemandPlanShopBreakdown[]>().notNull().default([]),
    decisionNote: text('decision_note'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    catalogUnique: uniqueIndex('demand_plan_items_catalog_unique').on(
      t.demandPlanId,
      t.catalogSkuId
    ),
    categoryIdx: index('demand_plan_items_category_idx').on(t.demandPlanId, t.categoryName)
  })
);

export type DemandPlan = typeof demandPlans.$inferSelect;
export type DemandPlanItem = typeof demandPlanItems.$inferSelect;

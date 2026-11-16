import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  smallint,
  boolean,
  timestamp,
  index
} from 'drizzle-orm/pg-core';
import { productStockTypeEnum } from './enums';
import { shops } from './shops';

/**
 * 总部标准分类树，对应多店方案 P1（SQL 迁移 0008）。
 * - 结构与 `categories` 一致：固定两级，level=1 顶级、level=2 子级；
 * - 同级名唯一（SQL 里用 `NULLS NOT DISTINCT`，drizzle 0.36 无法表达，以迁移为准）；
 * - 门店不复制分类，只能通过 `shop_hidden_categories`（P5）隐藏。
 */
export const catalogCategories = pgTable(
  'catalog_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    level: smallint('level').notNull().default(1),
    name: varchar('name', { length: 50 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    iconUrl: text('icon_url'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    parentIdx: index('catalog_categories_parent_idx').on(t.parentId, t.sortOrder)
  })
);

/**
 * 总部商品库：只存共享字段（门店只读）+ 建议价。
 * 上下架、库存、店内排序都在门店侧（products / product_stocks），本表不出现。
 */
export const catalogProducts = pgTable(
  'catalog_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id').references(() => catalogCategories.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    unit: varchar('unit', { length: 20 }).notNull(),
    /** 建议价：门店 products.price 为空时以此价为准 */
    defaultPrice: numeric('default_price', { precision: 10, scale: 2 }).notNull(),
    stockType: productStockTypeEnum('stock_type').notNull().default('tracked'),
    /** draft 草稿（门店不可见）/ published 已发布 / archived 已归档 */
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    /** 冒烟/演示数据标记，发布时会同步到门店商品行 */
    isTest: boolean('is_test').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    categoryIdx: index('catalog_products_category_idx').on(t.categoryId),
    statusIdx: index('catalog_products_status_idx').on(t.status, t.createdAt)
  })
);

/**
 * 门店隐藏的共享分类（迁移 0009）。
 * 分类树只有一份，门店「删除分类」等价于把自己门店隐藏掉该分类及其子分类。
 */
export const shopHiddenCategories = pgTable(
  'shop_hidden_categories',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    catalogCategoryId: uuid('catalog_category_id')
      .notNull()
      .references(() => catalogCategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopIdx: index('shop_hidden_categories_shop_idx').on(t.shopId)
  })
);

export const catalogCategoriesRelations = relations(catalogCategories, ({ one, many }) => ({
  products: many(catalogProducts),
  parent: one(catalogCategories, {
    fields: [catalogCategories.parentId],
    references: [catalogCategories.id],
    relationName: 'catalog_category_tree'
  }),
  children: many(catalogCategories, { relationName: 'catalog_category_tree' })
}));

export const catalogProductsRelations = relations(catalogProducts, ({ one }) => ({
  category: one(catalogCategories, {
    fields: [catalogProducts.categoryId],
    references: [catalogCategories.id]
  })
}));

export type CatalogCategory = typeof catalogCategories.$inferSelect;
export type NewCatalogCategory = typeof catalogCategories.$inferInsert;
export type CatalogProduct = typeof catalogProducts.$inferSelect;
export type NewCatalogProduct = typeof catalogProducts.$inferInsert;
export type ShopHiddenCategory = typeof shopHiddenCategories.$inferSelect;

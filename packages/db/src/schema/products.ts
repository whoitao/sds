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
import { shops } from './shops.ts';
import { catalogProducts } from './catalog.ts';
import { productStockTypeEnum } from './enums.ts';

/**
 * 商品分类表，对应 PRD 5.4。固定两级：
 * - level=1 顶级（parent_id 为空），level=2 子级；
 * - 同一父级下名称唯一（SQL 迁移 0007 建了 `categories_sibling_name_unique ... NULLS NOT DISTINCT`，
 *   drizzle 0.36 无法表达 NULLS NOT DISTINCT，这里不重复声明，以 SQL 迁移为准）；
 * - 父分类必须同店，由复合外键 `(parent_id, shop_id) → (id, shop_id)` 兜底。
 * - 多店方案 P5 起门店分类只保留「隐藏共享分类」能力，写接口将下线。
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    level: smallint('level').notNull().default(1),
    name: varchar('name', { length: 50 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    iconUrl: text('icon_url'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopParentIdx: index('categories_shop_parent_idx').on(t.shopId, t.parentId)
  })
);

/**
 * 门店商品表，对应 PRD 5.5。PRD 未定义 SKU，按商品级单规格实现。
 * 多店方案（迁移 0008）后分两类行：
 * - `catalog_product_id` 非空：引用总部商品，名称/描述/图片/单位/分类以总部为准（门店只读）；
 * - `catalog_product_id` 为空：门店本地独有商品，字段全部归门店。
 * 门店可写字段：price（可空，NULL=跟随总部建议价）、is_available、sort_order、stock_type；
 * `is_blocked/blocked_reason` 只由总部写入，门店不可覆盖。
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** 引用的总部商品；为空表示门店本地独有商品 */
    catalogProductId: uuid('catalog_product_id').references(() => catalogProducts.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    /** 可空：NULL 表示跟随总部建议价；本地独有商品必须填价（SQL 0008 有 CHECK 兜底） */
    price: numeric('price', { precision: 10, scale: 2 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    stockType: productStockTypeEnum('stock_type').notNull().default('tracked'),
    isAvailable: boolean('is_available').notNull().default(true),
    /** 总部强制下架：优先级高于 is_available，门店不可自行恢复 */
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    /** 冒烟/演示数据标记，从总部商品行带入 */
    isTest: boolean('is_test').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopIdx: index('products_shop_idx').on(t.shopId),
    categoryIdx: index('products_category_idx').on(t.categoryId)
  })
);

/**
 * 门店级库存（迁移 0008）。库存严格属于门店，绝不挂在 catalog_products 上。
 * 与 products 通过 `(product_id, shop_id)` 复合外键绑定，避免库存行与商品归属不一致。
 */
export const productStocks = pgTable(
  'product_stocks',
  {
    productId: uuid('product_id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    isTest: boolean('is_test').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopIdx: index('product_stocks_shop_idx').on(t.shopId)
  })
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  shop: one(shops, { fields: [categories.shopId], references: [shops.id] }),
  products: many(products),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_tree'
  }),
  children: many(categories, { relationName: 'category_tree' })
}));

export const productsRelations = relations(products, ({ one }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  catalogProduct: one(catalogProducts, {
    fields: [products.catalogProductId],
    references: [catalogProducts.id]
  })
}));

export const productStocksRelations = relations(productStocks, ({ one }) => ({
  product: one(products, { fields: [productStocks.productId], references: [products.id] }),
  shop: one(shops, { fields: [productStocks.shopId], references: [shops.id] })
}));

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductStock = typeof productStocks.$inferSelect;
export type NewProductStock = typeof productStocks.$inferInsert;

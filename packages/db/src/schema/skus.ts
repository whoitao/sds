import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { catalogProducts } from './catalog.ts';
import { productStockTypeEnum, quantityModeEnum } from './enums.ts';
import { products } from './products.ts';
import { shops } from './shops.ts';

/**
 * 总部规格（SKU）：不持有库存，只定义规格/条码/单位/建议价/追踪策略/数量模式。
 * 一个总部商品至少一个默认 SKU；门店通过 `product_skus.catalog_sku_id` 引用。
 */
export const catalogSkus = pgTable(
  'catalog_skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    catalogProductId: uuid('catalog_product_id')
      .notNull()
      .references(() => catalogProducts.id, { onDelete: 'cascade' }),
    specName: varchar('spec_name', { length: 50 }).notNull(),
    barcode: varchar('barcode', { length: 64 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    defaultPrice: numeric('default_price', { precision: 10, scale: 2 }).notNull(),
    stockType: productStockTypeEnum('stock_type').notNull().default('tracked'),
    quantityMode: quantityModeEnum('quantity_mode').notNull().default('integer'),
    isDefault: boolean('is_default').notNull().default(false),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    /** 测试/演示数据标记；清理接口只删 is_test=true */
    isTest: boolean('is_test').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    productSpecUnique: uniqueIndex('catalog_skus_product_spec_unique').on(
      t.catalogProductId,
      t.specName
    ),
    defaultUnique: uniqueIndex('catalog_skus_default_unique')
      .on(t.catalogProductId)
      .where(sql`${t.isDefault}`),
    productIdx: index('catalog_skus_product_idx').on(
      t.catalogProductId,
      t.status,
      t.sortOrder
    )
  })
);

/**
 * 门店规格（SKU）：库存的最小单位。
 * - `catalog_sku_id` 非空：共享规格，规格/条码/单位/数量模式以总部为准；
 * - `catalog_sku_id` 为空：门店本地规格；
 * - `price` 为空表示跟随 `catalog_skus.default_price`，本地规格必须有价。
 */
export const productSkus = pgTable(
  'product_skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
      onDelete: 'restrict'
    }),
    specName: varchar('spec_name', { length: 50 }).notNull(),
    barcode: varchar('barcode', { length: 64 }),
    unit: varchar('unit', { length: 20 }).notNull(),
    price: numeric('price', { precision: 10, scale: 2 }),
    stockType: productStockTypeEnum('stock_type').notNull().default('tracked'),
    quantityMode: quantityModeEnum('quantity_mode').notNull().default('integer'),
    isAvailable: boolean('is_available').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    isTest: boolean('is_test').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    productFk: foreignKey({
      columns: [t.productId, t.shopId],
      foreignColumns: [products.id, products.shopId],
      name: 'product_skus_product_fk'
    }).onDelete('cascade'),
    productSpecUnique: uniqueIndex('product_skus_product_spec_unique').on(
      t.productId,
      t.specName
    ),
    idShopUnique: uniqueIndex('product_skus_id_shop_unique').on(t.id, t.shopId),
    shopCatalogSkuUnique: uniqueIndex('product_skus_shop_catalog_sku_unique')
      .on(t.shopId, t.catalogSkuId)
      .where(sql`${t.catalogSkuId} is not null`),
    defaultUnique: uniqueIndex('product_skus_default_unique')
      .on(t.productId)
      .where(sql`${t.isDefault}`),
    productIdx: index('product_skus_product_idx').on(
      t.productId,
      t.isAvailable,
      t.sortOrder
    ),
    shopIdx: index('product_skus_shop_idx').on(t.shopId),
    barcodeIdx: index('product_skus_barcode_idx')
      .on(t.shopId, t.barcode)
      .where(sql`${t.barcode} is not null`)
  })
);

/** 门店 SKU 库存余额：`quantity = Σ stock_movements.quantity_change`。 */
export const productSkuStocks = pgTable(
  'product_sku_stocks',
  {
    productSkuId: uuid('product_sku_id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('0'),
    minThreshold: numeric('min_threshold', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    maxThreshold: numeric('max_threshold', { precision: 12, scale: 2 }),
    /** 移动加权平均成本（迁移 0023，本轮只展示不参与扣减） */
    avgUnitCost: numeric('avg_unit_cost', { precision: 10, scale: 2 }).notNull().default('0'),
    /** 预留数量（迁移 0023，本轮只展示不参与扣减） */
    reservedQty: numeric('reserved_qty', { precision: 12, scale: 2 }).notNull().default('0'),
    isTest: boolean('is_test').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    skuFk: foreignKey({
      columns: [t.productSkuId, t.shopId],
      foreignColumns: [productSkus.id, productSkus.shopId],
      name: 'product_sku_stocks_sku_fk'
    }).onDelete('cascade'),
    shopIdx: index('product_sku_stocks_shop_idx').on(t.shopId)
  })
);

export const catalogSkusRelations = relations(catalogSkus, ({ one, many }) => ({
  catalogProduct: one(catalogProducts, {
    fields: [catalogSkus.catalogProductId],
    references: [catalogProducts.id]
  }),
  productSkus: many(productSkus)
}));

export const productSkusRelations = relations(productSkus, ({ one }) => ({
  shop: one(shops, { fields: [productSkus.shopId], references: [shops.id] }),
  product: one(products, { fields: [productSkus.productId], references: [products.id] }),
  catalogSku: one(catalogSkus, {
    fields: [productSkus.catalogSkuId],
    references: [catalogSkus.id]
  }),
  stock: one(productSkuStocks, {
    fields: [productSkus.id],
    references: [productSkuStocks.productSkuId]
  })
}));

export const productSkuStocksRelations = relations(productSkuStocks, ({ one }) => ({
  sku: one(productSkus, {
    fields: [productSkuStocks.productSkuId],
    references: [productSkus.id]
  }),
  shop: one(shops, { fields: [productSkuStocks.shopId], references: [shops.id] })
}));

export type CatalogSku = typeof catalogSkus.$inferSelect;
export type NewCatalogSku = typeof catalogSkus.$inferInsert;
export type ProductSku = typeof productSkus.$inferSelect;
export type NewProductSku = typeof productSkus.$inferInsert;
export type ProductSkuStock = typeof productSkuStocks.$inferSelect;
export type NewProductSkuStock = typeof productSkuStocks.$inferInsert;

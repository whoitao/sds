import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
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
import { stockMovementTypeEnum } from './enums.ts';
import { catalogSkus, productSkus } from './skus.ts';
import { shops } from './shops.ts';
import { users } from './users.ts';

/**
 * SKU 库存流水：库存数量的唯一事实来源。
 * 所有数量变化必须与 `product_sku_stocks` 余额更新处于同一事务。
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 门店流水必填；仓库流水为空（迁移 0028） */
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'restrict' }),
    /** 存放地点：shop 门店（默认）/ warehouse 仓库 */
    locationType: varchar('location_type', { length: 16 }).notNull().default('shop'),
    /** 地点 ID：location_type=shop 时为 shop_id，warehouse 时为 warehouse_id */
    locationId: uuid('location_id').notNull(),
    /** 门店 SKU；仓库流水为空（迁移 0028） */
    productSkuId: uuid('product_sku_id'),
    /** 总部规格；仓库流水必填（迁移 0028） */
    catalogSkuId: uuid('catalog_sku_id').references(() => catalogSkus.id, {
      onDelete: 'restrict'
    }),
    movementType: stockMovementTypeEnum('movement_type').notNull(),
    quantityChange: numeric('quantity_change', { precision: 12, scale: 2 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }),
    referenceType: varchar('reference_type', { length: 24 }),
    referenceId: uuid('reference_id'),
    operatorAdminId: uuid('operator_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    operatorUserId: uuid('operator_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    skuFk: foreignKey({
      columns: [t.productSkuId, t.shopId],
      foreignColumns: [productSkus.id, productSkus.shopId],
      name: 'stock_movements_sku_fk'
    }).onDelete('restrict'),
    bizUnique: uniqueIndex('stock_movements_biz_unique')
      .on(
        t.locationType,
        t.locationId,
        t.productSkuId,
        t.movementType,
        t.referenceType,
        t.referenceId
      )
      .where(sql`${t.referenceId} is not null`),
    initialUnique: uniqueIndex('stock_movements_initial_unique')
      .on(t.locationType, t.locationId, t.productSkuId)
      .where(sql`${t.movementType} = 'initial'`),
    skuIdx: index('stock_movements_sku_idx').on(t.shopId, t.productSkuId, t.createdAt),
    typeIdx: index('stock_movements_type_idx').on(t.shopId, t.movementType, t.createdAt),
    locationIdx: index('stock_movements_location_idx').on(
      t.locationType,
      t.locationId,
      t.createdAt
    ),
    warehouseIdx: index('stock_movements_warehouse_idx').on(
      t.locationId,
      t.catalogSkuId,
      t.createdAt
    ),
    warehouseBizUnique: uniqueIndex('stock_movements_warehouse_biz_unique')
      .on(
        t.locationType,
        t.locationId,
        t.catalogSkuId,
        t.movementType,
        t.referenceType,
        t.referenceId
      )
      .where(
        sql`${t.locationType} = 'warehouse' and ${t.catalogSkuId} is not null and ${t.referenceId} is not null`
      ),
    warehouseInitialUnique: uniqueIndex('stock_movements_warehouse_initial_unique')
      .on(t.locationType, t.locationId, t.catalogSkuId)
      .where(
        sql`${t.locationType} = 'warehouse' and ${t.catalogSkuId} is not null and ${t.movementType} = 'initial'`
      )
  })
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  shop: one(shops, { fields: [stockMovements.shopId], references: [shops.id] }),
  sku: one(productSkus, {
    fields: [stockMovements.productSkuId],
    references: [productSkus.id]
  }),
  catalogSku: one(catalogSkus, {
    fields: [stockMovements.catalogSkuId],
    references: [catalogSkus.id]
  }),
  operatorAdmin: one(adminUsers, {
    fields: [stockMovements.operatorAdminId],
    references: [adminUsers.id]
  })
}));

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;

import { relations, sql } from 'drizzle-orm';
import {
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
import { productSkus } from './skus.ts';
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
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    productSkuId: uuid('product_sku_id').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    skuFk: foreignKey({
      columns: [t.productSkuId, t.shopId],
      foreignColumns: [productSkus.id, productSkus.shopId],
      name: 'stock_movements_sku_fk'
    }).onDelete('restrict'),
    bizUnique: uniqueIndex('stock_movements_biz_unique')
      .on(t.shopId, t.productSkuId, t.movementType, t.referenceType, t.referenceId)
      .where(sql`${t.referenceId} is not null`),
    initialUnique: uniqueIndex('stock_movements_initial_unique')
      .on(t.shopId, t.productSkuId)
      .where(sql`${t.movementType} = 'initial'`),
    skuIdx: index('stock_movements_sku_idx').on(t.shopId, t.productSkuId, t.createdAt),
    typeIdx: index('stock_movements_type_idx').on(t.shopId, t.movementType, t.createdAt)
  })
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  shop: one(shops, { fields: [stockMovements.shopId], references: [shops.id] }),
  sku: one(productSkus, {
    fields: [stockMovements.productSkuId],
    references: [productSkus.id]
  }),
  operatorAdmin: one(adminUsers, {
    fields: [stockMovements.operatorAdminId],
    references: [adminUsers.id]
  })
}));

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;

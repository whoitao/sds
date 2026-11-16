import { relations } from 'drizzle-orm';
import { pgTable, uuid, varchar, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { shops } from './shops';
import { customers } from './customers';
import { products } from './products';

/**
 * 购物车，对应迁移 0012。
 * - 一车一店：customer_id + shop_id 唯一；
 * - 只存 remark 与归属，不存金额；单价/小计读取时按当前有效价计算；
 * - 空车由接口删除，不在列表里残留。
 */
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    remark: varchar('remark', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    customerShopUnique: uniqueIndex('carts_customer_shop_unique').on(t.customerId, t.shopId),
    shopUpdatedIdx: index('carts_shop_updated_idx').on(t.shopId, t.updatedAt),
    updatedIdx: index('carts_updated_idx').on(t.updatedAt)
  })
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    cartProductUnique: uniqueIndex('cart_items_cart_product_unique').on(t.cartId, t.productId),
    productIdx: index('cart_items_product_idx').on(t.productId)
  })
);

export const cartsRelations = relations(carts, ({ one, many }) => ({
  customer: one(customers, { fields: [carts.customerId], references: [customers.id] }),
  shop: one(shops, { fields: [carts.shopId], references: [shops.id] }),
  items: many(cartItems)
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, { fields: [cartItems.productId], references: [products.id] })
}));

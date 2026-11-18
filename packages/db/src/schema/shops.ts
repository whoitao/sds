import { relations } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/** 营业时间：{"mon": {"open": "07:00", "close": "20:00"}, ...} */
export type BusinessHours = Record<string, { open: string; close: string }>;

export const shopStatusEnum = pgEnum('shop_status', ['open', 'closed', 'suspended']);
export const memberRoleEnum = pgEnum('member_role', ['shop_manager', 'shop_staff', 'delivery']);

/** 店铺表，对应 PRD 5.2 */
export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  coverUrl: text('cover_url'),
  address: varchar('address', { length: 200 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  phone: varchar('phone', { length: 11 }),
  businessHours: jsonb('business_hours').$type<BusinessHours>(),
  status: shopStatusEnum('status').notNull().default('open'),
  /** 测试/演示门店标记；清理接口只删 is_test=true */
  isTest: boolean('is_test').notNull().default(false),
  announcement: text('announcement'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/** 店铺成员表（店长 / 店员 / 配送员），对应 PRD 5.3 */
export const shopMembers = pgTable(
  'shop_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    shopUserUnique: uniqueIndex('shop_members_shop_user_unique').on(t.shopId, t.userId),
    userIdx: index('shop_members_user_idx').on(t.userId)
  })
);

export const shopsRelations = relations(shops, ({ many }) => ({
  members: many(shopMembers)
}));

export const shopMembersRelations = relations(shopMembers, ({ one }) => ({
  shop: one(shops, { fields: [shopMembers.shopId], references: [shops.id] }),
  user: one(users, { fields: [shopMembers.userId], references: [users.id] })
}));

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type ShopMember = typeof shopMembers.$inferSelect;

import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  boolean,
  text,
  timestamp,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/**
 * 顾客资料，对应 PRD 5.10。
 * `users` 负责手机号身份，`customers` 只存顾客侧资料；
 * addresses / default_address_id 在地址模块落地时再补。
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 50 }),
    realName: varchar('real_name', { length: 50 }),
    phone: varchar('phone', { length: 11 }),
    totalOrders: integer('total_orders').notNull().default(0),
    totalSpent: numeric('total_spent', { precision: 10, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    userUnique: uniqueIndex('customers_user_unique').on(t.userId),
    createdAtIdx: index('customers_created_at_idx').on(t.createdAt)
  })
);

/** 顾客登录会话：不透明 token 落库，服务端可随时吊销 */
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    tokenUnique: uniqueIndex('customer_sessions_token_unique').on(t.token),
    customerIdx: index('customer_sessions_customer_idx').on(t.customerId)
  })
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  user: one(users, { fields: [customers.userId], references: [users.id] }),
  addresses: many(addresses)
}));

/**
 * 收货地址，对应 PRD 5.11。
 * 一个顾客可有多条；默认地址由 is_default 表达，迁移里有部分唯一索引兜底。
 */
export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    contactName: varchar('contact_name', { length: 50 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 11 }).notNull(),
    province: varchar('province', { length: 20 }),
    city: varchar('city', { length: 20 }),
    district: varchar('district', { length: 20 }),
    detail: varchar('detail', { length: 200 }).notNull(),
    provinceCode: varchar('province_code', { length: 12 }),
    cityCode: varchar('city_code', { length: 12 }),
    districtCode: varchar('district_code', { length: 12 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    isDefault: boolean('is_default').notNull().default(false),
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    customerIdx: index('addresses_customer_idx').on(t.customerId)
  })
);

export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, { fields: [addresses.customerId], references: [customers.id] })
}));

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerSession = typeof customerSessions.$inferSelect;
export type NewCustomerSession = typeof customerSessions.$inferInsert;
export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;

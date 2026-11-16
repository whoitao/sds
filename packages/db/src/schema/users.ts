import { pgEnum, pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * 用户角色，取值与 PRD 5.1 一致。
 * 注意：平台管理员的登录体系目前仍在 admin_users，未并入本表（见报告中的差异说明）。
 */
export const userRoleEnum = pgEnum('user_role', [
  'customer',
  'shop_manager',
  'shop_staff',
  'delivery',
  'platform_admin'
]);

/** 用户表，对应 PRD 5.1 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 11 }).notNull(),
    name: varchar('name', { length: 50 }),
    avatarUrl: text('avatar_url'),
    role: userRoleEnum('role').notNull().default('customer'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    phoneUnique: uniqueIndex('users_phone_unique').on(t.phone),
    createdAtIdx: index('users_created_at_idx').on(t.createdAt)
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

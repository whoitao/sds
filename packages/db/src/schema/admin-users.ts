import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, smallint, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';

/** 后台界面偏好，存于 admin_users.preferences */
export interface AdminPreferences {
  theme?: 'system' | 'light' | 'dark';
  pageSize?: number;
}

/**
 * 平台管理员账号表。
 * 本轮只服务 admin 端登录，店铺员工仍走 PRD 中的 shop_members。
 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 登录账号，统一小写存储 */
    username: varchar('username', { length: 50 }).notNull(),
    /** scrypt 哈希，格式：scrypt$N$r$p$salt$hash */
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    /** 平台侧角色：platform_admin / super_admin（PRD 第 8 章） */
    role: varchar('role', { length: 32 }).notNull().default('platform_admin'),
    /** 1 = 启用，0 = 停用 */
    status: smallint('status').notNull().default(1),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** 界面偏好：主题、分页大小等，按管理员账号持久化 */
    preferences: jsonb('preferences')
      .$type<AdminPreferences>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    usernameUnique: uniqueIndex('admin_users_username_unique').on(t.username)
  })
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;

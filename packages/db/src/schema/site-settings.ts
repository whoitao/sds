import { pgTable, integer, boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.ts';

/**
 * 站点级配置（单行表，id 恒为 1）。
 * - 维护开关与维护通知：由 web 顾客端读取后决定是否展示维护页
 * - SEO 字段：web 端生成 metadata / canonical / Open Graph 使用
 * 读取时由应用层补齐默认值，表里只存被保存过的值。
 */
export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey().default(1),
  maintenanceEnabled: boolean('maintenance_enabled').notNull().default(false),
  maintenanceMessage: text('maintenance_message').notNull().default('站点正在维护，请稍后访问。'),
  siteUrl: text('site_url').notNull().default(''),
  defaultTitle: text('default_title').notNull().default(''),
  defaultKeywords: text('default_keywords').notNull().default(''),
  defaultDescription: text('default_description').notNull().default(''),
  /** 最后保存人；只用于后台展示与留痕，不对外公开 */
  updatedBy: uuid('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type SiteSettingsRow = typeof siteSettings.$inferSelect;

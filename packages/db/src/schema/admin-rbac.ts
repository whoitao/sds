import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users';

/**
 * 后台管理员权限模型（ABAC）。
 * - admin_roles / admin_permissions：角色与权限项字典
 * - admin_role_permissions：角色→权限的授予，conditions 存 ABAC 属性条件（jsonb）
 * - admin_user_roles：管理员→角色的关联
 */
export const adminRoles = pgTable(
  'admin_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    description: text('description'),
    /** 系统内置角色不可删除 */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    codeUnique: uniqueIndex('admin_roles_code_unique').on(t.code)
  })
);

export const adminPermissions = pgTable(
  'admin_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 资源.动作，例如 shops.write */
    code: varchar('code', { length: 80 }).notNull(),
    module: varchar('module', { length: 32 }).notNull(),
    action: varchar('action', { length: 32 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    codeUnique: uniqueIndex('admin_permissions_code_unique').on(t.code),
    moduleIdx: index('admin_permissions_module_idx').on(t.module)
  })
);

export const adminRolePermissions = pgTable(
  'admin_role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => adminPermissions.id, { onDelete: 'cascade' }),
    /** ABAC 条件，null/{} 表示无条件放行 */
    conditions: jsonb('conditions').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    grantUnique: uniqueIndex('admin_role_permissions_unique').on(t.roleId, t.permissionId),
    roleIdx: index('admin_role_permissions_role_idx').on(t.roleId)
  })
);

export const adminUserRoles = pgTable(
  'admin_user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    bindingUnique: uniqueIndex('admin_user_roles_unique').on(t.adminUserId, t.roleId),
    userIdx: index('admin_user_roles_user_idx').on(t.adminUserId)
  })
);

export type AdminRole = typeof adminRoles.$inferSelect;
export type AdminPermission = typeof adminPermissions.$inferSelect;
export type AdminRolePermission = typeof adminRolePermissions.$inferSelect;
export type AdminUserRole = typeof adminUserRoles.$inferSelect;

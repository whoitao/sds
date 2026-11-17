import type { Context } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { adminPermissions, adminRolePermissions, adminRoles, adminUserRoles, getDb } from '@sds/db';
import type { AdminEnv } from '../middleware/admin-auth.js';
import { evaluateCondition, type AbacContext } from './abac.js';

export type AdminRoleBrief = { id: string; code: string; name: string };

export type AdminGrant = {
  code: string;
  module: string;
  conditions: Record<string, unknown> | null;
};

export async function loadAdminAccess(
  adminId: string
): Promise<{ roles: AdminRoleBrief[]; grants: AdminGrant[] }> {
  const db = await getDb();
  const roles = await db
    .select({ id: adminRoles.id, code: adminRoles.code, name: adminRoles.name })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
    .where(eq(adminUserRoles.adminUserId, adminId));

  if (roles.length === 0) return { roles, grants: [] };

  const grants = await db
    .select({
      code: adminPermissions.code,
      module: adminPermissions.module,
      conditions: adminRolePermissions.conditions
    })
    .from(adminRolePermissions)
    .innerJoin(adminPermissions, eq(adminPermissions.id, adminRolePermissions.permissionId))
    .where(
      inArray(
        adminRolePermissions.roleId,
        roles.map((role) => role.id)
      )
    );

  return { roles, grants };
}

/** 同一权限码在多角色下只要有一条授予的条件成立即放行 */
export async function checkPermission(
  adminId: string,
  permissionCode: string,
  resource: Record<string, unknown> = {},
  env: Record<string, unknown> = {}
): Promise<boolean> {
  const { roles, grants } = await loadAdminAccess(adminId);
  const ctx: AbacContext = {
    subject: { id: adminId, roles: roles.map((role) => role.code) },
    resource,
    env
  };
  return grants.some((grant) => grant.code === permissionCode && evaluateCondition(grant.conditions, ctx));
}

/**
 * 路由内权限守卫：路由需先挂 requireAdmin，再在 handler 里调用本函数。
 * 返回 Response 表示已拒绝（403），返回 null 表示放行。
 */
export async function guardPermission(
  c: Context<AdminEnv>,
  permissionCode: string,
  resource: Record<string, unknown> = {}
): Promise<Response | null> {
  const admin = c.get('admin');
  const allowed = await checkPermission(admin.sub, permissionCode, resource);
  if (allowed) return null;
  return c.json({ code: 'FORBIDDEN', message: `缺少权限：${permissionCode}` }, 403);
}

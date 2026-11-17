import { Hono } from 'hono';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminPermissions,
  adminRolePermissions,
  adminRoles,
  adminUserRoles,
  adminUsers,
  getDb
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission, loadAdminAccess } from '../lib/admin-access.js';
import { validateCondition } from '../lib/abac.js';

/**
 * 后台管理员 ABAC 权限管理。
 * 身份由 requireAdmin 统一校验，资源级权限在 handler 内用 guardPermission 判断。
 */
export const adminRbacRoutes = new Hono<AdminEnv>();

adminRbacRoutes.use('*', requireAdmin);

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

const grantSchema = z.object({
  permissionId: z.uuid(),
  conditions: z.unknown().nullish()
});

const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,49}$/, '编码需以小写字母开头，仅含小写字母、数字、下划线'),
  name: z.string().trim().min(1, '角色名必填').max(50),
  description: z.string().trim().max(200).nullish(),
  permissions: z.array(grantSchema).default([])
});

const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: z.array(grantSchema).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

function checkConditions(permissions: { conditions?: unknown }[]): string | null {
  for (const item of permissions) {
    const error = validateCondition(item.conditions ?? null);
    if (error) return error;
  }
  return null;
}

/** 权限项字典 */
adminRbacRoutes.get('/permissions', async (c) => {
  const denied = await guardPermission(c, 'roles.read');
  if (denied) return denied;

  const db = await getDb();
  const items = await db
    .select()
    .from(adminPermissions)
    .orderBy(asc(adminPermissions.module), asc(adminPermissions.code));
  return c.json({ items });
});

/** 角色列表：含权限授予（含 ABAC 条件）与成员 */
adminRbacRoutes.get('/roles', async (c) => {
  const denied = await guardPermission(c, 'roles.read');
  if (denied) return denied;

  const db = await getDb();
  const [roles, grants, bindings] = await Promise.all([
    db.select().from(adminRoles).orderBy(asc(adminRoles.createdAt)),
    db
      .select({
        roleId: adminRolePermissions.roleId,
        permissionId: adminRolePermissions.permissionId,
        conditions: adminRolePermissions.conditions,
        code: adminPermissions.code,
        name: adminPermissions.name,
        module: adminPermissions.module,
        action: adminPermissions.action
      })
      .from(adminRolePermissions)
      .innerJoin(adminPermissions, eq(adminPermissions.id, adminRolePermissions.permissionId)),
    db
      .select({ roleId: adminUserRoles.roleId, adminUserId: adminUserRoles.adminUserId })
      .from(adminUserRoles)
  ]);

  const items = roles.map((role) => ({
    ...role,
    permissions: grants
      .filter((grant) => grant.roleId === role.id)
      .map((grant) => ({
        permissionId: grant.permissionId,
        code: grant.code,
        name: grant.name,
        module: grant.module,
        action: grant.action,
        conditions: grant.conditions
      })),
    adminIds: bindings.filter((binding) => binding.roleId === role.id).map((binding) => binding.adminUserId)
  }));

  return c.json({ items });
});

/** 新建自定义角色 */
adminRbacRoutes.post('/roles', async (c) => {
  const denied = await guardPermission(c, 'roles.write');
  if (denied) return denied;

  const parsed = createRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', details: parsed.error.issues }, 400);
  }
  const conditionError = checkConditions(parsed.data.permissions);
  if (conditionError) return c.json({ code: 'INVALID_CONDITION', message: conditionError }, 400);

  const db = await getDb();
  try {
    const created = await db.transaction(async (tx) => {
      const [role] = await tx
        .insert(adminRoles)
        .values({
          code: parsed.data.code,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          isSystem: false
        })
        .returning();
      if (parsed.data.permissions.length > 0) {
        await tx.insert(adminRolePermissions).values(
          parsed.data.permissions.map((item) => ({
            roleId: role.id,
            permissionId: item.permissionId,
            conditions: (item.conditions ?? null) as Record<string, unknown> | null
          }))
        );
      }
      return role;
    });
    return c.json({ item: created }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'ROLE_EXISTS', message: '角色编码已存在' }, 409);
    }
    throw error;
  }
});

/** 更新角色：名称/描述/权限授予整体替换 */
adminRbacRoutes.patch('/roles/:id', async (c) => {
  const denied = await guardPermission(c, 'roles.write');
  if (denied) return denied;

  const parsed = updateRoleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', details: parsed.error.issues }, 400);
  }
  if (parsed.data.permissions) {
    const conditionError = checkConditions(parsed.data.permissions);
    if (conditionError) return c.json({ code: 'INVALID_CONDITION', message: conditionError }, 400);
  }

  const db = await getDb();
  const roleId = c.req.param('id');
  const [existing] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId));
  if (!existing) return c.json({ code: 'ROLE_NOT_FOUND', message: '角色不存在' }, 404);

  const updated = await db.transaction(async (tx) => {
    const [role] = await tx
      .update(adminRoles)
      .set({
        name: parsed.data.name ?? existing.name,
        description: parsed.data.description === undefined ? existing.description : parsed.data.description,
        updatedAt: new Date()
      })
      .where(eq(adminRoles.id, roleId))
      .returning();
    if (parsed.data.permissions) {
      await tx.delete(adminRolePermissions).where(eq(adminRolePermissions.roleId, roleId));
      if (parsed.data.permissions.length > 0) {
        await tx.insert(adminRolePermissions).values(
          parsed.data.permissions.map((item) => ({
            roleId,
            permissionId: item.permissionId,
            conditions: (item.conditions ?? null) as Record<string, unknown> | null
          }))
        );
      }
    }
    return role;
  });

  return c.json({ item: updated });
});

/** 删除角色：系统角色与仍有成员的角色不允许删除 */
adminRbacRoutes.delete('/roles/:id', async (c) => {
  const denied = await guardPermission(c, 'roles.write');
  if (denied) return denied;

  const db = await getDb();
  const roleId = c.req.param('id');
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId));
  if (!role) return c.json({ code: 'ROLE_NOT_FOUND', message: '角色不存在' }, 404);
  if (role.isSystem) {
    return c.json({ code: 'SYSTEM_ROLE', message: '系统内置角色不可删除' }, 400);
  }

  const bindings = await db
    .select({ adminUserId: adminUserRoles.adminUserId })
    .from(adminUserRoles)
    .where(eq(adminUserRoles.roleId, roleId));
  if (bindings.length > 0) {
    return c.json({ code: 'ROLE_IN_USE', message: '该角色仍有关联管理员，请先解绑' }, 409);
  }

  await db.delete(adminRoles).where(eq(adminRoles.id, roleId));
  return c.json({ ok: true });
});

/** 当前管理员的有效权限（用于前端按钮级控制） */
adminRbacRoutes.get('/me/permissions', async (c) => {
  const admin = c.get('admin');
  const { roles, grants } = await loadAdminAccess(admin.sub);
  const codes = Array.from(new Set(grants.map((grant) => grant.code))).sort();
  return c.json({
    adminId: admin.sub,
    roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
    permissions: codes
  });
});

/** 覆盖式绑定管理员角色 */
adminRbacRoutes.put('/admins/:id/roles', async (c) => {
  const denied = await guardPermission(c, 'roles.write');
  if (denied) return denied;

  const parsed = z
    .object({ roleIds: z.array(z.string().uuid()).max(10) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', details: parsed.error.issues }, 400);
  }

  const db = await getDb();
  const adminId = c.req.param('id');
  const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId));
  if (!target) return c.json({ code: 'ADMIN_NOT_FOUND', message: '管理员不存在' }, 404);

  const roleIds = Array.from(new Set(parsed.data.roleIds));
  if (roleIds.length > 0) {
    const found = await db.select({ id: adminRoles.id }).from(adminRoles).where(inArray(adminRoles.id, roleIds));
    if (found.length !== roleIds.length) {
      return c.json({ code: 'ROLE_NOT_FOUND', message: '存在无效角色' }, 400);
    }
  }

  // 防止把最后一个 super_admin 解绑导致无人可管理权限
  const superRole = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.code, 'super_admin'));
  const superRoleId = superRole[0]?.id;
  if (superRoleId) {
    const current = await db
      .select({ roleId: adminUserRoles.roleId })
      .from(adminUserRoles)
      .where(eq(adminUserRoles.adminUserId, adminId));
    const hadSuper = current.some((item) => item.roleId === superRoleId);
    const willHaveSuper = roleIds.includes(superRoleId);
    if (hadSuper && !willHaveSuper) {
      const supers = await db
        .select({ adminUserId: adminUserRoles.adminUserId })
        .from(adminUserRoles)
        .where(eq(adminUserRoles.roleId, superRoleId));
      if (supers.length <= 1) {
        return c.json({ code: 'LAST_SUPER_ADMIN', message: '至少需要保留一名平台管理员角色' }, 409);
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(adminUserRoles).where(eq(adminUserRoles.adminUserId, adminId));
    if (roleIds.length > 0) {
      await tx.insert(adminUserRoles).values(roleIds.map((roleId) => ({ adminUserId: adminId, roleId })));
    }
  });

  return c.json({ ok: true, adminId, roleIds });
});

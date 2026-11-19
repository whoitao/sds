import { Hono } from 'hono';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminRoles,
  adminUserRoles,
  adminUsers,
  adminUserShops,
  addresses,
  customers,
  getDb,
  shops,
  users,
  userRoleEnum
} from '@sds/db';
import { hashPassword } from '../lib/password.js';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission, loadAdminAccess } from '../lib/admin-access.js';

/**
 * 平台侧账号管理。
 * - /users  ：业务用户（PRD 5.1 users）
 * - /admins ：后台管理员（admin_users，与业务用户分离，见决策记录）
 */
export const adminAccountRoutes = new Hono<AdminEnv>();

adminAccountRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const phoneSchema = z.string().regex(/^1\d{10}$/, '手机号需为 11 位');
const roleSchema = z.enum(userRoleEnum.enumValues);

const createUserSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().max(50).optional(),
  role: roleSchema.optional()
});

const updateUserSchema = z
  .object({
    phone: phoneSchema.optional(),
    name: z.string().trim().max(50).nullable().optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const shopIdsSchema = z.array(z.string().uuid()).max(200).optional();

const createAdminSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '账号至少 3 位')
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, '仅允许字母、数字、下划线、点、短横线'),
  password: z.string().min(8, '密码至少 8 位').max(72),
  displayName: z.string().trim().min(1, '显示名必填').max(50),
  role: z.string().trim().max(32).optional(),
  roleCode: z.string().trim().max(50).optional(),
  shopIds: shopIdsSchema,
  status: z.number().int().min(0).max(1).optional()
});

const updateAdminSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    role: z.string().trim().max(32).optional(),
    roleCode: z.string().trim().max(50).optional(),
    shopIds: shopIdsSchema,
    status: z.number().int().min(0).max(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

async function requireSuperAdmin(c: Parameters<typeof guardPermission>[0]) {
  const { roles } = await loadAdminAccess(c.get('admin').sub);
  return roles.some((role) => role.code === 'super_admin');
}

/** 覆盖管理员门店范围；super_admin 不受范围限制，直接清空绑定 */
async function replaceAdminShops(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0],
  adminUserId: string,
  roleCode: string | null,
  shopIds: string[]
) {
  await tx.delete(adminUserShops).where(eq(adminUserShops.adminUserId, adminUserId));
  if (roleCode === 'super_admin' || shopIds.length === 0) return;

  const existed = await tx
    .select({ id: shops.id })
    .from(shops)
    .where(inArray(shops.id, shopIds));
  if (existed.length !== shopIds.length) {
    throw new Error('INVALID_SHOP');
  }
  await tx
    .insert(adminUserShops)
    .values(shopIds.map((shopId) => ({ adminUserId, shopId })));
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/* ----------------------------- 业务用户 ----------------------------- */

adminAccountRoutes.get('/users', async (c) => {
  const denied = await guardPermission(c, 'users.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const role = c.req.query('role')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const filters = [];
  if (keyword) filters.push(ilike(users.phone, `%${keyword}%`));
  if (role && userRoleEnum.enumValues.includes(role as (typeof userRoleEnum.enumValues)[number])) {
    filters.push(eq(users.role, role as (typeof userRoleEnum.enumValues)[number]));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: users.id,
        phone: users.phone,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(users).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

// 顾客收货地址（只读）：users.id → customers.user_id → addresses
adminAccountRoutes.get('/users/:id/addresses', async (c) => {
  const denied = await guardPermission(c, 'users.read');
  if (denied) return denied;

  const db = await getDb();
  const [customer] = await db
    .select({
      id: customers.id,
      nickname: customers.nickname,
      realName: customers.realName,
      phone: customers.phone
    })
    .from(customers)
    .where(eq(customers.userId, c.req.param('id')))
    .limit(1);

  if (!customer) {
    return c.json({ customer: null, items: [] });
  }

  const items = await db
    .select({
      id: addresses.id,
      contactName: addresses.contactName,
      contactPhone: addresses.contactPhone,
      province: addresses.province,
      city: addresses.city,
      district: addresses.district,
      detail: addresses.detail,
      remark: addresses.remark,
      isDefault: addresses.isDefault,
      createdAt: addresses.createdAt,
      updatedAt: addresses.updatedAt
    })
    .from(addresses)
    .where(eq(addresses.customerId, customer.id))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));

  return c.json({ customer, items });
});

adminAccountRoutes.post('/users', async (c) => {
  const denied = await guardPermission(c, 'users.write');
  if (denied) return denied;

  const parsed = createUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  try {
    const [row] = await (await getDb())
      .insert(users)
      .values({
        phone: parsed.data.phone,
        name: parsed.data.name || null,
        role: parsed.data.role ?? 'customer'
      })
      .returning({ id: users.id });

    return c.json({ item: row }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'PHONE_EXISTS', message: '该手机号已存在' }, 409);
    }
    throw error;
  }
});

adminAccountRoutes.patch('/users/:id', async (c) => {
  const denied = await guardPermission(c, 'users.write');
  if (denied) return denied;

  const parsed = updateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { name, ...rest } = parsed.data;

  try {
    const [row] = await (await getDb())
      .update(users)
      .set({
        ...rest,
        ...(name === undefined ? {} : { name }),
        updatedAt: new Date()
      })
      .where(eq(users.id, c.req.param('id')))
      .returning({ id: users.id });

    if (!row) return c.json({ code: 'NOT_FOUND', message: '用户不存在' }, 404);
    return c.json({ item: row });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'PHONE_EXISTS', message: '该手机号已存在' }, 409);
    }
    throw error;
  }
});

adminAccountRoutes.patch('/users/:id/status', async (c) => {
  const denied = await guardPermission(c, 'users.write');
  if (denied) return denied;

  const body = await c.req.json<{ isActive?: boolean }>().catch(() => null);
  if (!body || typeof body.isActive !== 'boolean') {
    return c.json({ code: 'INVALID_BODY', message: '需要 isActive 布尔值' }, 400);
  }

  const [row] = await (await getDb())
    .update(users)
    .set({ isActive: body.isActive, updatedAt: new Date() })
    .where(eq(users.id, c.req.param('id')))
    .returning({ id: users.id, isActive: users.isActive });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '用户不存在' }, 404);
  return c.json({ item: row });
});

/* ----------------------------- 管理员 ----------------------------- */

adminAccountRoutes.get('/admins', async (c) => {
  const denied = await guardPermission(c, 'admins.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const where = keyword ? ilike(adminUsers.username, `%${keyword}%`) : undefined;
  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
        status: adminUsers.status,
        lastLoginAt: adminUsers.lastLoginAt,
        createdAt: adminUsers.createdAt
      })
      .from(adminUsers)
      .where(where)
      .orderBy(desc(adminUsers.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(adminUsers).where(where)
  ]);

  // 管理员的实际角色与管辖门店：列表里直接展示，编辑表单也用它回填
  const ids = items.map((item) => item.id);
  const roleRows = ids.length
    ? await db
        .select({
          adminUserId: adminUserRoles.adminUserId,
          id: adminRoles.id,
          code: adminRoles.code,
          name: adminRoles.name
        })
        .from(adminUserRoles)
        .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
        .where(inArray(adminUserRoles.adminUserId, ids))
    : [];
  const shopRows = ids.length
    ? await db
        .select({ adminUserId: adminUserShops.adminUserId, id: shops.id, name: shops.name })
        .from(adminUserShops)
        .innerJoin(shops, eq(shops.id, adminUserShops.shopId))
        .where(inArray(adminUserShops.adminUserId, ids))
    : [];

  const roleMap = new Map<string, { id: string; code: string; name: string }[]>();
  for (const row of roleRows) {
    const list = roleMap.get(row.adminUserId) ?? [];
    list.push({ id: row.id, code: row.code, name: row.name });
    roleMap.set(row.adminUserId, list);
  }
  const shopMap = new Map<string, { id: string; name: string }[]>();
  for (const row of shopRows) {
    const list = shopMap.get(row.adminUserId) ?? [];
    list.push({ id: row.id, name: row.name });
    shopMap.set(row.adminUserId, list);
  }

  return c.json({
    items: items.map((item) => ({
      ...item,
      roles: roleMap.get(item.id) ?? [],
      shops: shopMap.get(item.id) ?? []
    })),
    total: totalRows[0]?.total ?? 0,
    page,
    pageSize
  });
});

adminAccountRoutes.post('/admins', async (c) => {
  const denied = await guardPermission(c, 'admins.write');
  if (denied) return denied;
  if (!(await requireSuperAdmin(c))) {
    return c.json({ code: 'FORBIDDEN', message: '只有超级管理员可以新建管理员' }, 403);
  }

  const parsed = createAdminSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const roleCode = parsed.data.roleCode ?? 'viewer';
  const shopIds = Array.from(new Set(parsed.data.shopIds ?? []));

  try {
    const db = await getDb();
    const row = await db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: adminRoles.id, code: adminRoles.code })
        .from(adminRoles)
        .where(eq(adminRoles.code, roleCode));
      if (!role) throw new Error('INVALID_ROLE');

      const [created] = await tx
        .insert(adminUsers)
        .values({
          username: parsed.data.username.toLowerCase(),
          passwordHash: await hashPassword(parsed.data.password),
          displayName: parsed.data.displayName,
          role: parsed.data.role ?? role.code,
          status: parsed.data.status ?? 1
        })
        .returning({ id: adminUsers.id });

      await tx.insert(adminUserRoles).values({ adminUserId: created.id, roleId: role.id });
      await replaceAdminShops(tx, created.id, role.code, shopIds);
      return created;
    });

    return c.json({ item: row }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ROLE') {
      return c.json({ code: 'INVALID_ROLE', message: '角色不存在' }, 400);
    }
    if (error instanceof Error && error.message === 'INVALID_SHOP') {
      return c.json({ code: 'INVALID_SHOP', message: '包含不存在的门店' }, 400);
    }
    if (isUniqueViolation(error)) {
      return c.json({ code: 'USERNAME_EXISTS', message: '该账号已存在' }, 409);
    }
    throw error;
  }
});

adminAccountRoutes.patch('/admins/:id', async (c) => {
  const denied = await guardPermission(c, 'admins.write');
  if (denied) return denied;
  if (!(await requireSuperAdmin(c))) {
    return c.json({ code: 'FORBIDDEN', message: '只有超级管理员可以修改管理员' }, 403);
  }

  const parsed = updateAdminSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const adminId = c.req.param('id');
  const { roleCode, shopIds, role: legacyRole, ...fields } = parsed.data;
  const nextShopIds = shopIds === undefined ? undefined : Array.from(new Set(shopIds));

  try {
    const db = await getDb();
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(adminUsers)
        .set({
          ...fields,
          ...(legacyRole ? { role: legacyRole } : {}),
          updatedAt: new Date()
        })
        .where(eq(adminUsers.id, adminId))
        .returning({ id: adminUsers.id });

      if (!updated) return null;

      let currentRoleCode: string | null = null;
      if (roleCode) {
        const [role] = await tx
          .select({ id: adminRoles.id, code: adminRoles.code })
          .from(adminRoles)
          .where(eq(adminRoles.code, roleCode));
        if (!role) throw new Error('INVALID_ROLE');
        currentRoleCode = role.code;

        // 单选表单：目标角色已在身上时保留其他附加角色，只有切换角色才覆盖重绑
        const currentRoles = await tx
          .select({ code: adminRoles.code })
          .from(adminUserRoles)
          .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
          .where(eq(adminUserRoles.adminUserId, adminId));
        if (!currentRoles.some((item) => item.code === role.code)) {
          await tx.delete(adminUserRoles).where(eq(adminUserRoles.adminUserId, adminId));
          await tx.insert(adminUserRoles).values({ adminUserId: adminId, roleId: role.id });
        }
        await tx.update(adminUsers).set({ role: role.code }).where(eq(adminUsers.id, adminId));
      } else {
        const [current] = await tx
          .select({ code: adminRoles.code })
          .from(adminUserRoles)
          .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
          .where(eq(adminUserRoles.adminUserId, adminId))
          .limit(1);
        currentRoleCode = current?.code ?? null;
      }

      if (nextShopIds !== undefined || (roleCode && currentRoleCode === 'super_admin')) {
        await replaceAdminShops(tx, adminId, currentRoleCode, nextShopIds ?? []);
      }

      return updated;
    });

    if (!row) return c.json({ code: 'NOT_FOUND', message: '管理员不存在' }, 404);
    return c.json({ item: row });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ROLE') {
      return c.json({ code: 'INVALID_ROLE', message: '角色不存在' }, 400);
    }
    if (error instanceof Error && error.message === 'INVALID_SHOP') {
      return c.json({ code: 'INVALID_SHOP', message: '包含不存在的门店' }, 400);
    }
    throw error;
  }
});

adminAccountRoutes.patch('/admins/:id/status', async (c) => {
  const denied = await guardPermission(c, 'admins.write');
  if (denied) return denied;

  const body = await c.req.json<{ status?: number }>().catch(() => null);
  if (!body || (body.status !== 0 && body.status !== 1)) {
    return c.json({ code: 'INVALID_BODY', message: '需要 status 为 0 或 1' }, 400);
  }

  const [row] = await (await getDb())
    .update(adminUsers)
    .set({ status: body.status, updatedAt: new Date() })
    .where(eq(adminUsers.id, c.req.param('id')))
    .returning({ id: adminUsers.id, status: adminUsers.status });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '管理员不存在' }, 404);
  return c.json({ item: row });
});

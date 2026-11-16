import { Hono } from 'hono';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { adminRoles, adminUserRoles, adminUsers, addresses, customers, getDb, users, userRoleEnum } from '@sds/db';
import { hashPassword } from '../lib/password';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';

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
  status: z.number().int().min(0).max(1).optional()
});

const updateAdminSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    role: z.string().trim().max(32).optional(),
    status: z.number().int().min(0).max(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

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

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

adminAccountRoutes.post('/admins', async (c) => {
  const denied = await guardPermission(c, 'admins.write');
  if (denied) return denied;

  const parsed = createAdminSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  try {
    const db = await getDb();
    const [row] = await db
      .insert(adminUsers)
      .values({
        username: parsed.data.username.toLowerCase(),
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.displayName,
        role: parsed.data.role ?? 'platform_admin',
        status: parsed.data.status ?? 1
      })
      .returning({ id: adminUsers.id });

    // 新建管理员默认授予只读角色，具体权限在「管理员权限」tab 里调整
    const [viewerRole] = await db
      .select({ id: adminRoles.id })
      .from(adminRoles)
      .where(eq(adminRoles.code, 'viewer'));
    if (viewerRole) {
      await db.insert(adminUserRoles).values({ adminUserId: row.id, roleId: viewerRole.id });
    }

    return c.json({ item: row }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'USERNAME_EXISTS', message: '该账号已存在' }, 409);
    }
    throw error;
  }
});

adminAccountRoutes.patch('/admins/:id', async (c) => {
  const denied = await guardPermission(c, 'admins.write');
  if (denied) return denied;

  const parsed = updateAdminSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const [row] = await (await getDb())
    .update(adminUsers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(adminUsers.id, c.req.param('id')))
    .returning({ id: adminUsers.id });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '管理员不存在' }, 404);
  return c.json({ item: row });
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

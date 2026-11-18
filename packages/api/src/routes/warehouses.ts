import { Hono } from 'hono';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { adminUsers, adminUserWarehouses, getDb, warehouses } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission, loadAdminAccess } from '../lib/admin-access.js';

/** 平台仓库主数据与仓权限 */
export const warehouseRoutes = new Hono<AdminEnv>();

warehouseRoutes.use('*', requireAdmin);

const warehouseSchema = z.object({
  code: z.string().trim().min(1, '仓库编码必填').max(32),
  name: z.string().trim().min(1, '仓库名称必填').max(100),
  type: z.enum(['hq', 'regional']).optional(),
  address: z.string().trim().max(300).nullish(),
  coldZoneSupported: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  remark: z.string().trim().max(500).nullish()
});

const updateWarehouseSchema = warehouseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const membersSchema = z.object({
  adminUserIds: z.array(z.uuid('管理员 ID 不合法')).max(200)
});

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function isSuperAdmin(adminId: string) {
  const { roles } = await loadAdminAccess(adminId);
  return roles.some((role) => role.code === 'super_admin');
}

/** 非 super_admin 只能操作已授权给自己的仓库 */
async function hasWarehouseAccess(adminId: string, warehouseId: string) {
  if (await isSuperAdmin(adminId)) return true;
  const db = await getDb();
  const [row] = await db
    .select({ warehouseId: adminUserWarehouses.warehouseId })
    .from(adminUserWarehouses)
    .where(
      and(
        eq(adminUserWarehouses.adminUserId, adminId),
        eq(adminUserWarehouses.warehouseId, warehouseId)
      )
    )
    .limit(1);
  return Boolean(row);
}

warehouseRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const admin = c.get('admin');
  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const type = c.req.query('type')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [];
  if (!(await isSuperAdmin(admin.sub))) {
    const assigned = await db
      .select({ warehouseId: adminUserWarehouses.warehouseId })
      .from(adminUserWarehouses)
      .where(eq(adminUserWarehouses.adminUserId, admin.sub));
    if (assigned.length === 0) {
      return c.json({ items: [], total: 0, page, pageSize });
    }
    conditions.push(
      inArray(
        warehouses.id,
        assigned.map((row) => row.warehouseId)
      )
    );
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(warehouses.code, `%${keyword}%`),
        ilike(warehouses.name, `%${keyword}%`),
        ilike(warehouses.address, `%${keyword}%`)
      )!
    );
  }
  if (type === 'hq' || type === 'regional') {
    conditions.push(eq(warehouses.type, type));
  }
  if (status === 'active' || status === 'disabled') {
    conditions.push(eq(warehouses.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(warehouses)
      .where(where)
      .orderBy(asc(warehouses.code))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(warehouses).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

warehouseRoutes.post('/', async (c) => {
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const parsed = warehouseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const admin = c.get('admin');
  const db = await getDb();
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(warehouses)
        .values({
          code: parsed.data.code,
          name: parsed.data.name,
          type: parsed.data.type ?? 'hq',
          address: parsed.data.address ?? null,
          coldZoneSupported: parsed.data.coldZoneSupported ?? false,
          status: parsed.data.status ?? 'active',
          remark: parsed.data.remark ?? null
        })
        .returning();
      // 创建人自动获得该仓可见范围，避免新建后自己反而看不到
      await tx
        .insert(adminUserWarehouses)
        .values({ adminUserId: admin.sub, warehouseId: row.id })
        .onConflictDoNothing();
      return row;
    });

    return c.json({ item: created }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'WAREHOUSE_CODE_EXISTS', message: '仓库编码已存在' }, 409);
    }
    throw error;
  }
});

warehouseRoutes.patch('/:id', async (c) => {
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const db = await getDb();
  const id = c.req.param('id');
  const [existing] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  if (!existing) return c.json({ code: 'NOT_FOUND', message: '仓库不存在' }, 404);

  const admin = c.get('admin');
  if (!(await hasWarehouseAccess(admin.sub, id))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的维护权限' }, 403);
  }

  const parsed = updateWarehouseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  try {
    await db
      .update(warehouses)
      .set({
        ...(parsed.data.code === undefined ? {} : { code: parsed.data.code }),
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
        ...(parsed.data.address === undefined ? {} : { address: parsed.data.address }),
        ...(parsed.data.coldZoneSupported === undefined
          ? {}
          : { coldZoneSupported: parsed.data.coldZoneSupported }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.remark === undefined ? {} : { remark: parsed.data.remark }),
        updatedAt: new Date()
      })
      .where(eq(warehouses.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'WAREHOUSE_CODE_EXISTS', message: '仓库编码已存在' }, 409);
    }
    throw error;
  }

  return c.json({ item: { id } });
});

async function listWarehouseMembers(warehouseId: string) {
  const db = await getDb();
  return db
    .select({
      id: adminUsers.id,
      username: adminUsers.username,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      status: adminUsers.status
    })
    .from(adminUserWarehouses)
    .innerJoin(adminUsers, eq(adminUsers.id, adminUserWarehouses.adminUserId))
    .where(eq(adminUserWarehouses.warehouseId, warehouseId))
    .orderBy(asc(adminUsers.username));
}

/** 仓库成员：仅返回已绑定到该仓的管理员；候选人限于启用中的管理员账号 */
warehouseRoutes.get('/:id/members', async (c) => {
  const denied = await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const db = await getDb();
  const id = c.req.param('id');
  const [existing] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  if (!existing) return c.json({ code: 'NOT_FOUND', message: '仓库不存在' }, 404);

  const admin = c.get('admin');
  if (!(await hasWarehouseAccess(admin.sub, id))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
  }

  const [items, candidates] = await Promise.all([
    listWarehouseMembers(id),
    db
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
        status: adminUsers.status
      })
      .from(adminUsers)
      .where(eq(adminUsers.status, 1))
      .orderBy(asc(adminUsers.username))
  ]);

  return c.json({ items, candidates });
});

/** 全量替换仓库成员；不在列表中的绑定会被解除 */
warehouseRoutes.put('/:id/members', async (c) => {
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const parsed = membersSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [existing] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  if (!existing) return c.json({ code: 'NOT_FOUND', message: '仓库不存在' }, 404);

  const admin = c.get('admin');
  if (!(await hasWarehouseAccess(admin.sub, id))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的维护权限' }, 403);
  }

  const adminUserIds = [...new Set(parsed.data.adminUserIds)];
  if (adminUserIds.length > 0) {
    const found = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(inArray(adminUsers.id, adminUserIds));
    if (found.length !== adminUserIds.length) {
      return c.json({ code: 'ADMIN_NOT_FOUND', message: '包含不存在的管理员' }, 400);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(adminUserWarehouses).where(eq(adminUserWarehouses.warehouseId, id));
    if (adminUserIds.length > 0) {
      await tx.insert(adminUserWarehouses).values(
        adminUserIds.map((adminUserId) => ({ adminUserId, warehouseId: id }))
      );
    }
  });

  return c.json({ items: await listWarehouseMembers(id) });
});

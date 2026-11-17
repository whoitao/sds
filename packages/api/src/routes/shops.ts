import { Hono } from 'hono';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  catalogCategories,
  catalogProducts,
  getDb,
  shopHiddenCategories,
  shopMembers,
  shops,
  shopStatusEnum,
  users
} from '@sds/db';
import type { BusinessHours } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { fanOutCatalogProductsToShop } from '../lib/catalog-fanout.js';

/** 平台侧店铺管理，对应 PRD 5.2 / 5.3 与 6.x 店铺模块 */
export const shopRoutes = new Hono<AdminEnv>();

shopRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** 营业时间按「同日时段」存储：每天 open/close，close 必须晚于 open，不支持跨天 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const dayHoursSchema = z
  .object({
    open: z.string().regex(TIME_PATTERN, '营业开始时间格式应为 HH:mm'),
    close: z.string().regex(TIME_PATTERN, '营业结束时间格式应为 HH:mm')
  })
  .refine((value) => value.close > value.open, {
    message: '营业结束时间需晚于开始时间（暂不支持跨天营业）'
  });

const businessHoursSchema = z.object({
  mon: dayHoursSchema.nullish(),
  tue: dayHoursSchema.nullish(),
  wed: dayHoursSchema.nullish(),
  thu: dayHoursSchema.nullish(),
  fri: dayHoursSchema.nullish(),
  sat: dayHoursSchema.nullish(),
  sun: dayHoursSchema.nullish()
});

/** 去掉未设置的日期与 null 值，空对象统一落库为 null */
function normalizeBusinessHours(
  value: z.infer<typeof businessHoursSchema> | null | undefined
): BusinessHours | null {
  if (!value) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, { open: string; close: string }] =>
      Boolean(entry[1]?.open && entry[1]?.close)
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

const shopFields = {
  name: z.string().trim().min(1, '店铺名称必填').max(100),
  address: z.string().trim().min(1, '地址必填').max(200),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  phone: z
    .string()
    .regex(/^1\d{10}$/, '电话需为 11 位')
    .nullish(),
  announcement: z.string().max(500).nullish(),
  coverUrl: z.string().url('封面需为合法 URL').nullish(),
  businessHours: businessHoursSchema.nullish(),
  status: z.enum(shopStatusEnum.enumValues).optional()
};

const createShopSchema = z.object(shopFields);
const updateShopSchema = createShopSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

/**
 * 把已发布总部商品补到指定门店（幂等），并补齐门店 SKU 与 0 库存行。
 */
async function attachPublishedProducts(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  categoryScope: string[] | null
) {
  const result = await fanOutCatalogProductsToShop(db, shopId, categoryScope);
  return result.importedProducts;
}

const memberSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, '手机号需为 11 位'),
  role: z.enum(['shop_manager', 'shop_staff', 'delivery'])
});

shopRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'shops.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const filters = [];
  if (keyword) filters.push(ilike(shops.name, `%${keyword}%`));
  if (status && shopStatusEnum.enumValues.includes(status as (typeof shopStatusEnum.enumValues)[number])) {
    filters.push(eq(shops.status, status as (typeof shopStatusEnum.enumValues)[number]));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: shops.id,
        name: shops.name,
        address: shops.address,
        phone: shops.phone,
        status: shops.status,
        longitude: shops.longitude,
        latitude: shops.latitude,
        announcement: shops.announcement,
        coverUrl: shops.coverUrl,
        businessHours: shops.businessHours,
        createdAt: shops.createdAt,
        // 注意：单表查询下 drizzle 会把 ${shops.id} 渲染成裸 "id"，
        // 在子查询里会解析成 shop_members.id，因此这里显式写 "shops"."id"。
        managerCount: sql<number>`(
          select count(*) from shop_members m
          where m.shop_id = "shops"."id" and m.role = 'shop_manager'
        )::int`
      })
      .from(shops)
      .where(where)
      .orderBy(desc(shops.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(shops).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

shopRoutes.post('/', async (c) => {
  const denied = await guardPermission(c, 'shops.write');
  if (denied) return denied;

  const parsed = createShopSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { longitude, latitude, businessHours, ...rest } = parsed.data;

  const db = await getDb();
  const [row] = await db
    .insert(shops)
    .values({
      ...rest,
      phone: rest.phone ?? null,
      businessHours: normalizeBusinessHours(businessHours),
      longitude: String(longitude),
      latitude: String(latitude)
    })
    .returning({ id: shops.id });

  // 新店自动继承全部已发布商品；幂等，不覆盖门店后续自行调整的价格/上下架/排序/库存
  const importedCount = await attachPublishedProducts(db, row.id, null);

  return c.json({ item: row, importedCount }, 201);
});

shopRoutes.patch('/:id', async (c) => {
  const denied = await guardPermission(c, 'shops.write', { shopId: c.req.param('id') });
  if (denied) return denied;

  const parsed = updateShopSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { longitude, latitude, businessHours, ...rest } = parsed.data;
  const [row] = await (await getDb())
    .update(shops)
    .set({
      ...rest,
      ...(longitude === undefined ? {} : { longitude: String(longitude) }),
      ...(latitude === undefined ? {} : { latitude: String(latitude) }),
      ...(businessHours === undefined
        ? {}
        : { businessHours: normalizeBusinessHours(businessHours) }),
      updatedAt: new Date()
    })
    .where(eq(shops.id, c.req.param('id')))
    .returning({ id: shops.id });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '店铺不存在' }, 404);
  return c.json({ item: row });
});

shopRoutes.patch('/:id/status', async (c) => {
  const denied = await guardPermission(c, 'shops.write', { shopId: c.req.param('id') });
  if (denied) return denied;

  const body = await c.req.json<{ status?: string }>().catch(() => null);
  if (
    !body ||
    !shopStatusEnum.enumValues.includes(body.status as (typeof shopStatusEnum.enumValues)[number])
  ) {
    return c.json({ code: 'INVALID_BODY', message: 'status 需为 open/closed/suspended' }, 400);
  }

  const [row] = await (await getDb())
    .update(shops)
    .set({
      status: body.status as (typeof shopStatusEnum.enumValues)[number],
      updatedAt: new Date()
    })
    .where(eq(shops.id, c.req.param('id')))
    .returning({ id: shops.id, status: shops.status });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '店铺不存在' }, 404);
  return c.json({ item: row });
});

shopRoutes.get('/:id/members', async (c) => {
  const denied = await guardPermission(c, 'shops.read', { shopId: c.req.param('id') });
  if (denied) return denied;

  const rows = await (await getDb())
    .select({
      id: shopMembers.id,
      userId: shopMembers.userId,
      role: shopMembers.role,
      phone: users.phone,
      name: users.name,
      createdAt: shopMembers.createdAt
    })
    .from(shopMembers)
    .innerJoin(users, eq(users.id, shopMembers.userId))
    .where(eq(shopMembers.shopId, c.req.param('id')))
    .orderBy(desc(shopMembers.createdAt));

  return c.json({ items: rows });
});

shopRoutes.post('/:id/members', async (c) => {
  const parsed = memberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const shopId = c.req.param('id');

  // ABAC 资源条件：已暂停的店铺不允许再改店长（条件来自角色的授予配置）
  const [targetShop] = await db
    .select({ status: shops.status })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const denied = await guardPermission(c, 'shops.members.write', {
    shopId,
    status: targetShop?.status
  });
  if (denied) return denied;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, parsed.data.phone))
    .limit(1);

  if (!user) {
    return c.json({ code: 'USER_NOT_FOUND', message: '该手机号还没有业务用户' }, 404);
  }

  try {
    const [row] = await db
      .insert(shopMembers)
      .values({ shopId, userId: user.id, role: parsed.data.role })
      .returning({ id: shopMembers.id });

    return c.json({ item: row }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'MEMBER_EXISTS', message: '该用户已是店铺成员' }, 409);
    }
    throw error;
  }
});

shopRoutes.delete('/:id/members/:memberId', async (c) => {
  const denied = await guardPermission(c, 'shops.members.write', { shopId: c.req.param('id') });
  if (denied) return denied;

  const [row] = await (await getDb())
    .delete(shopMembers)
    .where(and(eq(shopMembers.id, c.req.param('memberId')), eq(shopMembers.shopId, c.req.param('id'))))
    .returning({ id: shopMembers.id });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '成员不存在' }, 404);
  return c.json({ item: row });
});

const importCatalogSchema = z
  .object({
    // 可选：只铺某个总部分类（含其子分类）；不传则铺全部已发布商品
    categoryId: z.uuid('分类 ID 不合法').nullish()
  })
  .nullish();

/**
 * 一键铺货：把已发布的总部商品补到该门店。
 * 只补缺（ON CONFLICT DO NOTHING），不覆盖门店已改的价格/上下架/排序，可重复执行。
 */
shopRoutes.post('/:id/catalog/import', async (c) => {
  const shopId = c.req.param('id');
  const denied = await guardPermission(c, 'shops.catalog_push', { shopId });
  if (denied) return denied;

  const parsed = importCatalogSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const categoryId = parsed.data?.categoryId ?? null;

  const db = await getDb();
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '店铺不存在' }, 404);

  let categoryScope: string[] | null = null;
  if (categoryId) {
    const rows = await db
      .select({ id: catalogCategories.id })
      .from(catalogCategories)
      .where(
        or(eq(catalogCategories.id, categoryId), eq(catalogCategories.parentId, categoryId))
      );
    if (rows.length === 0) {
      return c.json({ code: 'CATEGORY_NOT_FOUND', message: '总部分类不存在' }, 404);
    }
    categoryScope = rows.map((row) => row.id);
  }

  const imported = await fanOutCatalogProductsToShop(db, shopId, categoryScope);

  const [published] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogProducts)
    .where(
      categoryScope
        ? and(eq(catalogProducts.status, 'published'), inArray(catalogProducts.categoryId, categoryScope))
        : eq(catalogProducts.status, 'published')
    );

  return c.json({
    ok: true,
    created: imported.importedProducts,
    createdSkus: imported.createdSkus,
    publishedTotal: published?.total ?? 0
  });
});

const categoryVisibilitySchema = z.object({ hidden: z.boolean() });

/**
 * 门店隐藏/显示共享分类（迁移 0009）。
 * 隐藏父级会连带隐藏子级；显示子级会连带显示父级，避免出现「子可见父不可见」的悬空状态。
 */
shopRoutes.patch('/:id/catalog/categories/:categoryId', async (c) => {
  const shopId = c.req.param('id');
  const categoryId = c.req.param('categoryId');
  const denied = await guardPermission(c, 'products.write', { shopId });
  if (denied) return denied;

  const parsed = categoryVisibilitySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: 'hidden 需为布尔值' }, 400);
  }

  const db = await getDb();
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '店铺不存在' }, 404);

  const [category] = await db
    .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, categoryId))
    .limit(1);
  if (!category) return c.json({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, 404);

  if (parsed.data.hidden) {
    const children = await db
      .select({ id: catalogCategories.id })
      .from(catalogCategories)
      .where(eq(catalogCategories.parentId, categoryId));
    const ids = [categoryId, ...children.map((row) => row.id)];
    await db
      .insert(shopHiddenCategories)
      .values(ids.map((id) => ({ shopId, catalogCategoryId: id })))
      .onConflictDoNothing();
    return c.json({ ok: true, hidden: true, affected: ids.length });
  }

  const ids = category.parentId ? [categoryId, category.parentId] : [categoryId];
  await db
    .delete(shopHiddenCategories)
    .where(
      and(eq(shopHiddenCategories.shopId, shopId), inArray(shopHiddenCategories.catalogCategoryId, ids))
    );
  return c.json({ ok: true, hidden: false, affected: ids.length });
});

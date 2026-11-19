import { Hono } from 'hono';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  catalogCategories,
  catalogProducts,
  getDb,
  shopHiddenCategories,
  shops,
  shopStatusEnum
} from '@sds/db';
import type { BusinessHours } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { imagePathFromValue, resolveImageUrl } from '../lib/storage.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, canAccessShop } from '../lib/shop-scope.js';
import { fanOutCatalogProductsToShop } from '../lib/catalog-fanout.js';

/** 平台侧店铺管理，对应 PRD 5.2 / 5.3 与 6.x 店铺模块 */
export const shopRoutes = new Hono<AdminEnv>();

shopRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
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
  coverUrl: z.string().trim().max(500).nullish(),
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

shopRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'shops.read');
  if (denied) return denied;

  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  // 非超管只能看到 admin_user_shops 绑定的门店；未绑定视为无任何门店
  const shopIds = await accessibleShopIds(c.get('admin').sub);
  if (shopIds !== null && shopIds.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize });
  }

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';

  const filters = [];
  if (shopIds !== null) filters.push(inArray(shops.id, shopIds));
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
        createdAt: shops.createdAt
      })
      .from(shops)
      .where(where)
      .orderBy(desc(shops.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(shops).where(where)
  ]);

  return c.json({
    items: items.map((item) => ({ ...item, coverUrl: resolveImageUrl(item.coverUrl) })),
    total: totalRows[0]?.total ?? 0,
    page,
    pageSize
  });
});

shopRoutes.post('/', async (c) => {
  const denied = await guardPermission(c, 'shops.write');
  if (denied) return denied;

  const parsed = createShopSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { longitude, latitude, businessHours, ...rest } = parsed.data;
  // 写入统一存桶内相对路径；兼容旧调用传入的完整公开 URL，外部地址拒绝
  const coverPath = rest.coverUrl ? imagePathFromValue(rest.coverUrl) : null;
  if (rest.coverUrl && !coverPath) {
    return c.json({ code: 'INVALID_IMAGE_URL', message: '封面需上传到本系统存储' }, 400);
  }

  const db = await getDb();
  const [row] = await db
    .insert(shops)
    .values({
      ...rest,
      coverUrl: coverPath,
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
  const coverPath =
    rest.coverUrl === undefined
      ? undefined
      : rest.coverUrl
        ? imagePathFromValue(rest.coverUrl)
        : null;
  if (rest.coverUrl && !coverPath) {
    return c.json({ code: 'INVALID_IMAGE_URL', message: '封面需上传到本系统存储' }, 400);
  }
  const [row] = await (await getDb())
    .update(shops)
    .set({
      ...rest,
      ...(coverPath === undefined ? {} : { coverUrl: coverPath }),
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
  // 店长拥有 shops.catalog_push，必须限制在绑定门店内
  if (!(await canAccessShop(c.get('admin').sub, shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '无权操作该店铺' }, 403);
  }

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
  // 门店分类显隐使用窄权限，不与门店改价/上下架的 products.write 混用
  const denied = await guardPermission(c, 'products.catalog_visibility', { shopId });
  if (denied) return denied;
  // 非超管只能操作自己绑定的门店，防止改 shopId 影响其他门店
  if (!(await canAccessShop(c.get('admin').sub, shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '无权操作该店铺' }, 403);
  }

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

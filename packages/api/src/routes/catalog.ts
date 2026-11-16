import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  catalogCategories,
  catalogProducts,
  getDb,
  products,
  productStockTypeEnum
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';

/**
 * 总部商品库（catalog）只读接口，对应多店方案 P1。
 * 写接口（新建/编辑/发布/强制下架）在 P3 接入，权限码已在迁移 0008 落库。
 */
export const catalogRoutes = new Hono<AdminEnv>();

catalogRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 分类固定两级：默认返回「该分类 + 直接子分类」，与门店侧筛选口径一致 */
async function resolveCatalogCategoryScope(categoryId: string, includeDescendants: boolean) {
  if (!includeDescendants) return [categoryId];
  const children = await (await getDb())
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.parentId, categoryId));
  return [categoryId, ...children.map((row) => row.id)];
}

catalogRoutes.get('/catalog/categories', async (c) => {
  const denied = await guardPermission(c, 'catalog.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const isActive = c.req.query('isActive')?.trim() ?? '';
  const shopId = c.req.query('shopId')?.trim() ?? '';

  const filters = [];
  if (keyword) filters.push(ilike(catalogCategories.name, `%${keyword}%`));
  if (isActive === 'true' || isActive === 'false') {
    filters.push(eq(catalogCategories.isActive, isActive === 'true'));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  // 传 shopId 时带出门店维度的隐藏标记，供门店端分类可见性开关使用
  const hiddenExpr = shopId
    ? sql<boolean>`exists (
        select 1 from shop_hidden_categories h
         where h.shop_id = ${shopId}::uuid and h.catalog_category_id = "catalog_categories"."id"
      )`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      id: catalogCategories.id,
      parentId: catalogCategories.parentId,
      level: catalogCategories.level,
      name: catalogCategories.name,
      sortOrder: catalogCategories.sortOrder,
      iconUrl: catalogCategories.iconUrl,
      isActive: catalogCategories.isActive,
      createdAt: catalogCategories.createdAt,
      hidden: hiddenExpr,
      productCount: sql<number>`(
        select count(*) from catalog_products cp where cp.category_id = "catalog_categories"."id"
      )::int`,
      childCount: sql<number>`(
        select count(*) from catalog_categories cc where cc.parent_id = "catalog_categories"."id"
      )::int`
    })
    .from(catalogCategories)
    .where(where)
    .orderBy(asc(catalogCategories.level), asc(catalogCategories.sortOrder), asc(catalogCategories.createdAt));

  return c.json({ items: rows });
});

catalogRoutes.get('/catalog/products', async (c) => {
  const denied = await guardPermission(c, 'catalog.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const categoryId = c.req.query('categoryId')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const includeDescendants = c.req.query('includeDescendants')?.trim() !== 'false';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const filters = [];
  if (categoryId) {
    const scope = await resolveCatalogCategoryScope(categoryId, includeDescendants);
    filters.push(inArray(catalogProducts.categoryId, scope));
  }
  if (keyword) filters.push(ilike(catalogProducts.name, `%${keyword}%`));
  if (['draft', 'published', 'archived'].includes(status)) {
    filters.push(eq(catalogProducts.status, status));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: catalogProducts.id,
        categoryId: catalogProducts.categoryId,
        categoryName: catalogCategories.name,
        name: catalogProducts.name,
        description: catalogProducts.description,
        imageUrl: catalogProducts.imageUrl,
        unit: catalogProducts.unit,
        defaultPrice: catalogProducts.defaultPrice,
        stockType: catalogProducts.stockType,
        status: catalogProducts.status,
        isTest: catalogProducts.isTest,
        publishedAt: catalogProducts.publishedAt,
        createdAt: catalogProducts.createdAt,
        updatedAt: catalogProducts.updatedAt,
        // 影响面：已引用该总部商品的门店商品行数（含已下架）
        shopProductCount: sql<number>`(
          select count(*) from products p where p.catalog_product_id = "catalog_products"."id"
        )::int`,
        // 当前被总部强制下架的门店行数，>0 表示该商品处于强制下架状态
        blockedShopCount: sql<number>`(
          select count(*) from products p
           where p.catalog_product_id = "catalog_products"."id" and p.is_blocked
        )::int`
      })
      .from(catalogProducts)
      .leftJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
      .where(where)
      .orderBy(desc(catalogProducts.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(catalogProducts).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

catalogRoutes.get('/catalog/products/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.read');
  if (denied) return denied;

  const db = await getDb();
  const [item] = await db
    .select({
      id: catalogProducts.id,
      categoryId: catalogProducts.categoryId,
      categoryName: catalogCategories.name,
      name: catalogProducts.name,
      description: catalogProducts.description,
      imageUrl: catalogProducts.imageUrl,
      unit: catalogProducts.unit,
      defaultPrice: catalogProducts.defaultPrice,
      stockType: catalogProducts.stockType,
      status: catalogProducts.status,
      isTest: catalogProducts.isTest,
      publishedAt: catalogProducts.publishedAt,
      createdAt: catalogProducts.createdAt,
      updatedAt: catalogProducts.updatedAt
    })
    .from(catalogProducts)
    .leftJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
    .where(eq(catalogProducts.id, c.req.param('id')))
    .limit(1);

  if (!item) return c.json({ code: 'NOT_FOUND', message: '总部商品不存在' }, 404);

  const [stats] = await db
    .select({
      shopProductCount: sql<number>`count(*)::int`,
      availableCount: sql<number>`count(*) filter (where ${products.isAvailable} and not ${products.isBlocked})::int`,
      blockedShopCount: sql<number>`count(*) filter (where ${products.isBlocked})::int`
    })
    .from(products)
    .where(eq(products.catalogProductId, item.id));

  return c.json({ item: { ...item, ...stats } });
});

// ---------------------------------------------------------------- 总部商品写接口

const catalogProductFields = {
  categoryId: z.uuid('分类 ID 不合法').nullish(),
  name: z.string().trim().min(1, '商品名称必填').max(100),
  description: z.string().max(1000).nullish(),
  imageUrl: z.string().url('商品图片需为合法 URL').nullish(),
  unit: z.string().trim().min(1, '单位必填').max(20),
  defaultPrice: z.number().min(0, '建议价不能为负').max(99999999),
  stockType: z.enum(productStockTypeEnum.enumValues).optional()
};

const createCatalogProductSchema = z.object(catalogProductFields);
const updateCatalogProductSchema = z
  .object({
    categoryId: catalogProductFields.categoryId,
    name: catalogProductFields.name.optional(),
    description: catalogProductFields.description,
    imageUrl: catalogProductFields.imageUrl,
    unit: catalogProductFields.unit.optional(),
    defaultPrice: catalogProductFields.defaultPrice.optional(),
    stockType: catalogProductFields.stockType,
    status: z.enum(['draft', 'archived']).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const publishCatalogProductsSchema = z.object({
  ids: z.array(z.uuid('商品 ID 不合法')).min(1, '至少选择一个商品')
});

const forceOfflineSchema = z
  .object({
    blocked: z.boolean(),
    reason: z.string().trim().max(200).nullish()
  })
  .refine((value) => !value.blocked || Boolean(value.reason), '强制下架必须填写原因');

async function catalogCategoryExists(categoryId: string) {
  const [row] = await (await getDb())
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, categoryId))
    .limit(1);
  return Boolean(row);
}

catalogRoutes.post('/catalog/products', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = createCatalogProductSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { categoryId, defaultPrice, ...rest } = parsed.data;
  if (categoryId && !(await catalogCategoryExists(categoryId))) {
    return c.json({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, 404);
  }

  const [row] = await (await getDb())
    .insert(catalogProducts)
    .values({
      ...rest,
      categoryId: categoryId ?? null,
      defaultPrice: defaultPrice.toFixed(2),
      description: rest.description ?? null,
      imageUrl: rest.imageUrl ?? null,
      stockType: rest.stockType ?? 'tracked',
      status: 'draft'
    })
    .returning({ id: catalogProducts.id });

  return c.json({ item: row }, 201);
});

catalogRoutes.patch('/catalog/products/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const id = c.req.param('id');
  const parsed = updateCatalogProductSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const [current] = await db
    .select({ id: catalogProducts.id, status: catalogProducts.status })
    .from(catalogProducts)
    .where(eq(catalogProducts.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '总部商品不存在' }, 404);
  if (current.status === 'archived') {
    return c.json({ code: 'CATALOG_PRODUCT_ARCHIVED', message: '已归档商品不可编辑' }, 409);
  }

  const { categoryId, defaultPrice, status, ...rest } = parsed.data;
  if (categoryId && !(await catalogCategoryExists(categoryId))) {
    return c.json({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, 404);
  }

  const sharedUpdates = {
    ...(rest.name === undefined ? {} : { name: rest.name }),
    ...(rest.description === undefined ? {} : { description: rest.description }),
    ...(rest.imageUrl === undefined ? {} : { imageUrl: rest.imageUrl }),
    ...(rest.unit === undefined ? {} : { unit: rest.unit }),
    ...(rest.stockType === undefined ? {} : { stockType: rest.stockType }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(defaultPrice === undefined ? {} : { defaultPrice: defaultPrice.toFixed(2) }),
    ...(status === undefined ? {} : { status })
  };

  await db.transaction(async (tx) => {
    if (Object.keys(sharedUpdates).length > 0) {
      await tx
        .update(catalogProducts)
        .set({ ...sharedUpdates, updatedAt: new Date() })
        .where(eq(catalogProducts.id, id));
    }

    // 共享字段即时同步到门店行（副本仅作缓存，读路径自 P4 起以总部为准）
    const mirror = {
      ...(rest.name === undefined ? {} : { name: rest.name }),
      ...(rest.description === undefined ? {} : { description: rest.description }),
      ...(rest.imageUrl === undefined ? {} : { imageUrl: rest.imageUrl }),
      ...(rest.unit === undefined ? {} : { unit: rest.unit }),
      ...(rest.stockType === undefined ? {} : { stockType: rest.stockType })
    };
    if (Object.keys(mirror).length > 0) {
      await tx
        .update(products)
        .set({ ...mirror, updatedAt: new Date() })
        .where(eq(products.catalogProductId, id));
    }
  });

  return c.json({ item: { id } });
});

/** 发布：进入门店视图，并自动为所有尚未引用该商品的门店补一行（决策：新商品自动进所有店） */
catalogRoutes.post('/catalog/products/publish', async (c) => {
  const denied = await guardPermission(c, 'catalog.publish');
  if (denied) return denied;

  const parsed = publishCatalogProductsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const ids = [...new Set(parsed.data.ids)];

  const db = await getDb();
  const rows = await db
    .select({ id: catalogProducts.id, status: catalogProducts.status })
    .from(catalogProducts)
    .where(inArray(catalogProducts.id, ids));

  if (rows.length !== ids.length) {
    return c.json({ code: 'CATALOG_PRODUCT_NOT_FOUND', message: '存在无效的商品 ID' }, 404);
  }
  if (rows.some((row) => row.status === 'archived')) {
    return c.json({ code: 'CATALOG_PRODUCT_ARCHIVED', message: '已归档商品不能发布，请先恢复为草稿' }, 409);
  }

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db.transaction(async (tx) => {
    await tx
      .update(catalogProducts)
      .set({ status: 'published', publishedAt: sql`coalesce(${catalogProducts.publishedAt}, now())`, updatedAt: new Date() })
      .where(inArray(catalogProducts.id, ids));

    // 幂等铺货：只补缺，不覆盖门店已改的价格/上下架/排序；is_test 随总部商品带入
    const attached = await tx.execute(sql`
      insert into products
        (shop_id, catalog_product_id, name, description, image_url, unit, stock_type, is_available, sort_order, is_test)
      select s.id, cp.id, cp.name, cp.description, cp.image_url, cp.unit, cp.stock_type, true, 0, cp.is_test
        from shops s
        cross join catalog_products cp
       where cp.id in (${idList}) and cp.status = 'published'
      on conflict (shop_id, catalog_product_id) where catalog_product_id is not null do nothing
      returning shop_id
    `);

    return { attachedShops: attached.rowCount ?? 0 };
  });

  return c.json({ ok: true, published: ids.length, attachedShops: result.attachedShops });
});

/** 强制下架 / 解除：总部专属开关，落在每家门店的 products 行上 */
catalogRoutes.patch('/catalog/products/:id/offline', async (c) => {
  const denied = await guardPermission(c, 'catalog.force_offline');
  if (denied) return denied;

  const parsed = forceOfflineSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const id = c.req.param('id');
  const db = await getDb();
  const [current] = await db
    .select({ id: catalogProducts.id })
    .from(catalogProducts)
    .where(eq(catalogProducts.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '总部商品不存在' }, 404);

  const updated = await db
    .update(products)
    .set({
      isBlocked: parsed.data.blocked,
      blockedReason: parsed.data.blocked ? (parsed.data.reason ?? null) : null,
      updatedAt: new Date()
    })
    .where(eq(products.catalogProductId, id))
    .returning({ id: products.id });

  return c.json({ ok: true, blocked: parsed.data.blocked, affectedShops: updated.length });
});

/** 测试数据清理预览：总部商品数 + 受影响门店商品行数 */
catalogRoutes.get('/catalog/test-data', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const db = await getDb();
  const result = await db.execute(sql`
    select
      (select count(*)::int from catalog_products where is_test) as "catalogProducts",
      (select count(*)::int
         from products p
        where p.is_test
           or p.catalog_product_id in (select id from catalog_products where is_test)) as "shopProducts"
  `);
  return c.json(result.rows[0] ?? { catalogProducts: 0, shopProducts: 0 });
});

/**
 * 一键清理测试数据：先删门店商品行（product_stocks 随外键级联），
 * 再删总部商品，避免 catalog_products 被门店行引用而删除失败。
 */
catalogRoutes.delete('/catalog/test-data', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const shopRows = await tx.execute(sql`
      delete from products p
       where p.is_test
          or p.catalog_product_id in (select id from catalog_products where is_test)
      returning p.id
    `);
    const catalogRows = await tx.execute(sql`
      delete from catalog_products where is_test returning id
    `);
    return {
      shopProducts: shopRows.rowCount ?? 0,
      catalogProducts: catalogRows.rowCount ?? 0
    };
  });

  return c.json({ ok: true, ...result });
});

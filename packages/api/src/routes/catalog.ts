import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  catalogCategories,
  catalogProducts,
  catalogSkus,
  getDb,
  productSkus,
  products,
  productStockTypeEnum,
  quantityModeEnum
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';
import {
  fanOutCatalogProductsToAllShops,
  fanOutNewCatalogSku,
  syncCatalogSkuToShopSkus
} from '../lib/catalog-fanout';
import { inferQuantityMode } from '../lib/quantity';

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

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function isForeignKeyViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23503'
  );
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

// ---------------------------------------------------------------- 总部分类写接口

const catalogCategoryFields = {
  name: z.string().trim().min(1, '分类名称必填').max(50),
  parentId: z.uuid('父分类 ID 不合法').nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  iconUrl: z.string().url('图标需为合法 URL').nullish(),
  isActive: z.boolean().optional()
};

const createCatalogCategorySchema = z.object(catalogCategoryFields);

const updateCatalogCategorySchema = z
  .object({
    name: catalogCategoryFields.name.optional(),
    sortOrder: catalogCategoryFields.sortOrder,
    iconUrl: catalogCategoryFields.iconUrl,
    isActive: catalogCategoryFields.isActive
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const moveCatalogCategorySchema = z.object({
  direction: z.enum(['up', 'down'])
});

/** 同级排序条件：一级分类之间 parent_id 均为 NULL，需用 isNull 而不是 eq */
function sameSiblingWhere(parentId: string | null) {
  return parentId
    ? eq(catalogCategories.parentId, parentId)
    : isNull(catalogCategories.parentId);
}

catalogRoutes.post('/catalog/categories', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = createCatalogCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { name, sortOrder, iconUrl, isActive } = parsed.data;
  const parentId = parsed.data.parentId ?? null;
  const db = await getDb();

  if (parentId) {
    const [parent] = await db
      .select({ id: catalogCategories.id, level: catalogCategories.level })
      .from(catalogCategories)
      .where(eq(catalogCategories.id, parentId))
      .limit(1);
    if (!parent) return c.json({ code: 'CATEGORY_NOT_FOUND', message: '父分类不存在' }, 404);
    if (parent.level !== 1) {
      return c.json(
        { code: 'CATEGORY_DEPTH_EXCEEDED', message: '分类最多两级，请选择一级分类作为父级' },
        409
      );
    }
  }

  try {
    const row = await db.transaction(async (tx) => {
      // 未指定顺序时追加到同级末尾
      let nextSortOrder = sortOrder;
      if (nextSortOrder === undefined) {
        const [maxRow] = await tx
          .select({ value: sql<number>`coalesce(max(${catalogCategories.sortOrder}), -1)::int` })
          .from(catalogCategories)
          .where(sameSiblingWhere(parentId));
        nextSortOrder = (maxRow?.value ?? -1) + 1;
      }

      const [inserted] = await tx
        .insert(catalogCategories)
        .values({
          parentId,
          level: parentId ? 2 : 1,
          name,
          sortOrder: nextSortOrder,
          iconUrl: iconUrl ?? null,
          isActive: isActive ?? true
        })
        .returning({ id: catalogCategories.id });
      return inserted;
    });

    return c.json({ item: row }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'CATEGORY_EXISTS', message: '同一父级下已有同名分类' }, 409);
    }
    if (isForeignKeyViolation(error)) {
      return c.json({ code: 'CATEGORY_NOT_FOUND', message: '父分类不存在' }, 404);
    }
    throw error;
  }
});

catalogRoutes.patch('/catalog/categories/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = updateCatalogCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  const { name, sortOrder, iconUrl, isActive } = parsed.data;
  const updates = {
    ...(name === undefined ? {} : { name }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(iconUrl === undefined ? {} : { iconUrl }),
    ...(isActive === undefined ? {} : { isActive })
  };

  try {
    await db.update(catalogCategories).set(updates).where(eq(catalogCategories.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'CATEGORY_EXISTS', message: '同一父级下已有同名分类' }, 409);
    }
    throw error;
  }

  return c.json({ ok: true, item: { id } });
});

/** 上下移动：重排同级 sort_order，写回 0,10,20…；越界时直接返回成功（按钮侧已禁用） */
catalogRoutes.patch('/catalog/categories/:id/move', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = moveCatalogCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  await db.transaction(async (tx) => {
    // 锁住同级行，避免并发排序交叉覆盖
    const siblings = await tx
      .select({ id: catalogCategories.id })
      .from(catalogCategories)
      .where(sameSiblingWhere(current.parentId))
      .orderBy(
        asc(catalogCategories.sortOrder),
        asc(catalogCategories.createdAt),
        asc(catalogCategories.id)
      )
      .for('update');

    const index = siblings.findIndex((row) => row.id === id);
    const targetIndex = parsed.data.direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;

    const reordered = [...siblings];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    for (let position = 0; position < reordered.length; position += 1) {
      await tx
        .update(catalogCategories)
        .set({ sortOrder: position * 10 })
        .where(eq(catalogCategories.id, reordered[position].id));
    }
  });

  return c.json({ ok: true });
});

/** 删除：有子级不可删；商品通过 catalog_products.category_id ON DELETE SET NULL 变未分类 */
catalogRoutes.delete('/catalog/categories/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  const [childRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogCategories)
    .where(eq(catalogCategories.parentId, id));
  if ((childRow?.total ?? 0) > 0) {
    return c.json(
      { code: 'CATEGORY_HAS_CHILDREN', message: '该分类下还有子分类，请先删除子分类' },
      409
    );
  }

  try {
    await db.delete(catalogCategories).where(eq(catalogCategories.id, id));
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json(
        { code: 'CATEGORY_IN_USE', message: '该分类仍被引用，暂时无法删除' },
        409
      );
    }
    throw error;
  }

  return c.json({ ok: true });
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
        )::int`,
        skuCount: sql<number>`(
          select count(*) from catalog_skus cs
           where cs.catalog_product_id = "catalog_products"."id" and cs.status = 'active'
        )::int`,
        defaultSkuId: sql<string | null>`(
          select cs.id from catalog_skus cs
           where cs.catalog_product_id = "catalog_products"."id" and cs.is_default
           limit 1
        )`
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

  const skus = await db
    .select({
      id: catalogSkus.id,
      specName: catalogSkus.specName,
      barcode: catalogSkus.barcode,
      unit: catalogSkus.unit,
      defaultPrice: catalogSkus.defaultPrice,
      stockType: catalogSkus.stockType,
      quantityMode: catalogSkus.quantityMode,
      isDefault: catalogSkus.isDefault,
      status: catalogSkus.status,
      sortOrder: catalogSkus.sortOrder,
      shopSkuCount: sql<number>`(
        select count(*) from product_skus ps where ps.catalog_sku_id = catalog_skus.id
      )::int`
    })
    .from(catalogSkus)
    .where(eq(catalogSkus.catalogProductId, item.id))
    .orderBy(asc(catalogSkus.sortOrder), asc(catalogSkus.createdAt));

  return c.json({ item: { ...item, ...stats, skus } });
});

// ---------------------------------------------------------------- 总部规格（SKU）

catalogRoutes.get('/catalog/products/:productId/skus', async (c) => {
  const denied = await guardPermission(c, 'catalog.read');
  if (denied) return denied;

  const db = await getDb();
  const productId = c.req.param('productId');
  const [product] = await db
    .select({ id: catalogProducts.id, status: catalogProducts.status })
    .from(catalogProducts)
    .where(eq(catalogProducts.id, productId))
    .limit(1);
  if (!product) return c.json({ code: 'NOT_FOUND', message: '总部商品不存在' }, 404);

  const items = await db
    .select({
      id: catalogSkus.id,
      specName: catalogSkus.specName,
      barcode: catalogSkus.barcode,
      unit: catalogSkus.unit,
      defaultPrice: catalogSkus.defaultPrice,
      stockType: catalogSkus.stockType,
      quantityMode: catalogSkus.quantityMode,
      isDefault: catalogSkus.isDefault,
      status: catalogSkus.status,
      sortOrder: catalogSkus.sortOrder,
      createdAt: catalogSkus.createdAt,
      shopSkuCount: sql<number>`(
        select count(*) from product_skus ps where ps.catalog_sku_id = catalog_skus.id
      )::int`,
      availableShopSkuCount: sql<number>`(
        select count(*) from product_skus ps
         where ps.catalog_sku_id = catalog_skus.id and ps.is_available
      )::int`
    })
    .from(catalogSkus)
    .where(eq(catalogSkus.catalogProductId, productId))
    .orderBy(asc(catalogSkus.sortOrder), asc(catalogSkus.createdAt));

  return c.json({ items });
});

catalogRoutes.post('/catalog/products/:productId/skus', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = createCatalogSkuSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const productId = c.req.param('productId');
  const [product] = await db
    .select({ id: catalogProducts.id, status: catalogProducts.status })
    .from(catalogProducts)
    .where(eq(catalogProducts.id, productId))
    .limit(1);
  if (!product) return c.json({ code: 'NOT_FOUND', message: '总部商品不存在' }, 404);
  if (product.status === 'archived') {
    return c.json({ code: 'CATALOG_PRODUCT_ARCHIVED', message: '已归档商品不可新增规格' }, 409);
  }

  const data = parsed.data;
  let created: { id: string };
  try {
    created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: catalogSkus.id })
        .from(catalogSkus)
        .where(eq(catalogSkus.catalogProductId, productId));
      const shouldDefault = data.isDefault ?? existing.length === 0;
      if (shouldDefault && existing.length > 0) {
        await tx
          .update(catalogSkus)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(catalogSkus.catalogProductId, productId));
      }
      const [row] = await tx
        .insert(catalogSkus)
        .values({
          catalogProductId: productId,
          specName: data.specName,
          barcode: data.barcode ?? null,
          unit: data.unit,
          defaultPrice: data.defaultPrice.toFixed(2),
          stockType: data.stockType ?? 'tracked',
          quantityMode: data.quantityMode ?? inferQuantityMode(data.unit),
          isDefault: shouldDefault,
          status: data.status ?? 'active',
          sortOrder: data.sortOrder ?? 0
        })
        .returning({ id: catalogSkus.id });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SKU_SPEC_DUPLICATED', message: '该商品下已有同名规格' }, 409);
    }
    throw error;
  }

  let createdSkus = 0;
  if (product.status === 'published' && data.status !== 'disabled') {
    const result = await fanOutNewCatalogSku(db, created.id, data.isDefault ?? false);
    createdSkus = result.createdSkus;
  }

  return c.json({ item: created, createdShopSkus: createdSkus }, 201);
});

catalogRoutes.patch('/catalog/skus/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const parsed = updateCatalogSkuSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({
      id: catalogSkus.id,
      catalogProductId: catalogSkus.catalogProductId,
      isDefault: catalogSkus.isDefault,
      status: catalogSkus.status,
      quantityMode: catalogSkus.quantityMode,
      productStatus: catalogProducts.status
    })
    .from(catalogSkus)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
    .where(eq(catalogSkus.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '规格不存在' }, 404);
  if (current.productStatus === 'archived') {
    return c.json({ code: 'CATALOG_PRODUCT_ARCHIVED', message: '已归档商品不可编辑规格' }, 409);
  }

  const data = parsed.data;
  if (data.isDefault === false && current.isDefault) {
    return c.json({ code: 'DEFAULT_SKU_REQUIRED', message: '默认规格不能直接取消，请先设置其他默认规格' }, 409);
  }
  if (data.status === 'disabled' && current.isDefault) {
    return c.json({ code: 'DEFAULT_SKU_REQUIRED', message: '默认规格不能停用，请先切换默认规格' }, 409);
  }
  if (
    data.quantityMode === 'integer' &&
    current.quantityMode === 'decimal_2' &&
    (await catalogSkuHasFractionalStock(id))
  ) {
    return c.json(
      {
        code: 'INVALID_QUANTITY_MODE',
        message: '该规格已有小数库存或在途采购，不能改为整数模式'
      },
      409
    );
  }

  const sharedChanged =
    data.specName !== undefined ||
    data.barcode !== undefined ||
    data.unit !== undefined ||
    data.stockType !== undefined ||
    data.quantityMode !== undefined;

  try {
    await db.transaction(async (tx) => {
      if (data.isDefault === true && !current.isDefault) {
        await tx
          .update(catalogSkus)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(catalogSkus.catalogProductId, current.catalogProductId));
      }
      await tx
        .update(catalogSkus)
        .set({
          ...(data.specName === undefined ? {} : { specName: data.specName }),
          ...(data.barcode === undefined ? {} : { barcode: data.barcode }),
          ...(data.unit === undefined ? {} : { unit: data.unit }),
          ...(data.defaultPrice === undefined
            ? {}
            : { defaultPrice: data.defaultPrice.toFixed(2) }),
          ...(data.stockType === undefined ? {} : { stockType: data.stockType }),
          ...(data.quantityMode === undefined ? {} : { quantityMode: data.quantityMode }),
          ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault }),
          ...(data.status === undefined ? {} : { status: data.status }),
          ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
          updatedAt: new Date()
        })
        .where(eq(catalogSkus.id, id));
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SKU_SPEC_DUPLICATED', message: '该商品下已有同名规格' }, 409);
    }
    throw error;
  }

  let updatedShopSkus = 0;
  if (sharedChanged) {
    const result = await syncCatalogSkuToShopSkus(db, id);
    updatedShopSkus = result.updatedSkus;
  }

  return c.json({ item: { id }, updatedShopSkus });
});

catalogRoutes.delete('/catalog/skus/:id', async (c) => {
  const denied = await guardPermission(c, 'catalog.write');
  if (denied) return denied;

  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: catalogSkus.id, isDefault: catalogSkus.isDefault })
    .from(catalogSkus)
    .where(eq(catalogSkus.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '规格不存在' }, 404);
  if (current.isDefault) {
    return c.json({ code: 'DEFAULT_SKU_REQUIRED', message: '默认规格不能删除' }, 409);
  }

  const [used] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productSkus)
    .where(eq(productSkus.catalogSkuId, id));
  if ((used?.count ?? 0) > 0) {
    return c.json(
      { code: 'SKU_IN_USE', message: '该规格已同步到门店，请改为停用' },
      409
    );
  }

  await db.delete(catalogSkus).where(eq(catalogSkus.id, id));
  return c.json({ ok: true });
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

const createCatalogProductSchema = z.object({
  ...catalogProductFields,
  specName: z.string().trim().min(1, '规格名称必填').max(50).optional(),
  barcode: z.string().trim().max(64).nullish(),
  quantityMode: z.enum(quantityModeEnum.enumValues).optional()
});
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

const catalogSkuFields = {
  specName: z.string().trim().min(1, '规格名称必填').max(50),
  barcode: z.string().trim().max(64).nullish(),
  unit: z.string().trim().min(1, '单位必填').max(20),
  defaultPrice: z.number().min(0, '建议价不能为负').max(99999999),
  stockType: z.enum(productStockTypeEnum.enumValues).optional(),
  quantityMode: z.enum(quantityModeEnum.enumValues).optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
};

const createCatalogSkuSchema = z.object(catalogSkuFields);

const updateCatalogSkuSchema = z
  .object({
    specName: catalogSkuFields.specName.optional(),
    barcode: catalogSkuFields.barcode,
    unit: catalogSkuFields.unit.optional(),
    defaultPrice: catalogSkuFields.defaultPrice.optional(),
    stockType: catalogSkuFields.stockType,
    quantityMode: catalogSkuFields.quantityMode,
    isDefault: catalogSkuFields.isDefault,
    status: catalogSkuFields.status,
    sortOrder: catalogSkuFields.sortOrder
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

async function catalogSkuHasFractionalStock(catalogSkuId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select 1
      from product_skus ps
      left join product_sku_stocks st on st.product_sku_id = ps.id
     where ps.catalog_sku_id = ${catalogSkuId}::uuid
       and st.quantity is not null
       and st.quantity <> trunc(st.quantity)
     limit 1
  `);
  if ((result.rowCount ?? 0) > 0) return true;

  const openPurchases = await db.execute(sql`
    select 1
      from purchase_order_items poi
      join purchase_orders po on po.id = poi.purchase_order_id
      join product_skus ps on ps.id = poi.product_sku_id
     where ps.catalog_sku_id = ${catalogSkuId}::uuid
       and po.status in ('draft', 'submitted')
       and poi.quantity <> trunc(poi.quantity)
     limit 1
  `);
  return (openPurchases.rowCount ?? 0) > 0;
}

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

  const { categoryId, defaultPrice, specName, barcode, quantityMode, ...rest } = parsed.data;
  if (categoryId && !(await catalogCategoryExists(categoryId))) {
    return c.json({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在' }, 404);
  }

  const db = await getDb();
  const stockType = rest.stockType ?? 'tracked';
  const result = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(catalogProducts)
      .values({
        ...rest,
        categoryId: categoryId ?? null,
        defaultPrice: defaultPrice.toFixed(2),
        description: rest.description ?? null,
        imageUrl: rest.imageUrl ?? null,
        stockType,
        status: 'draft'
      })
      .returning({ id: catalogProducts.id });

    const [sku] = await tx
      .insert(catalogSkus)
      .values({
        catalogProductId: product.id,
        specName: specName ?? '标准装',
        barcode: barcode ?? null,
        unit: rest.unit,
        defaultPrice: defaultPrice.toFixed(2),
        stockType,
        quantityMode: quantityMode ?? inferQuantityMode(rest.unit),
        isDefault: true,
        status: 'active',
        sortOrder: 0
      })
      .returning({ id: catalogSkus.id });

    return { productId: product.id, skuId: sku.id };
  });

  return c.json({ item: { id: result.productId, defaultSkuId: result.skuId } }, 201);
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

  let defaultSkuIdToSync: string | null = null;
  await db.transaction(async (tx) => {
    if (Object.keys(sharedUpdates).length > 0) {
      await tx
        .update(catalogProducts)
        .set({ ...sharedUpdates, updatedAt: new Date() })
        .where(eq(catalogProducts.id, id));
    }

    // 默认 SKU 是商品级单位/建议价/追踪方式的落点，保持镜像一致
    if (rest.unit !== undefined || defaultPrice !== undefined || rest.stockType !== undefined) {
      const [defaultSku] = await tx
        .select({ id: catalogSkus.id })
        .from(catalogSkus)
        .where(and(eq(catalogSkus.catalogProductId, id), eq(catalogSkus.isDefault, true)))
        .limit(1);
      if (defaultSku) {
        await tx
          .update(catalogSkus)
          .set({
            ...(rest.unit === undefined ? {} : { unit: rest.unit }),
            ...(defaultPrice === undefined ? {} : { defaultPrice: defaultPrice.toFixed(2) }),
            ...(rest.stockType === undefined ? {} : { stockType: rest.stockType }),
            updatedAt: new Date()
          })
          .where(eq(catalogSkus.id, defaultSku.id));
        defaultSkuIdToSync = defaultSku.id;
      }
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

  if (defaultSkuIdToSync) {
    await syncCatalogSkuToShopSkus(db, defaultSkuIdToSync);
  }

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

  await db
    .update(catalogProducts)
    .set({
      status: 'published',
      publishedAt: sql`coalesce(${catalogProducts.publishedAt}, now())`,
      updatedAt: new Date()
    })
    .where(inArray(catalogProducts.id, ids));

  // 幂等铺货：只补缺，不覆盖门店已改的价格/上下架/排序；SKU 与 0 库存行一并补齐
  const attached = await fanOutCatalogProductsToAllShops(db, ids);

  return c.json({
    ok: true,
    published: ids.length,
    attachedShops: attached.attachedShops,
    attachedProducts: attached.attachedRows,
    attachedSkus: attached.createdSkus
  });
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

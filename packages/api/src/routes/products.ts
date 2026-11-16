import { Hono, type Context } from 'hono';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  categories,
  catalogCategories,
  catalogProducts,
  catalogSkus,
  getDb,
  productSkuStocks,
  productSkus,
  products,
  productStockTypeEnum,
  purchaseOrderItems,
  quantityModeEnum,
  shops,
  stockMovements
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';
import { resolveCategoryScope } from '../lib/category-scope';
import { inferQuantityMode } from '../lib/quantity';

/**
 * 平台侧商品管理，对应 PRD 5.4 categories / 5.5 products。
 * PRD 未定义 SKU，商品按单规格维护；分类沿用 products.read / products.write 权限码。
 */
export const productRoutes = new Hono<AdminEnv>();

productRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 门店分类已切到总部共享树：筛选参数可能是 catalog_categories.id，同样按两级展开 */
async function resolveCatalogCategoryScope(categoryId: string, includeDescendants: boolean) {
  const db = await getDb();
  const [root] = await db
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.id, categoryId))
    .limit(1);
  if (!root) return [];
  if (!includeDescendants) return [categoryId];
  const children = await db
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(eq(catalogCategories.parentId, categoryId));
  return [categoryId, ...children.map((row) => row.id)];
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function isForeignKeyViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
}

/**
 * P5 起门店分类写接口下线：分类改为总部共享树，门店只能隐藏（shop_hidden_categories）。
 * 保留 410 响应方便旧前端/调用方得到明确提示，遗留实现由 P6 清理。
 */
function categoryWriteDisabled(c: Context<AdminEnv>) {
  return c.json(
    {
      code: 'CATEGORY_WRITE_DISABLED',
      message: '门店分类已改为总部共享分类，门店只能在「商品管理 → 分类」中隐藏/显示分类'
    },
    410
  );
}

async function shopExists(shopId: string) {
  const [row] = await (await getDb())
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------- 分类

const categoryFields = {
  shopId: z.uuid('店铺 ID 不合法'),
  name: z.string().trim().min(1, '分类名称必填').max(50),
  parentId: z.uuid('父分类 ID 不合法').nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  iconUrl: z.string().url('图标需为合法 URL').nullish(),
  isActive: z.boolean().optional()
};

const createCategorySchema = z.object(categoryFields);
const updateCategorySchema = z
  .object({
    name: categoryFields.name.optional(),
    sortOrder: categoryFields.sortOrder,
    iconUrl: categoryFields.iconUrl,
    isActive: categoryFields.isActive,
    // nullable 与 optional 分开，才能区分「不改父级」和「提为顶级」
    parentId: z.uuid('父分类 ID 不合法').nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const reorderCategorySchema = z
  .object({
    shopId: z.uuid('店铺 ID 不合法'),
    parentId: z.uuid('父分类 ID 不合法').nullable(),
    ids: z.array(z.uuid('分类 ID 不合法')).min(1, '至少需要一个排序项')
  })
  .refine((value) => new Set(value.ids).size === value.ids.length, '排序项不能重复');

productRoutes.get('/categories', async (c) => {
  const denied = await guardPermission(c, 'products.read');
  if (denied) return denied;

  const db = await getDb();
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const isActive = c.req.query('isActive')?.trim() ?? '';

  const filters = [];
  if (shopId) filters.push(eq(categories.shopId, shopId));
  if (keyword) filters.push(ilike(categories.name, `%${keyword}%`));
  if (isActive === 'true' || isActive === 'false') {
    filters.push(eq(categories.isActive, isActive === 'true'));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: categories.id,
      shopId: categories.shopId,
      parentId: categories.parentId,
      level: categories.level,
      name: categories.name,
      sortOrder: categories.sortOrder,
      iconUrl: categories.iconUrl,
      isActive: categories.isActive,
      createdAt: categories.createdAt,
      // 单表查询下需显式限定表名，避免子查询里解析成 products.id
      productCount: sql<number>`(
        select count(*) from products p where p.category_id = "categories"."id"
      )::int`,
      childCount: sql<number>`(
        select count(*) from categories ch where ch.parent_id = "categories"."id"
      )::int`,
      // 含后代口径：自身 + 直接子分类下的商品
      totalProductCount: sql<number>`(
        select count(*) from products p
          join categories pc on pc.id = p.category_id
         where pc.id = "categories"."id" or pc.parent_id = "categories"."id"
      )::int`
    })
    .from(categories)
    .where(where)
    .orderBy(
      asc(categories.level),
      asc(categories.sortOrder),
      asc(categories.createdAt)
    );

  return c.json({ items: rows });
});

// P5：门店分类写接口下线（分类改为总部共享树，门店只能隐藏/显示）。
// 这些中间件注册在真实实现之前，先命中直接返回 410；遗留实现由 P6 清理。
productRoutes.post('/categories', async (c) => categoryWriteDisabled(c));
productRoutes.patch('/categories/reorder', async (c) => categoryWriteDisabled(c));
productRoutes.patch('/categories/:id/products', async (c) => categoryWriteDisabled(c));
productRoutes.patch('/categories/:id', async (c) => categoryWriteDisabled(c));
productRoutes.delete('/categories/:id', async (c) => categoryWriteDisabled(c));

productRoutes.post('/categories', async (c) => {
    const parsed = createCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { shopId, name, sortOrder, iconUrl, isActive } = parsed.data;
  const parentId = parsed.data.parentId ?? null;

  const denied = await guardPermission(c, 'products.write', { shopId });
  if (denied) return denied;

  if (!(await shopExists(shopId))) {
    return c.json({ code: 'SHOP_NOT_FOUND', message: '店铺不存在' }, 404);
  }

  const db = await getDb();
  if (parentId) {
    const [parent] = await db
      .select({ id: categories.id, shopId: categories.shopId, level: categories.level })
      .from(categories)
      .where(eq(categories.id, parentId))
      .limit(1);

    if (!parent) {
      return c.json({ code: 'CATEGORY_NOT_FOUND', message: '父分类不存在' }, 404);
    }
    if (parent.shopId !== shopId) {
      return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '父分类不属于该店铺' }, 400);
    }
    if (parent.level !== 1) {
      return c.json({ code: 'CATEGORY_DEPTH_EXCEEDED', message: '分类最多两级，请选择一级分类作为父级' }, 409);
    }
  }

  try {
    const row = await db.transaction(async (tx) => {
      // 未指定顺序时追加到同级末尾
      let nextSortOrder = sortOrder;
      if (nextSortOrder === undefined) {
        const [maxRow] = await tx
          .select({ value: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` })
          .from(categories)
          .where(
            and(
              eq(categories.shopId, shopId),
              parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId)
            )
          );
        nextSortOrder = (maxRow?.value ?? -1) + 1;
      }

      const [inserted] = await tx
        .insert(categories)
        .values({
          shopId,
          parentId,
          level: parentId ? 2 : 1,
          name,
          sortOrder: nextSortOrder,
          iconUrl: iconUrl ?? null,
          isActive: isActive ?? true
        })
        .returning({ id: categories.id });
      return inserted;
    });

    return c.json({ item: row }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'CATEGORY_EXISTS', message: '同一父级下已有同名分类' }, 409);
    }
    if (isForeignKeyViolation(error)) {
      return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '父分类不属于该店铺' }, 400);
    }
    throw error;
  }
});

// 排序需先于 /:id 注册，否则会被动态段吃掉
productRoutes.patch('/categories/reorder', async (c) => {
    const parsed = reorderCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { shopId, parentId, ids } = parsed.data;
  const denied = await guardPermission(c, 'products.write', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const rows = await db
    .select({ id: categories.id, shopId: categories.shopId, parentId: categories.parentId })
    .from(categories)
    .where(inArray(categories.id, ids));

  if (rows.length !== ids.length || rows.some((row) => row.shopId !== shopId)) {
    return c.json({ code: 'CATEGORY_NOT_FOUND', message: '存在不属于该店铺的分类' }, 404);
  }
  if (rows.some((row) => (row.parentId ?? null) !== parentId)) {
    return c.json({ code: 'CATEGORY_SIBLING_MISMATCH', message: '排序项必须属于同一父级' }, 400);
  }

  await db.transaction(async (tx) => {
    // 锁住同级行，避免并发排序交叉覆盖
    await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.shopId, shopId),
          parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId)
        )
      )
      .for('update');

    for (let index = 0; index < ids.length; index += 1) {
      await tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, ids[index]));
    }
  });

  return c.json({ ok: true });
});

const migrateCategoryProductsSchema = z.object({
  targetCategoryId: z.uuid('目标分类 ID 不合法').nullable()
});

// 把某个分类的直属商品整体迁移到另一个分类（新建子分类后「迁移商品」用）
productRoutes.patch('/categories/:id/products', async (c) => {
    const parsed = migrateCategoryProductsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const [source] = await db
    .select({ id: categories.id, shopId: categories.shopId })
    .from(categories)
    .where(eq(categories.id, c.req.param('id')))
    .limit(1);

  if (!source) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  // 带上 shopId，店铺级条件授权才能正确命中
  const denied = await guardPermission(c, 'products.write', {
    categoryId: source.id,
    shopId: source.shopId
  });
  if (denied) return denied;

  const targetCategoryId = parsed.data.targetCategoryId;
  if (targetCategoryId) {
    if (targetCategoryId === source.id) {
      return c.json({ code: 'INVALID_BODY', message: '目标分类不能是自己' }, 400);
    }
    const [target] = await db
      .select({ id: categories.id, shopId: categories.shopId })
      .from(categories)
      .where(eq(categories.id, targetCategoryId))
      .limit(1);
    if (!target) return c.json({ code: 'CATEGORY_NOT_FOUND', message: '目标分类不存在' }, 404);
    if (target.shopId !== source.shopId) {
      return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '目标分类不属于该店铺' }, 400);
    }
  }

  const moved = await db
    .update(products)
    .set({ categoryId: targetCategoryId, updatedAt: new Date() })
    .where(eq(products.categoryId, source.id))
    .returning({ id: products.id });

  return c.json({ moved: moved.length });
});

productRoutes.patch('/categories/:id', async (c) => {
    const id = c.req.param('id');

  const parsed = updateCategorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const [current] = await db
    .select({ id: categories.id, shopId: categories.shopId, parentId: categories.parentId, level: categories.level })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  // 带上 shopId，店铺级条件授权才能正确命中
  const denied = await guardPermission(c, 'products.write', { categoryId: current.id, shopId: current.shopId });
  if (denied) return denied;

  const targetParentId = parsed.data.parentId ?? null;
  const hasParentChange = Object.hasOwn(parsed.data, 'parentId') && targetParentId !== current.parentId;
  let nextSortOrder = parsed.data.sortOrder;

  if (hasParentChange) {
    if (targetParentId === current.id) {
      return c.json({ code: 'CATEGORY_PARENT_SELF', message: '不能把分类挂到自身下' }, 400);
    }

    if (targetParentId) {
      const [parent] = await db
        .select({ id: categories.id, shopId: categories.shopId, level: categories.level })
        .from(categories)
        .where(eq(categories.id, targetParentId))
        .limit(1);
      if (!parent) return c.json({ code: 'CATEGORY_NOT_FOUND', message: '父分类不存在' }, 404);
      if (parent.shopId !== current.shopId) {
        return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '父分类不属于该店铺' }, 400);
      }
      if (parent.level !== 1) {
        return c.json({ code: 'CATEGORY_DEPTH_EXCEEDED', message: '分类最多两级，请选择一级分类作为父级' }, 409);
      }
    }

    const [childRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(categories)
      .where(eq(categories.parentId, current.id));
    if ((childRow?.total ?? 0) > 0) {
      return c.json(
        { code: 'CATEGORY_HAS_CHILDREN', message: '该分类下还有子分类，不能移动到其他分类下' },
        409
      );
    }

    // 未显式指定顺序时追加到新同级末尾
    if (nextSortOrder === undefined) {
      const [maxRow] = await db
        .select({ value: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` })
        .from(categories)
        .where(
          and(
            eq(categories.shopId, current.shopId),
            targetParentId ? eq(categories.parentId, targetParentId) : isNull(categories.parentId)
          )
        );
      nextSortOrder = (maxRow?.value ?? -1) + 1;
    }
  }

  try {
    const updates = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
      ...(parsed.data.iconUrl === undefined ? {} : { iconUrl: parsed.data.iconUrl }),
      ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
      ...(hasParentChange
        ? { parentId: targetParentId, level: targetParentId ? 2 : 1, sortOrder: nextSortOrder }
        : {})
    };

    // 只传了「与当前相同的父级」时没有实际改动，直接返回，避免空 SET 报错
    if (Object.keys(updates).length === 0) {
      return c.json({ item: { id: current.id } });
    }

    const [row] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });

    if (!row) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);
    return c.json({ item: row });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'CATEGORY_EXISTS', message: '同一父级下已有同名分类' }, 409);
    }
    if (isForeignKeyViolation(error)) {
      return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '父分类不属于该店铺' }, 400);
    }
    throw error;
  }
});

productRoutes.delete('/categories/:id', async (c) => {
    const id = c.req.param('id');
  const db = await getDb();
  const [current] = await db
    .select({ id: categories.id, shopId: categories.shopId })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);

  // 带上 shopId，店铺级条件授权才能正确命中
  const denied = await guardPermission(c, 'products.write', { categoryId: current.id, shopId: current.shopId });
  if (denied) return denied;

  // 先看子分类再看商品：否则用户会被告知「先移商品」却依然删不掉
  const [childRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.parentId, current.id));
  if ((childRow?.total ?? 0) > 0) {
    return c.json(
      { code: 'CATEGORY_HAS_CHILDREN', message: '该分类下还有子分类，请先删除或移动子分类' },
      409
    );
  }

  const [used] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.categoryId, current.id));

  if ((used?.total ?? 0) > 0) {
    return c.json({ code: 'CATEGORY_IN_USE', message: '该分类下还有商品，请先移出商品' }, 409);
  }

  try {
    const [row] = await db.delete(categories).where(eq(categories.id, current.id)).returning({ id: categories.id });
    if (!row) return c.json({ code: 'NOT_FOUND', message: '分类不存在' }, 404);
    return c.json({ item: row });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ code: 'CATEGORY_HAS_CHILDREN', message: '该分类下还有子分类，请先删除或移动子分类' }, 409);
    }
    throw error;
  }
});

// ---------------------------------------------------------------- 商品

const productFields = {
  shopId: z.uuid('店铺 ID 不合法'),
  categoryId: z.uuid('分类 ID 不合法').nullish(),
  name: z.string().trim().min(1, '商品名称必填').max(100),
  description: z.string().max(1000).nullish(),
  imageUrl: z.string().url('商品图片需为合法 URL').nullish(),
  price: z.number().min(0, '售价不能为负').max(99999999).nullable(),
  unit: z.string().trim().min(1, '单位必填').max(20),
  stockType: z.enum(productStockTypeEnum.enumValues).optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
};

const createProductSchema = z.object({
  ...productFields,
  // 门店本地商品必须有价；跟随总部建议价只适用于已关联总部商品的编辑
  price: productFields.price.unwrap(),
  specName: z.string().trim().min(1, '规格名称必填').max(50).optional(),
  barcode: z.string().trim().max(64).nullish(),
  quantityMode: z.enum(quantityModeEnum.enumValues).optional()
});
const updateProductSchema = z
  .object({
    categoryId: productFields.categoryId,
    name: productFields.name.optional(),
    description: productFields.description,
    imageUrl: productFields.imageUrl,
    price: productFields.price.optional(),
    unit: productFields.unit.optional(),
    stockType: productFields.stockType,
    isAvailable: productFields.isAvailable,
    sortOrder: productFields.sortOrder
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const productSkuFields = {
  specName: z.string().trim().min(1, '规格名称必填').max(50),
  barcode: z.string().trim().max(64).nullish(),
  price: z.number().min(0, '售价不能为负').max(99999999).nullable(),
  unit: z.string().trim().min(1, '单位必填').max(20),
  stockType: z.enum(productStockTypeEnum.enumValues).optional(),
  quantityMode: z.enum(quantityModeEnum.enumValues).optional(),
  isAvailable: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
};

const createProductSkuSchema = z.object(productSkuFields);

const updateProductSkuSchema = z
  .object({
    specName: productSkuFields.specName.optional(),
    barcode: productSkuFields.barcode,
    price: productSkuFields.price.optional(),
    unit: productSkuFields.unit.optional(),
    stockType: productSkuFields.stockType,
    quantityMode: productSkuFields.quantityMode,
    isAvailable: productSkuFields.isAvailable,
    isDefault: productSkuFields.isDefault,
    sortOrder: productSkuFields.sortOrder
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

async function productSkuHasFractionalStock(skuId: string) {
  const db = await getDb();
  const [stock] = await db
    .select({ quantity: productSkuStocks.quantity })
    .from(productSkuStocks)
    .where(eq(productSkuStocks.productSkuId, skuId))
    .limit(1);
  if (stock && Number(stock.quantity) % 1 !== 0) return true;

  const result = await db.execute(sql`
    select 1
      from purchase_order_items poi
      join purchase_orders po on po.id = poi.purchase_order_id
     where poi.product_sku_id = ${skuId}::uuid
       and po.status in ('draft', 'submitted')
       and poi.quantity <> trunc(poi.quantity)
     limit 1
  `);
  return (result.rowCount ?? 0) > 0;
}

async function categoryBelongsToShop(categoryId: string, shopId: string) {
  const [row] = await (await getDb())
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.shopId, shopId)))
    .limit(1);
  return Boolean(row);
}

productRoutes.get('/products', async (c) => {
  const denied = await guardPermission(c, 'products.read');
  if (denied) return denied;

  const db = await getDb();
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const categoryId = c.req.query('categoryId')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const isAvailable = c.req.query('isAvailable')?.trim() ?? '';
  const stockType = c.req.query('stockType')?.trim() ?? '';
  // 默认按「该分类 + 全部子分类」筛选；需要精确匹配时传 includeDescendants=false
  const includeDescendants = c.req.query('includeDescendants')?.trim() !== 'false';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const filters = [];
  if (shopId) filters.push(eq(products.shopId, shopId));
  if (categoryId) {
    const shopScope = await resolveCategoryScope(db, categoryId, { includeDescendants });
    const catalogScope = await resolveCatalogCategoryScope(categoryId, includeDescendants);
    const conditions = [];
    if (shopScope.length > 0) conditions.push(inArray(products.categoryId, shopScope));
    if (catalogScope.length > 0) conditions.push(inArray(catalogProducts.categoryId, catalogScope));
    if (conditions.length > 0) filters.push(or(...conditions)!);
  }
  if (keyword) filters.push(ilike(products.name, `%${keyword}%`));
  if (isAvailable === 'true' || isAvailable === 'false') {
    filters.push(eq(products.isAvailable, isAvailable === 'true'));
  }
  if (productStockTypeEnum.enumValues.includes(stockType as (typeof productStockTypeEnum.enumValues)[number])) {
    filters.push(eq(products.stockType, stockType as (typeof productStockTypeEnum.enumValues)[number]));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: products.id,
        shopId: products.shopId,
        shopName: shops.name,
        categoryId: products.categoryId,
        categoryName: categories.name,
        name: products.name,
        description: products.description,
        imageUrl: products.imageUrl,
        price: products.price,
        unit: products.unit,
        stockType: products.stockType,
        isAvailable: products.isAvailable,
        sortOrder: products.sortOrder,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        // 多店口径：catalogProductId 非空表示共享商品，门店只保留价格/上下架/排序/库存
        catalogProductId: products.catalogProductId,
        isBlocked: products.isBlocked,
        blockedReason: products.blockedReason,
        isTest: products.isTest,
        catalogCategoryId: catalogProducts.categoryId,
        catalogCategoryName: catalogCategories.name,
        catalogPrice: catalogProducts.defaultPrice,
        // 门店级库存：库存挂在 SKU 上，这里汇总展示
        stockQuantity: sql<number>`coalesce((
          select sum(st.quantity)
            from product_sku_stocks st
            join product_skus ps on ps.id = st.product_sku_id
           where ps.product_id = "products"."id"
        ), 0)::float8`,
        skuCount: sql<number>`(
          select count(*) from product_skus ps where ps.product_id = "products"."id"
        )::int`,
        lowStockCount: sql<number>`(
          select count(*) from product_sku_stocks st
            join product_skus ps on ps.id = st.product_sku_id
           where ps.product_id = "products"."id"
             and st.quantity <= st.min_threshold
        )::int`,
        defaultSkuId: sql<string | null>`(
          select ps.id from product_skus ps
           where ps.product_id = "products"."id" and ps.is_default
           limit 1
        )`,
        // 门店价为空时按总部建议价展示
        effectivePrice: sql<string | null>`coalesce(${products.price}, ${catalogProducts.defaultPrice})`,
        priceOverridden: sql<boolean>`${products.price} is not null and ${catalogProducts.defaultPrice} is not null and ${products.price} <> ${catalogProducts.defaultPrice}`
      })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(catalogProducts, eq(catalogProducts.id, products.catalogProductId))
      .leftJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
      .where(where)
      .orderBy(asc(products.sortOrder), desc(products.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .leftJoin(catalogProducts, eq(catalogProducts.id, products.catalogProductId))
      .where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

productRoutes.post('/products', async (c) => {
  const parsed = createProductSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const { shopId, categoryId, price, specName, barcode, quantityMode, ...rest } = parsed.data;
  const denied = await guardPermission(c, 'products.write', { shopId });
  if (denied) return denied;

  if (!(await shopExists(shopId))) {
    return c.json({ code: 'SHOP_NOT_FOUND', message: '店铺不存在' }, 404);
  }
  if (categoryId && !(await categoryBelongsToShop(categoryId, shopId))) {
    return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '分类不属于该店铺' }, 400);
  }

  const db = await getDb();
  const stockType = rest.stockType ?? 'tracked';
  const result = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        ...rest,
        shopId,
        categoryId: categoryId ?? null,
        price: price.toFixed(2),
        description: rest.description ?? null,
        imageUrl: rest.imageUrl ?? null,
        stockType,
        isAvailable: rest.isAvailable ?? true,
        sortOrder: rest.sortOrder ?? 0
      })
      .returning({ id: products.id });

    const [sku] = await tx
      .insert(productSkus)
      .values({
        shopId,
        productId: product.id,
        catalogSkuId: null,
        specName: specName ?? '标准装',
        barcode: barcode ?? null,
        unit: rest.unit,
        price: price.toFixed(2),
        stockType,
        quantityMode: quantityMode ?? inferQuantityMode(rest.unit),
        isAvailable: rest.isAvailable ?? true,
        isDefault: true,
        sortOrder: 0
      })
      .returning({ id: productSkus.id });

    if (stockType === 'tracked') {
      await tx.insert(productSkuStocks).values({
        productSkuId: sku.id,
        shopId,
        quantity: '0.00',
        minThreshold: '0.00'
      });
    }

    return { productId: product.id, skuId: sku.id };
  });

  return c.json(
    { item: { id: result.productId, defaultSkuId: result.skuId } },
    201
  );
});

productRoutes.patch('/products/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const [current] = await db
    .select({
      shopId: products.shopId,
      catalogProductId: products.catalogProductId,
      isBlocked: products.isBlocked,
      blockedReason: products.blockedReason
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', { shopId: current.shopId, productId: id });
  if (denied) return denied;

  const parsed = updateProductSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  // 关联总部商品的共享字段只读，门店只能改价格/上下架/库存策略/排序
  if (current.catalogProductId) {
    const lockedFields = ['name', 'description', 'imageUrl', 'unit', 'categoryId'].filter(
      (key) => parsed.data[key as 'name' | 'description' | 'imageUrl' | 'unit' | 'categoryId'] !== undefined
    );
    if (lockedFields.length > 0) {
      return c.json(
        { code: 'FIELD_LOCKED', message: `共享字段由总部维护：${lockedFields.join('、')}` },
        403
      );
    }
  }

  const { categoryId, price, ...rest } = parsed.data;
  if (!current.catalogProductId && price === null) {
    return c.json({ code: 'PRICE_REQUIRED', message: '本地商品必须填写售价' }, 400);
  }
  if (categoryId && !(await categoryBelongsToShop(categoryId, current.shopId))) {
    return c.json({ code: 'CATEGORY_SHOP_MISMATCH', message: '分类不属于该店铺' }, 400);
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(products)
      .set({
        ...rest,
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(price === undefined ? {} : { price: price === null ? null : price.toFixed(2) }),
        updatedAt: new Date()
      })
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!updated) return null;

    const [defaultSku] = await tx
      .select({ id: productSkus.id })
      .from(productSkus)
      .where(and(eq(productSkus.productId, id), eq(productSkus.isDefault, true)))
      .limit(1);

    if (defaultSku) {
      await tx
        .update(productSkus)
        .set({
          ...(price === undefined ? {} : { price: price === null ? null : price.toFixed(2) }),
          ...(rest.unit === undefined ? {} : { unit: rest.unit }),
          ...(rest.stockType === undefined ? {} : { stockType: rest.stockType }),
          updatedAt: new Date()
        })
        .where(eq(productSkus.id, defaultSku.id));

      if (rest.stockType === 'tracked') {
        await tx
          .insert(productSkuStocks)
          .values({
            productSkuId: defaultSku.id,
            shopId: current.shopId,
            quantity: '0.00',
            minThreshold: '0.00'
          })
          .onConflictDoNothing();
      }
    }

    if (rest.isAvailable !== undefined) {
      await tx
        .update(productSkus)
        .set({ isAvailable: rest.isAvailable, updatedAt: new Date() })
        .where(eq(productSkus.productId, id));
    }

    return updated;
  });

  if (!row) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);
  return c.json({ item: row });
});

productRoutes.patch('/products/:id/availability', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const [current] = await db
    .select({
      shopId: products.shopId,
      isBlocked: products.isBlocked,
      blockedReason: products.blockedReason
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', { shopId: current.shopId, productId: id });
  if (denied) return denied;

  const body = await c.req.json<{ isAvailable?: boolean }>().catch(() => null);
  if (!body || typeof body.isAvailable !== 'boolean') {
    return c.json({ code: 'INVALID_BODY', message: 'isAvailable 需为布尔值' }, 400);
  }

  if (body.isAvailable && current.isBlocked) {
    return c.json(
      {
        code: 'PRODUCT_BLOCKED',
        message: `商品已被总部强制下架，需总部解除后才能上架${current.blockedReason ? `：${current.blockedReason}` : ''}`
      },
      409
    );
  }

  const [row] = await db
    .update(products)
    .set({ isAvailable: body.isAvailable, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning({ id: products.id, isAvailable: products.isAvailable });

  return c.json({ item: row });
});

// ---------------------------------------------------------------- 门店规格（SKU）

productRoutes.get('/products/:productId/skus', async (c) => {
  const denied = await guardPermission(c, 'products.read');
  if (denied) return denied;

  const db = await getDb();
  const productId = c.req.param('productId');
  const [product] = await db
    .select({
      id: products.id,
      shopId: products.shopId,
      name: products.name,
      catalogProductId: products.catalogProductId
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const items = await db
    .select({
      id: productSkus.id,
      productId: productSkus.productId,
      shopId: productSkus.shopId,
      catalogSkuId: productSkus.catalogSkuId,
      specName: productSkus.specName,
      barcode: productSkus.barcode,
      unit: productSkus.unit,
      price: productSkus.price,
      stockType: productSkus.stockType,
      quantityMode: productSkus.quantityMode,
      isAvailable: productSkus.isAvailable,
      isDefault: productSkus.isDefault,
      sortOrder: productSkus.sortOrder,
      createdAt: productSkus.createdAt,
      updatedAt: productSkus.updatedAt,
      catalogStatus: catalogSkus.status,
      effectivePrice: sql<string | null>`coalesce(${productSkus.price}, ${catalogSkus.defaultPrice})`,
      stockQuantity: sql<string>`coalesce(${productSkuStocks.quantity}, 0)`,
      minThreshold: sql<string>`coalesce(${productSkuStocks.minThreshold}, 0)`,
      maxThreshold: productSkuStocks.maxThreshold
    })
    .from(productSkus)
    .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
    .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id))
    .where(eq(productSkus.productId, productId))
    .orderBy(asc(productSkus.sortOrder), asc(productSkus.createdAt));

  return c.json({ product, items });
});

productRoutes.post('/products/:productId/skus', async (c) => {
  const db = await getDb();
  const productId = c.req.param('productId');
  const [product] = await db
    .select({
      id: products.id,
      shopId: products.shopId,
      catalogProductId: products.catalogProductId,
      stockType: products.stockType
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', {
    shopId: product.shopId,
    productId
  });
  if (denied) return denied;

  if (product.catalogProductId) {
    return c.json(
      {
        code: 'CATALOG_SKU_LOCKED',
        message: '共享商品规格由总部维护；门店只能调整售价与上下架'
      },
      403
    );
  }

  const parsed = createProductSkuSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const data = parsed.data;
  const priceValue = data.price;
  if (priceValue === null) {
    return c.json({ code: 'PRICE_REQUIRED', message: '本地规格必须填写售价' }, 400);
  }

  const stockType = data.stockType ?? product.stockType;
  let created: { id: string };
  try {
    created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: productSkus.id })
        .from(productSkus)
        .where(eq(productSkus.productId, productId));
      const shouldDefault = data.isDefault ?? existing.length === 0;
      if (shouldDefault && existing.length > 0) {
        await tx
          .update(productSkus)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(productSkus.productId, productId));
      }

      const [sku] = await tx
        .insert(productSkus)
        .values({
          shopId: product.shopId,
          productId,
          catalogSkuId: null,
          specName: data.specName,
          barcode: data.barcode ?? null,
          unit: data.unit,
          price: priceValue.toFixed(2),
          stockType,
          quantityMode: data.quantityMode ?? inferQuantityMode(data.unit),
          isAvailable: data.isAvailable ?? true,
          isDefault: shouldDefault,
          sortOrder: data.sortOrder ?? 0
        })
        .returning({ id: productSkus.id });

      if (stockType === 'tracked') {
        await tx.insert(productSkuStocks).values({
          productSkuId: sku.id,
          shopId: product.shopId,
          quantity: '0.00',
          minThreshold: '0.00'
        });
      }
      return sku;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SKU_SPEC_DUPLICATED', message: '该商品下已有同名规格' }, 409);
    }
    throw error;
  }

  return c.json({ item: created }, 201);
});

productRoutes.patch('/product-skus/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({
      id: productSkus.id,
      shopId: productSkus.shopId,
      productId: productSkus.productId,
      catalogSkuId: productSkus.catalogSkuId,
      isDefault: productSkus.isDefault,
      quantityMode: productSkus.quantityMode,
      stockType: productSkus.stockType,
      productCatalogId: products.catalogProductId
    })
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .where(eq(productSkus.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '规格不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', {
    shopId: current.shopId,
    productId: current.productId
  });
  if (denied) return denied;

  const parsed = updateProductSkuSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const data = parsed.data;

  if (current.catalogSkuId) {
    const locked = ['specName', 'barcode', 'unit', 'stockType', 'quantityMode'].filter(
      (key) => data[key as 'specName'] !== undefined
    );
    if (locked.length > 0) {
      return c.json(
        { code: 'FIELD_LOCKED', message: `共享规格字段由总部维护：${locked.join('、')}` },
        403
      );
    }
  }
  if (!current.catalogSkuId && data.price === null) {
    return c.json({ code: 'PRICE_REQUIRED', message: '本地规格必须填写售价' }, 400);
  }
  if (data.isDefault === false && current.isDefault) {
    return c.json({ code: 'DEFAULT_SKU_REQUIRED', message: '默认规格不能直接取消，请先设置其他默认规格' }, 409);
  }
  if (
    data.quantityMode === 'integer' &&
    current.quantityMode === 'decimal_2' &&
    (await productSkuHasFractionalStock(id))
  ) {
    return c.json(
      {
        code: 'INVALID_QUANTITY_MODE',
        message: '该规格已有小数库存或在途采购，不能改为整数模式'
      },
      409
    );
  }

  const stockType = data.stockType ?? current.stockType;
  try {
    await db.transaction(async (tx) => {
      if (data.isDefault === true && !current.isDefault) {
        await tx
          .update(productSkus)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(productSkus.productId, current.productId));
      }
      await tx
        .update(productSkus)
        .set({
          ...(data.specName === undefined ? {} : { specName: data.specName }),
          ...(data.barcode === undefined ? {} : { barcode: data.barcode }),
          ...(data.price === undefined
            ? {}
            : { price: data.price === null ? null : data.price.toFixed(2) }),
          ...(data.unit === undefined ? {} : { unit: data.unit }),
          ...(data.stockType === undefined ? {} : { stockType: data.stockType }),
          ...(data.quantityMode === undefined ? {} : { quantityMode: data.quantityMode }),
          ...(data.isAvailable === undefined ? {} : { isAvailable: data.isAvailable }),
          ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault }),
          ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
          updatedAt: new Date()
        })
        .where(eq(productSkus.id, id));

      if (stockType === 'tracked') {
        await tx
          .insert(productSkuStocks)
          .values({
            productSkuId: id,
            shopId: current.shopId,
            quantity: '0.00',
            minThreshold: '0.00'
          })
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SKU_SPEC_DUPLICATED', message: '该商品下已有同名规格' }, 409);
    }
    throw error;
  }

  return c.json({ item: { id } });
});

productRoutes.delete('/product-skus/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({
      id: productSkus.id,
      shopId: productSkus.shopId,
      productId: productSkus.productId,
      catalogSkuId: productSkus.catalogSkuId,
      isDefault: productSkus.isDefault
    })
    .from(productSkus)
    .where(eq(productSkus.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '规格不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', {
    shopId: current.shopId,
    productId: current.productId
  });
  if (denied) return denied;

  if (current.catalogSkuId) {
    return c.json({ code: 'CATALOG_SKU_LOCKED', message: '共享规格不能删除，只能停用' }, 403);
  }
  if (current.isDefault) {
    return c.json({ code: 'DEFAULT_SKU_REQUIRED', message: '默认规格不能删除' }, 409);
  }

  const [stock] = await db
    .select({ quantity: productSkuStocks.quantity })
    .from(productSkuStocks)
    .where(eq(productSkuStocks.productSkuId, id))
    .limit(1);
  if (stock && Number(stock.quantity) > 0) {
    return c.json(
      { code: 'SKU_HAS_STOCK_HISTORY', message: '该规格仍有库存，请先调拨或报损为 0' },
      409
    );
  }

  const [movement] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(eq(stockMovements.productSkuId, id));
  const [purchase] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.productSkuId, id));
  if ((movement?.count ?? 0) > 0 || (purchase?.count ?? 0) > 0) {
    return c.json(
      { code: 'SKU_HAS_STOCK_HISTORY', message: '该规格已有库存流水或采购记录，不能删除' },
      409
    );
  }

  await db.delete(productSkus).where(eq(productSkus.id, id));
  return c.json({ ok: true });
});

/** 旧直改库存接口下线：库存只能通过 SKU 台账（调整/采购入库）变更 */
productRoutes.patch('/products/:id/stock', async (c) => {
  const id = c.req.param('id');
  const [current] = await (await getDb())
    .select({ shopId: products.shopId })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', { shopId: current.shopId, productId: id });
  if (denied) return denied;

  return c.json(
    {
      code: 'DIRECT_STOCK_DISABLED',
      message: '库存已改为 SKU 台账，请在「库存管理」中调整，或通过采购入库'
    },
    410
  );
});

productRoutes.delete('/products/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const [current] = await db
    .select({ shopId: products.shopId, catalogProductId: products.catalogProductId })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!current) return c.json({ code: 'NOT_FOUND', message: '商品不存在' }, 404);

  const denied = await guardPermission(c, 'products.write', { shopId: current.shopId, productId: id });
  if (denied) return denied;

  if (current.catalogProductId) {
    return c.json(
      { code: 'CATALOG_PRODUCT_LOCKED', message: '总部商品不可在门店删除，请使用下架' },
      403
    );
  }

  try {
    const [row] = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    return c.json({ item: row });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json(
        { code: 'SKU_HAS_STOCK_HISTORY', message: '商品规格已有库存流水，不能删除，请改为下架' },
        409
      );
    }
    throw error;
  }
});

import { Hono } from 'hono';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql
} from 'drizzle-orm';
import { z } from 'zod';
import {
  adminUsers,
  catalogSkus,
  getDb,
  productSkuStocks,
  productSkus,
  products,
  stockMovementTypeEnum,
  stockMovements
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';
import {
  normalizeQuantity,
  normalizeSignedQuantity,
  quantityNumber
} from '../lib/quantity';

/** 平台运营侧库存：SKU 余额 + 台账 + 手工调整 + 阈值 */
export const inventoryRoutes = new Hono<AdminEnv>();

inventoryRoutes.use('*', requireAdmin);

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

class InventoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 404 | 409 = 409
  ) {
    super(message);
  }
}

const inventorySelect = {
  skuId: productSkus.id,
  productId: productSkus.productId,
  shopId: productSkus.shopId,
  productName: products.name,
  imageUrl: products.imageUrl,
  specName: productSkus.specName,
  barcode: productSkus.barcode,
  unit: productSkus.unit,
  stockType: productSkus.stockType,
  quantityMode: productSkus.quantityMode,
  isAvailable: productSkus.isAvailable,
  isDefault: productSkus.isDefault,
  catalogSkuId: productSkus.catalogSkuId,
  catalogStatus: catalogSkus.status,
  price: productSkus.price,
  catalogPrice: catalogSkus.defaultPrice,
  effectivePrice: sql<string | null>`coalesce(${productSkus.price}, ${catalogSkus.defaultPrice}, ${products.price})`,
  quantity: sql<string>`coalesce(${productSkuStocks.quantity}, 0)`,
  minThreshold: sql<string>`coalesce(${productSkuStocks.minThreshold}, 0)`,
  maxThreshold: productSkuStocks.maxThreshold,
  stockUpdatedAt: productSkuStocks.updatedAt,
  lowStock: sql<boolean>`${productSkus.stockType} = 'tracked'
    and coalesce(${productSkuStocks.quantity}, 0) <= coalesce(${productSkuStocks.minThreshold}, 0)`
};

const inventoryJoins = (db: Awaited<ReturnType<typeof getDb>>) =>
  db
    .select(inventorySelect)
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
    .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id));

async function movementQuery(
  shopId: string,
  filters: {
    skuId?: string;
    movementType?: string;
    referenceType?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
    offset: number;
  }
) {
  const db = await getDb();
  const conditions = [eq(stockMovements.shopId, shopId)];
  if (filters.skuId) conditions.push(eq(stockMovements.productSkuId, filters.skuId));
  if (
    filters.movementType &&
    stockMovementTypeEnum.enumValues.includes(
      filters.movementType as (typeof stockMovementTypeEnum.enumValues)[number]
    )
  ) {
    conditions.push(
      eq(
        stockMovements.movementType,
        filters.movementType as (typeof stockMovementTypeEnum.enumValues)[number]
      )
    );
  }
  if (filters.referenceType) {
    conditions.push(eq(stockMovements.referenceType, filters.referenceType));
  }
  if (filters.from) conditions.push(gte(stockMovements.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(stockMovements.createdAt, new Date(filters.to)));
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: stockMovements.id,
        shopId: stockMovements.shopId,
        productSkuId: stockMovements.productSkuId,
        productId: productSkus.productId,
        productName: products.name,
        specName: productSkus.specName,
        unit: productSkus.unit,
        movementType: stockMovements.movementType,
        quantityChange: stockMovements.quantityChange,
        balanceAfter: stockMovements.balanceAfter,
        unitCost: stockMovements.unitCost,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        operatorAdminId: stockMovements.operatorAdminId,
        operatorName: adminUsers.displayName,
        operatorUserId: stockMovements.operatorUserId,
        remark: stockMovements.remark,
        createdAt: stockMovements.createdAt
      })
      .from(stockMovements)
      .leftJoin(productSkus, eq(productSkus.id, stockMovements.productSkuId))
      .leftJoin(products, eq(products.id, productSkus.productId))
      .leftJoin(adminUsers, eq(adminUsers.id, stockMovements.operatorAdminId))
      .where(where)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(filters.pageSize)
      .offset(filters.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(stockMovements)
      .where(where)
  ]);

  return { items, total: totalRows[0]?.total ?? 0, page: filters.page, pageSize: filters.pageSize };
}

inventoryRoutes.get('/inventory', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'inventory.read', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const stockType = c.req.query('stockType')?.trim() ?? '';
  const quantityMode = c.req.query('quantityMode')?.trim() ?? '';
  const lowStock = c.req.query('lowStock')?.trim() === 'true';
  const unavailable = c.req.query('unavailable')?.trim() === 'true';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [eq(productSkus.shopId, shopId), eq(products.shopId, shopId)];
  if (keyword) {
    conditions.push(
      or(
        ilike(products.name, `%${keyword}%`),
        ilike(productSkus.specName, `%${keyword}%`),
        ilike(productSkus.barcode, `%${keyword}%`)
      )!
    );
  }
  if (stockType === 'tracked' || stockType === 'untracked') {
    conditions.push(eq(productSkus.stockType, stockType));
  }
  if (quantityMode === 'integer' || quantityMode === 'decimal_2') {
    conditions.push(eq(productSkus.quantityMode, quantityMode));
  }
  if (lowStock) {
    conditions.push(
      sql`${productSkus.stockType} = 'tracked'
        and coalesce(${productSkuStocks.quantity}, 0) <= coalesce(${productSkuStocks.minThreshold}, 0)`
    );
  }
  if (unavailable) conditions.push(eq(productSkus.isAvailable, false));

  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    inventoryJoins(db)
      .where(where)
      .orderBy(asc(products.name), asc(productSkus.sortOrder), asc(productSkus.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(productSkus)
      .innerJoin(products, eq(products.id, productSkus.productId))
      .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id))
      .where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

inventoryRoutes.get('/inventory/alerts', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'inventory.read', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
  const items = await inventoryJoins(db)
    .where(
      and(
        eq(productSkus.shopId, shopId),
        eq(products.shopId, shopId),
        eq(productSkus.stockType, 'tracked'),
        sql`coalesce(${productSkuStocks.quantity}, 0) <= coalesce(${productSkuStocks.minThreshold}, 0)`
      )
    )
    .orderBy(
      asc(sql`coalesce(${productSkuStocks.quantity}, 0) - coalesce(${productSkuStocks.minThreshold}, 0)`),
      asc(products.name)
    )
    .limit(limit);

  return c.json({ items });
});

inventoryRoutes.get('/inventory/skus/:skuId', async (c) => {
  const db = await getDb();
  const skuId = c.req.param('skuId');
  const [item] = await inventoryJoins(db).where(eq(productSkus.id, skuId)).limit(1);
  if (!item) return c.json({ code: 'NOT_FOUND', message: 'SKU 不存在' }, 404);

  const denied = await guardPermission(c, 'inventory.read', { shopId: item.shopId, productId: item.productId });
  if (denied) return denied;

  return c.json({ item });
});

inventoryRoutes.get('/inventory/skus/:skuId/movements', async (c) => {
  const db = await getDb();
  const skuId = c.req.param('skuId');
  const [sku] = await db
    .select({ id: productSkus.id, shopId: productSkus.shopId })
    .from(productSkus)
    .where(eq(productSkus.id, skuId))
    .limit(1);
  if (!sku) return c.json({ code: 'NOT_FOUND', message: 'SKU 不存在' }, 404);

  const denied = await guardPermission(c, 'inventory.read', { shopId: sku.shopId });
  if (denied) return denied;

  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });
  const result = await movementQuery(sku.shopId, {
    skuId,
    movementType: c.req.query('movementType'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    page,
    pageSize,
    offset
  });
  return c.json(result);
});

inventoryRoutes.get('/inventory/movements', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'inventory.read', { shopId });
  if (denied) return denied;

  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });
  const result = await movementQuery(shopId, {
    skuId: c.req.query('skuId')?.trim() || undefined,
    movementType: c.req.query('movementType')?.trim() || undefined,
    referenceType: c.req.query('referenceType')?.trim() || undefined,
    from: c.req.query('from'),
    to: c.req.query('to'),
    page,
    pageSize,
    offset
  });
  return c.json(result);
});

const adjustmentSchema = z.object({
  shopId: z.uuid('店铺 ID 不合法'),
  operationId: z.uuid('operationId 需为 UUID'),
  items: z
    .array(
      z.object({
        skuId: z.uuid('SKU ID 不合法'),
        mode: z.enum(['delta', 'target']).default('delta'),
        quantity: z.union([z.string(), z.number()]),
        reason: z.enum(['manual', 'waste', 'damage', 'expired', 'other']).optional(),
        remark: z.string().trim().max(200).nullish()
      })
    )
    .min(1, '至少一个调整项')
    .max(100)
});

inventoryRoutes.post('/inventory/adjustments', async (c) => {
  const parsed = adjustmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const { shopId, operationId, items } = parsed.data;
  const denied = await guardPermission(c, 'inventory.write', { shopId });
  if (denied) return denied;

  const uniqueSkuIds = [...new Set(items.map((item) => item.skuId))];
  if (uniqueSkuIds.length !== items.length) {
    return c.json({ code: 'DUPLICATE_SKU', message: '同一 SKU 只能提交一次，请合并调整' }, 400);
  }

  const db = await getDb();
  const skuRows = await db
    .select({
      id: productSkus.id,
      shopId: productSkus.shopId,
      quantityMode: productSkus.quantityMode,
      stockType: productSkus.stockType
    })
    .from(productSkus)
    .where(and(eq(productSkus.shopId, shopId), inArray(productSkus.id, uniqueSkuIds)));

  if (skuRows.length !== uniqueSkuIds.length) {
    return c.json({ code: 'SKU_NOT_IN_SHOP', message: '存在不属于该门店的 SKU' }, 404);
  }
  const skuMap = new Map(skuRows.map((row) => [row.id, row]));
  for (const item of items) {
    const sku = skuMap.get(item.skuId)!;
    if (sku.stockType === 'untracked') {
      return c.json(
        { code: 'STOCK_NOT_TRACKED', message: `SKU ${item.skuId} 未开启库存追踪` },
        409
      );
    }
  }

  const admin = c.get('admin');
  const operatorAdminId = admin?.sub ?? null;
  const sorted = [...items].sort((a, b) => a.skuId.localeCompare(b.skuId));

  try {
    const results = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.shopId, shopId),
            eq(stockMovements.referenceType, 'manual'),
            eq(stockMovements.referenceId, operationId)
          )
        )
        .limit(1);
      if (existing) {
        throw new InventoryError('DUPLICATE_OPERATION', '该操作已执行，请勿重复提交', 409);
      }

      const applied: {
        skuId: string;
        before: string;
        after: string;
        delta: string;
      }[] = [];

      for (const item of sorted) {
        const sku = skuMap.get(item.skuId)!;
        const [stock] = await tx
          .select({ quantity: productSkuStocks.quantity })
          .from(productSkuStocks)
          .where(eq(productSkuStocks.productSkuId, item.skuId))
          .for('update');
        if (!stock) {
          throw new InventoryError(
            'STOCK_ROW_MISSING',
            'SKU 缺少库存行，请先同步商品规格',
            409
          );
        }

        const beforeCents = Math.round(quantityNumber(stock.quantity) * 100);
        let deltaCents = 0;
        let afterCents = beforeCents;

        if (item.mode === 'target') {
          const target = normalizeQuantity(item.quantity, sku.quantityMode);
          if (target === null) {
            throw new InventoryError(
              'INVALID_QUANTITY_PRECISION',
              '目标库存不符合该 SKU 的数量模式',
              400
            );
          }
          afterCents = Math.round(Number(target) * 100);
          deltaCents = afterCents - beforeCents;
        } else {
          const delta = normalizeSignedQuantity(item.quantity, sku.quantityMode);
          if (delta === null) {
            throw new InventoryError(
              'INVALID_QUANTITY_PRECISION',
              '调整数量不符合该 SKU 的数量模式',
              400
            );
          }
          deltaCents = Math.round(Number(delta) * 100);
          afterCents = beforeCents + deltaCents;
        }

        if (afterCents < 0) {
          throw new InventoryError('STOCK_INSUFFICIENT', '调整后库存不能为负', 409);
        }
        if (deltaCents === 0) continue;

        const after = (afterCents / 100).toFixed(2);
        const delta = (deltaCents / 100).toFixed(2);
        await tx
          .update(productSkuStocks)
          .set({ quantity: after, updatedAt: new Date() })
          .where(eq(productSkuStocks.productSkuId, item.skuId));
        await tx.insert(stockMovements).values({
          shopId,
          productSkuId: item.skuId,
          movementType:
            item.reason === 'waste' ||
            item.reason === 'damage' ||
            item.reason === 'expired'
              ? 'waste'
              : 'adjustment',
          quantityChange: delta,
          balanceAfter: after,
          unitCost: null,
          referenceType: 'manual',
          referenceId: operationId,
          operatorAdminId,
          remark: item.remark ?? null
        });

        applied.push({
          skuId: item.skuId,
          before: (beforeCents / 100).toFixed(2),
          after,
          delta
        });
      }

      return applied;
    });

    return c.json({ ok: true, operationId, items: results, unchanged: results.length === 0 });
  } catch (error) {
    if (error instanceof InventoryError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (isUniqueViolation(error)) {
      return c.json({ code: 'DUPLICATE_OPERATION', message: '该操作已执行，请勿重复提交' }, 409);
    }
    throw error;
  }
});

const thresholdSchema = z.object({
  minThreshold: z.union([z.string(), z.number()]),
  maxThreshold: z.union([z.string(), z.number()]).nullish()
});

inventoryRoutes.patch('/inventory/skus/:skuId/threshold', async (c) => {
  const db = await getDb();
  const skuId = c.req.param('skuId');
  const [sku] = await db
    .select({
      id: productSkus.id,
      shopId: productSkus.shopId,
      productId: productSkus.productId,
      stockType: productSkus.stockType,
      quantityMode: productSkus.quantityMode
    })
    .from(productSkus)
    .where(eq(productSkus.id, skuId))
    .limit(1);
  if (!sku) return c.json({ code: 'NOT_FOUND', message: 'SKU 不存在' }, 404);

  const denied = await guardPermission(c, 'inventory.write', {
    shopId: sku.shopId,
    productId: sku.productId
  });
  if (denied) return denied;

  if (sku.stockType === 'untracked') {
    return c.json({ code: 'STOCK_NOT_TRACKED', message: '该 SKU 未开启库存追踪' }, 409);
  }

  const parsed = thresholdSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const min = normalizeQuantity(parsed.data.minThreshold, sku.quantityMode);
  if (min === null) {
    return c.json(
      { code: 'INVALID_QUANTITY_PRECISION', message: '最低库存不符合该 SKU 的数量模式' },
      400
    );
  }
  let max: string | null = null;
  if (parsed.data.maxThreshold !== null && parsed.data.maxThreshold !== undefined) {
    max = normalizeQuantity(parsed.data.maxThreshold, sku.quantityMode);
    if (max === null) {
      return c.json(
        { code: 'INVALID_QUANTITY_PRECISION', message: '最高库存不符合该 SKU 的数量模式' },
        400
      );
    }
  }
  if (max !== null && Number(max) < Number(min)) {
    return c.json({ code: 'INVALID_THRESHOLD', message: '最高库存不能小于最低库存' }, 400);
  }

  await db
    .insert(productSkuStocks)
    .values({
      productSkuId: skuId,
      shopId: sku.shopId,
      quantity: '0.00',
      minThreshold: min,
      maxThreshold: max
    })
    .onConflictDoUpdate({
      target: productSkuStocks.productSkuId,
      set: { minThreshold: min, maxThreshold: max, updatedAt: new Date() }
    });

  return c.json({ ok: true, skuId, minThreshold: min, maxThreshold: max });
});

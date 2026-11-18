import { Hono } from 'hono';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminUserWarehouses,
  catalogProducts,
  catalogSkus,
  getDb,
  warehouseStocks,
  warehouses
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { isSuperAdmin } from '../lib/shop-scope.js';
import { recordDocumentEvent } from '../lib/documents.js';
import { normalizeQuantity } from '../lib/quantity.js';

/**
 * 仓库库存视图与安全库存预警。
 * 口径：仓库只看「可用量 = quantity - reserved_qty」，可用量 <= 下限即预警；
 * 门店库存预警仍按 product_sku_stocks.quantity 判断，两套逻辑互不影响。
 * 权限：读取 warehouse.read，改阈值 warehouse.write，均叠加仓库可见范围（super_admin 不受限）。
 */
export const warehouseStockRoutes = new Hono<AdminEnv>();

warehouseStockRoutes.use('*', requireAdmin);

/** 阈值变更审计：复用 document_events（document_id 为仓库 ID，payload 记录规格与前后值） */
const THRESHOLD_DOCUMENT_TYPE = 'warehouse_stock_threshold';

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** 非 super_admin 的仓库可见范围；super_admin 返回 null 表示不限制 */
async function accessibleWarehouseIds(adminId: string): Promise<string[] | null> {
  if (await isSuperAdmin(adminId)) return null;
  const db = await getDb();
  const rows = await db
    .select({ warehouseId: adminUserWarehouses.warehouseId })
    .from(adminUserWarehouses)
    .where(eq(adminUserWarehouses.adminUserId, adminId));
  return rows.map((row) => row.warehouseId);
}

async function canAccessWarehouse(adminId: string, warehouseId: string) {
  const ids = await accessibleWarehouseIds(adminId);
  return ids === null || ids.includes(warehouseId);
}

/** 可用量 = 库存 - 预留；与门店 quantity 口径区分开 */
const availableExpr = sql<string>`${warehouseStocks.quantity} - ${warehouseStocks.reservedQty}`;

const stockSelect = {
  warehouseId: warehouseStocks.warehouseId,
  warehouseCode: warehouses.code,
  warehouseName: warehouses.name,
  catalogSkuId: warehouseStocks.skuId,
  catalogProductId: catalogSkus.catalogProductId,
  productName: catalogProducts.name,
  specName: catalogSkus.specName,
  unit: catalogSkus.unit,
  quantityMode: catalogSkus.quantityMode,
  stockType: catalogSkus.stockType,
  quantity: warehouseStocks.quantity,
  reservedQty: warehouseStocks.reservedQty,
  availableQuantity: availableExpr,
  avgUnitCost: warehouseStocks.avgUnitCost,
  minThreshold: warehouseStocks.minThreshold,
  maxThreshold: warehouseStocks.maxThreshold,
  lowStock: sql<boolean>`${availableExpr} <= ${warehouseStocks.minThreshold}`,
  isTest: warehouseStocks.isTest,
  updatedAt: warehouseStocks.updatedAt
};

const stockJoins = (db: Awaited<ReturnType<typeof getDb>>) =>
  db
    .select(stockSelect)
    .from(warehouseStocks)
    .innerJoin(warehouses, eq(warehouses.id, warehouseStocks.warehouseId))
    .innerJoin(catalogSkus, eq(catalogSkus.id, warehouseStocks.skuId))
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId));

/** 列表：支持按仓库 / 关键字 / 仅看低库存筛选；未绑定仓库时返回空列表而不是 403 */
warehouseStockRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const admin = c.get('admin');
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const lowStockOnly = c.req.query('lowStock')?.trim() === 'true';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const accessible = await accessibleWarehouseIds(admin.sub);
  if (warehouseId) {
    if (!isUuid(warehouseId)) {
      return c.json({ code: 'INVALID_QUERY', message: 'warehouseId 不合法' }, 400);
    }
    if (accessible !== null && !accessible.includes(warehouseId)) {
      return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
    }
  }
  if (accessible !== null && accessible.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize });
  }

  const conditions = [];
  if (warehouseId) conditions.push(eq(warehouseStocks.warehouseId, warehouseId));
  if (accessible !== null) {
    conditions.push(inArray(warehouseStocks.warehouseId, accessible));
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(catalogProducts.name, `%${keyword}%`),
        ilike(catalogSkus.specName, `%${keyword}%`),
        ilike(catalogSkus.barcode, `%${keyword}%`)
      )!
    );
  }
  if (lowStockOnly) {
    conditions.push(sql`${availableExpr} <= ${warehouseStocks.minThreshold}`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const db = await getDb();
  const [items, totalRows] = await Promise.all([
    stockJoins(db)
      .where(where)
      .orderBy(
        asc(warehouses.code),
        asc(catalogProducts.name),
        asc(catalogSkus.sortOrder),
        asc(catalogSkus.specName)
      )
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(warehouseStocks)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStocks.warehouseId))
      .innerJoin(catalogSkus, eq(catalogSkus.id, warehouseStocks.skuId))
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

/** 预警：可用量 <= 下限，按缺口从大到小排序；只看启用追踪的规格 */
warehouseStockRoutes.get('/alerts', async (c) => {
  const denied = await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const admin = c.get('admin');
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));

  const accessible = await accessibleWarehouseIds(admin.sub);
  if (warehouseId) {
    if (!isUuid(warehouseId)) {
      return c.json({ code: 'INVALID_QUERY', message: 'warehouseId 不合法' }, 400);
    }
    if (accessible !== null && !accessible.includes(warehouseId)) {
      return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
    }
  }
  if (accessible !== null && accessible.length === 0) {
    return c.json({ items: [], total: 0 });
  }

  const conditions = [
    eq(catalogSkus.stockType, 'tracked'),
    sql`${availableExpr} <= ${warehouseStocks.minThreshold}`
  ];
  if (warehouseId) conditions.push(eq(warehouseStocks.warehouseId, warehouseId));
  if (accessible !== null) {
    conditions.push(inArray(warehouseStocks.warehouseId, accessible));
  }
  const where = and(...conditions);

  const db = await getDb();
  const [items, totalRows] = await Promise.all([
    stockJoins(db)
      .where(where)
      .orderBy(
        asc(sql`${availableExpr} - ${warehouseStocks.minThreshold}`),
        asc(warehouses.code),
        asc(catalogProducts.name)
      )
      .limit(limit),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(warehouseStocks)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStocks.warehouseId))
      .innerJoin(catalogSkus, eq(catalogSkus.id, warehouseStocks.skuId))
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0 });
});

const thresholdSchema = z.object({
  minThreshold: z.union([z.string(), z.number()]),
  maxThreshold: z.union([z.string(), z.number()]).nullish()
});

/**
 * 设置仓库库存上下限。
 * 只改阈值，不动 quantity / reserved_qty；阈值变更写 document_events 审计。
 */
warehouseStockRoutes.patch('/:warehouseId/:catalogSkuId/threshold', async (c) => {
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const warehouseId = c.req.param('warehouseId');
  const catalogSkuId = c.req.param('catalogSkuId');
  if (!isUuid(warehouseId) || !isUuid(catalogSkuId)) {
    return c.json({ code: 'INVALID_PATH', message: '仓库或规格 ID 不合法' }, 400);
  }

  const admin = c.get('admin');
  if (!(await canAccessWarehouse(admin.sub, warehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的维护权限' }, 403);
  }

  const parsed = thresholdSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const [warehouse] = await db
    .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) return c.json({ code: 'NOT_FOUND', message: '仓库不存在' }, 404);

  const [sku] = await db
    .select({
      id: catalogSkus.id,
      specName: catalogSkus.specName,
      quantityMode: catalogSkus.quantityMode,
      isTest: catalogSkus.isTest,
      productName: catalogProducts.name
    })
    .from(catalogSkus)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
    .where(eq(catalogSkus.id, catalogSkuId))
    .limit(1);
  if (!sku) return c.json({ code: 'NOT_FOUND', message: '规格不存在' }, 404);

  const min = normalizeQuantity(parsed.data.minThreshold, sku.quantityMode);
  if (min === null) {
    return c.json(
      { code: 'INVALID_QUANTITY_PRECISION', message: '安全库存下限不符合该规格的数量模式' },
      400
    );
  }
  let max: string | null = null;
  if (parsed.data.maxThreshold !== null && parsed.data.maxThreshold !== undefined) {
    max = normalizeQuantity(parsed.data.maxThreshold, sku.quantityMode);
    if (max === null) {
      return c.json(
        { code: 'INVALID_QUANTITY_PRECISION', message: '安全库存上限不符合该规格的数量模式' },
        400
      );
    }
  }
  if (max !== null && Number(max) < Number(min)) {
    return c.json({ code: 'INVALID_THRESHOLD', message: '上限不能小于下限' }, 400);
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        minThreshold: warehouseStocks.minThreshold,
        maxThreshold: warehouseStocks.maxThreshold,
        isTest: warehouseStocks.isTest
      })
      .from(warehouseStocks)
      .where(
        and(
          eq(warehouseStocks.warehouseId, warehouseId),
          eq(warehouseStocks.skuId, catalogSkuId)
        )
      )
      .limit(1);

    const isTest = existing?.isTest ?? sku.isTest;
    await tx
      .insert(warehouseStocks)
      .values({
        warehouseId,
        skuId: catalogSkuId,
        quantity: '0.00',
        reservedQty: '0.00',
        avgUnitCost: '0.00',
        minThreshold: min,
        maxThreshold: max,
        isTest
      })
      .onConflictDoUpdate({
        target: [warehouseStocks.warehouseId, warehouseStocks.skuId],
        set: { minThreshold: min, maxThreshold: max, updatedAt: new Date() }
      });

    await recordDocumentEvent(tx, {
      documentType: THRESHOLD_DOCUMENT_TYPE,
      documentId: warehouseId,
      toStatus: 'updated',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      reason: '调整仓库安全库存阈值',
      payload: {
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        catalogSkuId,
        productName: sku.productName,
        specName: sku.specName,
        before: {
          minThreshold: existing?.minThreshold ?? '0.00',
          maxThreshold: existing?.maxThreshold ?? null
        },
        after: { minThreshold: min, maxThreshold: max }
      },
      isTest
    });

    return { before: existing ?? null };
  });

  return c.json({
    ok: true,
    warehouseId,
    catalogSkuId,
    minThreshold: min,
    maxThreshold: max,
    before: result.before
  });
});

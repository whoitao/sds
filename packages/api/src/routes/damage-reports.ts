import { Hono, type Context } from 'hono';
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminUserWarehouses,
  catalogProducts,
  catalogSkus,
  damageReportItems,
  damageReports,
  documentEvents,
  getDb,
  productSkuStocks,
  productSkus,
  products,
  shops,
  stockMovements,
  warehouseStocks,
  warehouses
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, canAccessShop, isSuperAdmin } from '../lib/shop-scope.js';
import {
  DOCUMENT_NEW_STATE,
  DocumentRuleError,
  acquireIdempotencyKey,
  assertTransition,
  completeIdempotencyKey,
  generateDocumentNo,
  hashIdempotencyRequest,
  recordDocumentEvent,
  releaseIdempotencyKey
} from '../lib/documents.js';

/**
 * 报损单：门店报损（product_sku_stocks）与仓内报损（warehouse_stocks）。
 * - 只有 approved 才扣减库存并写 movement_type='waste' 流水，reference_type='damage_report'；
 * - draft / submitted 不动库存；
 * - 门店可用量按 quantity 判断，仓库按 quantity - reserved_qty 判断；
 * - 提交、审核分别支持 Idempotency-Key。
 */
export const damageReportRoutes = new Hono<AdminEnv>();

damageReportRoutes.use('*', requireAdmin);

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;

const DOCUMENT_TYPE = 'damage_report';
const NO_PREFIX = 'DM';
const MODEL_LABEL = '报损单';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回'
};

const SUBJECT_LABELS: Record<string, string> = {
  shop: '门店',
  warehouse: '仓库'
};

const REASON_LABELS: Record<string, string> = {
  expired: '过期',
  damaged: '破损',
  spoiled: '变质',
  other: '其他'
};

const STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
const SUBJECT_TYPES = ['shop', 'warehouse'] as const;
const REASONS = ['expired', 'damaged', 'spoiled', 'other'] as const;

const STATE_MACHINE = {
  [DOCUMENT_NEW_STATE]: ['draft'],
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: [],
  rejected: []
} as const;

const itemSchema = z.object({
  /** 门店侧为 productSkuId，仓库侧为 catalogSkuId */
  skuId: z.uuid('规格 ID 不合法'),
  quantity: z.union([z.string(), z.number()]),
  remark: z.string().trim().max(200).nullish()
});

const createSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  shopId: z.uuid('门店 ID 不合法').nullish(),
  warehouseId: z.uuid('仓库 ID 不合法').nullish(),
  reasonCategory: z.enum(REASONS),
  remark: z.string().trim().max(500).nullish(),
  items: z.array(itemSchema).min(1, '至少需要一条报损明细').max(200)
});

const actionSchema = z.object({
  reason: z.string().trim().max(500).nullish()
});

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

function toCents(value: string | number, field = '数量'): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}不合法`, 400);
  }
  return Math.round(numeric * 100);
}

function formatQty(cents: number): string {
  return (cents / 100).toFixed(2);
}

function positiveCents(value: string | number, field = '数量'): number {
  const cents = toCents(value, field);
  if (cents <= 0) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}必须大于 0`, 400);
  }
  if (cents > 999_999_900) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}过大`, 400);
  }
  return cents;
}

function amountCents(quantityCents: number, unitCostCents: number) {
  return Math.round((quantityCents * unitCostCents) / 100);
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

async function guardWrite(
  c: Context<AdminEnv>,
  adminId: string,
  subjectType: 'shop' | 'warehouse',
  shopId: string | null,
  warehouseId: string | null
) {
  if (subjectType === 'shop') {
    const denied = await guardPermission(c, 'inventory.write', { shopId });
    if (denied) return denied;
    if (!shopId || !(await canAccessShop(adminId, shopId))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该门店的报损权限' }, 403);
    }
    return null;
  }
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;
  if (!warehouseId || !(await canAccessWarehouse(adminId, warehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的报损权限' }, 403);
  }
  return null;
}

/** 列表 / 详情：门店库存权限或仓库权限任一即可读 */
async function guardRead(c: Context<AdminEnv>) {
  const inventoryDenied = await guardPermission(c, 'inventory.read');
  if (!inventoryDenied) return null;
  const warehouseDenied = await guardPermission(c, 'warehouse.read');
  return warehouseDenied ? inventoryDenied : null;
}

type ReportRow = typeof damageReports.$inferSelect;

/** 主体维度的库存读取（审核时加行锁） */
async function loadStockRows(
  d: DbLike,
  report: Pick<ReportRow, 'subjectType' | 'shopId' | 'warehouseId' | 'isTest'>,
  skuIds: string[],
  lock = false
) {
  if (report.subjectType === 'shop') {
    const query = d
      .select({
        skuId: productSkuStocks.productSkuId,
        quantity: productSkuStocks.quantity,
        reservedQty: productSkuStocks.reservedQty,
        avgUnitCost: productSkuStocks.avgUnitCost,
        isTest: productSkuStocks.isTest
      })
      .from(productSkuStocks)
      .where(inArray(productSkuStocks.productSkuId, skuIds));
    const rows = lock ? await query.for('update') : await query;
    return new Map(rows.map((row) => [row.skuId, row]));
  }

  const query = d
    .select({
      skuId: warehouseStocks.skuId,
      quantity: warehouseStocks.quantity,
      reservedQty: warehouseStocks.reservedQty,
      avgUnitCost: warehouseStocks.avgUnitCost,
      isTest: warehouseStocks.isTest
    })
    .from(warehouseStocks)
    .where(
      and(
        eq(warehouseStocks.warehouseId, report.warehouseId!),
        inArray(warehouseStocks.skuId, skuIds)
      )
    );
  const rows = lock ? await query.for('update') : await query;
  return new Map(rows.map((row) => [row.skuId, row]));
}

function availableCents(
  subjectType: string,
  stock: { quantity: string; reservedQty: string } | undefined
) {
  if (!stock) return 0;
  const quantity = toCents(stock.quantity);
  if (subjectType === 'shop') return Math.max(quantity, 0);
  return Math.max(quantity - toCents(stock.reservedQty), 0);
}

/** 校验数量不超过可用库存；门店按 quantity，仓库按 quantity - reserved_qty */
function assertStockEnough(
  subjectType: string,
  item: { itemName: string; specName: string | null; quantity: string; unit: string },
  stock: { quantity: string; reservedQty: string; isTest: boolean } | undefined,
  isTest: boolean
) {
  if (stock && stock.isTest !== isTest) {
    throw new DocumentRuleError(
      'TEST_DATA_MISMATCH',
      '测试数据与正式数据混用，请检查数据标记',
      409
    );
  }
  const available = availableCents(subjectType, stock);
  const requested = toCents(item.quantity);
  if (requested > available) {
    throw new DocumentRuleError(
      'DAMAGE_INSUFFICIENT_STOCK',
      `可用量不足：${item.itemName}${item.specName ? `（${item.specName}）` : ''} 可用 ${formatQty(available)} ${item.unit}，报损 ${formatQty(requested)} ${item.unit}`,
      409
    );
  }
}

async function loadReportDetail(dbc: DbLike, id: string) {
  const d = dbc as Db;
  const [header] = await d
    .select({
      id: damageReports.id,
      reportNo: damageReports.reportNo,
      subjectType: damageReports.subjectType,
      shopId: damageReports.shopId,
      warehouseId: damageReports.warehouseId,
      status: damageReports.status,
      reasonCategory: damageReports.reasonCategory,
      remark: damageReports.remark,
      reviewNote: damageReports.reviewNote,
      createdByAdminId: damageReports.createdByAdminId,
      submittedByAdminId: damageReports.submittedByAdminId,
      submittedAt: damageReports.submittedAt,
      reviewedByAdminId: damageReports.reviewedByAdminId,
      reviewedAt: damageReports.reviewedAt,
      isTest: damageReports.isTest,
      createdAt: damageReports.createdAt,
      updatedAt: damageReports.updatedAt,
      shopName: shops.name,
      warehouseName: warehouses.name
    })
    .from(damageReports)
    .leftJoin(shops, eq(shops.id, damageReports.shopId))
    .leftJoin(warehouses, eq(warehouses.id, damageReports.warehouseId))
    .where(eq(damageReports.id, id))
    .limit(1);
  if (!header) return null;

  const [items, events] = await Promise.all([
    d
      .select()
      .from(damageReportItems)
      .where(eq(damageReportItems.reportId, id))
      .orderBy(asc(damageReportItems.itemName), asc(damageReportItems.specName)),
    d
      .select()
      .from(documentEvents)
      .where(
        and(eq(documentEvents.documentType, DOCUMENT_TYPE), eq(documentEvents.documentId, id))
      )
      .orderBy(asc(documentEvents.createdAt))
  ]);

  const totalQuantity = items.reduce((acc, item) => acc + toCents(item.quantity), 0);
  const totalAmount = items.reduce((acc, item) => acc + toCents(item.amount), 0);

  return {
    ...header,
    subjectName: header.subjectType === 'shop' ? header.shopName : header.warehouseName,
    subjectTypeLabel: SUBJECT_LABELS[header.subjectType] ?? header.subjectType,
    statusLabel: STATUS_LABELS[header.status] ?? header.status,
    reasonLabel: REASON_LABELS[header.reasonCategory] ?? header.reasonCategory,
    totalQuantity: formatQty(totalQuantity),
    totalAmount: formatQty(totalAmount),
    itemCount: items.length,
    items,
    events
  };
}

async function loadReportRow(dbc: DbLike, id: string, lock = false) {
  const d = dbc as Db;
  const query = d.select().from(damageReports).where(eq(damageReports.id, id)).limit(1);
  const rows = lock ? await query.for('update') : await query;
  return rows[0] ?? null;
}

/** 创建草稿：只落单据和成本快照，不动库存 */
damageReportRoutes.post('/damage-reports', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }
  const input = parsed.data;
  const admin = c.get('admin');
  const db = await getDb();

  if (input.subjectType === 'shop') {
    if (!input.shopId || input.warehouseId) {
      return c.json({ code: 'INVALID_SUBJECT', message: '门店报损必须且只能指定门店' }, 400);
    }
  } else if (!input.warehouseId || input.shopId) {
    return c.json({ code: 'INVALID_SUBJECT', message: '仓内报损必须且只能指定仓库' }, 400);
  }

  const denied = await guardWrite(
    c,
    admin.sub,
    input.subjectType,
    input.shopId ?? null,
    input.warehouseId ?? null
  );
  if (denied) return denied;

  let isTest = false;
  if (input.subjectType === 'shop') {
    const [shop] = await db
      .select({ id: shops.id, isTest: shops.isTest })
      .from(shops)
      .where(eq(shops.id, input.shopId!))
      .limit(1);
    if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在' }, 404);
    isTest = shop.isTest;
  } else {
    const [warehouse] = await db
      .select({ id: warehouses.id, status: warehouses.status, isTest: warehouses.isTest })
      .from(warehouses)
      .where(eq(warehouses.id, input.warehouseId!))
      .limit(1);
    if (!warehouse) return c.json({ code: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' }, 404);
    if (warehouse.status !== 'active') {
      return c.json({ code: 'WAREHOUSE_DISABLED', message: '仓库已停用' }, 409);
    }
    isTest = warehouse.isTest;
  }

  const skuIds = input.items.map((item) => item.skuId);
  if (new Set(skuIds).size !== skuIds.length) {
    return c.json({ code: 'DUPLICATE_SKU', message: '同一规格不能重复添加' }, 400);
  }

  let resolved: Array<{
    productSkuId: string | null;
    catalogSkuId: string | null;
    itemName: string;
    specName: string | null;
    unit: string;
    quantity: string;
    unitCost: string;
    amount: string;
    remark: string | null;
  }> = [];

  try {
    if (input.subjectType === 'shop') {
    const rows = await db
      .select({
        id: productSkus.id,
        shopId: productSkus.shopId,
        stockType: productSkus.stockType,
        specName: productSkus.specName,
        unit: productSkus.unit,
        productName: products.name,
        catalogSpecName: catalogSkus.specName,
        catalogUnit: catalogSkus.unit,
        catalogProductName: catalogProducts.name,
        avgUnitCost: productSkuStocks.avgUnitCost
      })
      .from(productSkus)
      .innerJoin(products, eq(products.id, productSkus.productId))
      .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
      .leftJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id))
      .where(inArray(productSkus.id, skuIds));
    if (rows.length !== skuIds.length) {
      return c.json({ code: 'SKU_NOT_FOUND', message: '包含不存在的商品规格' }, 400);
    }
    resolved = input.items.map((item) => {
      const sku = rows.find((row) => row.id === item.skuId)!;
      if (sku.shopId !== input.shopId) {
        throw new DocumentRuleError('SKU_NOT_IN_SHOP', '商品规格不属于该门店', 400);
      }
      if (sku.stockType !== 'tracked') {
        throw new DocumentRuleError('SKU_NOT_TRACKED', '只有库存规格才能报损', 400);
      }
      const quantityCents = positiveCents(item.quantity);
      const costCents = toCents(sku.avgUnitCost ?? '0', '成本');
      return {
        productSkuId: sku.id,
        catalogSkuId: null,
        itemName: sku.catalogProductName ?? sku.productName,
        specName: sku.catalogSpecName ?? sku.specName,
        unit: sku.catalogUnit ?? sku.unit,
        quantity: formatQty(quantityCents),
        unitCost: formatQty(costCents),
        amount: formatQty(amountCents(quantityCents, costCents)),
        remark: item.remark?.trim() || null
      };
    });
  } else {
    const rows = await db
      .select({
        id: catalogSkus.id,
        stockType: catalogSkus.stockType,
        specName: catalogSkus.specName,
        unit: catalogSkus.unit,
        productName: catalogProducts.name,
        avgUnitCost: warehouseStocks.avgUnitCost
      })
      .from(catalogSkus)
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .leftJoin(
        warehouseStocks,
        and(
          eq(warehouseStocks.skuId, catalogSkus.id),
          eq(warehouseStocks.warehouseId, input.warehouseId!)
        )
      )
      .where(inArray(catalogSkus.id, skuIds));
    if (rows.length !== skuIds.length) {
      return c.json({ code: 'SKU_NOT_FOUND', message: '包含不存在的总部规格' }, 400);
    }
    resolved = input.items.map((item) => {
      const sku = rows.find((row) => row.id === item.skuId)!;
      if (sku.stockType !== 'tracked') {
        throw new DocumentRuleError('SKU_NOT_TRACKED', '只有库存规格才能报损', 400);
      }
      const quantityCents = positiveCents(item.quantity);
      const costCents = toCents(sku.avgUnitCost ?? '0', '成本');
      return {
        productSkuId: null,
        catalogSkuId: sku.id,
        itemName: sku.productName,
        specName: sku.specName,
        unit: sku.unit,
        quantity: formatQty(quantityCents),
        unitCost: formatQty(costCents),
        amount: formatQty(amountCents(quantityCents, costCents)),
        remark: item.remark?.trim() || null
      };
    });
  }
  } catch (error) {
    if (error instanceof DocumentRuleError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }

  const totalQuantity = resolved.reduce((acc, item) => acc + toCents(item.quantity), 0);
  const totalAmount = resolved.reduce((acc, item) => acc + toCents(item.amount), 0);

  try {
    const detail = await db.transaction(async (tx) => {
      const [header] = await tx
        .insert(damageReports)
        .values({
          reportNo: generateDocumentNo(NO_PREFIX),
          subjectType: input.subjectType,
          shopId: input.subjectType === 'shop' ? input.shopId : null,
          warehouseId: input.subjectType === 'warehouse' ? input.warehouseId : null,
          status: 'draft',
          reasonCategory: input.reasonCategory,
          remark: input.remark?.trim() || null,
          createdByAdminId: admin.sub,
          isTest
        })
        .returning();
      await tx.insert(damageReportItems).values(
        resolved.map((item) => ({
          reportId: header.id,
          ...item,
          isTest
        }))
      );
      await recordDocumentEvent(tx, {
        documentType: DOCUMENT_TYPE,
        documentId: header.id,
        fromStatus: DOCUMENT_NEW_STATE,
        toStatus: 'draft',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        isTest,
        payload: {
          subjectType: input.subjectType,
          subjectId: input.subjectType === 'shop' ? input.shopId : input.warehouseId,
          reasonCategory: input.reasonCategory,
          itemCount: resolved.length,
          totalQuantity: formatQty(totalQuantity),
          totalAmount: formatQty(totalAmount)
        }
      });
      return loadReportDetail(tx, header.id);
    });
    return c.json({ item: detail }, 201);
  } catch (error) {
    if (error instanceof DocumentRuleError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

/** 列表：按主体 / 状态 / 原因 / 时间 / 单号筛选，并按门店 / 仓库范围过滤 */
damageReportRoutes.get('/damage-reports', async (c) => {
  const denied = await guardRead(c);
  if (denied) return denied;

  const admin = c.get('admin');
  const db = await getDb();
  const query = c.req.query();
  const { page, pageSize, offset } = parsePaging(query);

  const conditions = [];
  const subjectType = query.subjectType?.trim() ?? '';
  const status = query.status?.trim() ?? '';
  const reasonCategory = query.reasonCategory?.trim() ?? '';
  const keyword = query.keyword?.trim() ?? '';
  const shopId = query.shopId?.trim() ?? '';
  const warehouseId = query.warehouseId?.trim() ?? '';
  const dateFrom = query.dateFrom?.trim() ?? '';
  const dateTo = query.dateTo?.trim() ?? '';

  if (subjectType && SUBJECT_TYPES.includes(subjectType as (typeof SUBJECT_TYPES)[number])) {
    conditions.push(eq(damageReports.subjectType, subjectType));
  }
  if (status && STATUSES.includes(status as (typeof STATUSES)[number])) {
    conditions.push(eq(damageReports.status, status));
  }
  if (
    reasonCategory &&
    REASONS.includes(reasonCategory as (typeof REASONS)[number])
  ) {
    conditions.push(eq(damageReports.reasonCategory, reasonCategory));
  }
  if (keyword) conditions.push(ilike(damageReports.reportNo, `%${keyword}%`));
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    conditions.push(gte(damageReports.createdAt, new Date(`${dateFrom}T00:00:00.000Z`)));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    const next = new Date(`${dateTo}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    conditions.push(lt(damageReports.createdAt, next));
  }

  if (shopId) {
    if (!(await canAccessShop(admin.sub, shopId))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
    }
    conditions.push(eq(damageReports.shopId, shopId));
  }
  if (warehouseId) {
    if (!(await canAccessWarehouse(admin.sub, warehouseId))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
    }
    conditions.push(eq(damageReports.warehouseId, warehouseId));
  }

  const warehouseAccess = await accessibleWarehouseIds(admin.sub);
  if (warehouseAccess !== null) {
    const shopAccess = await accessibleShopIds(admin.sub);
    if (shopAccess === null) {
      // 理论上不会出现：仓库受限而门店不受限，仍按仓库范围处理
      conditions.push(inArray(damageReports.warehouseId, warehouseAccess));
    } else if (shopAccess.length === 0 && warehouseAccess.length === 0) {
      return c.json({ items: [], total: 0, page, pageSize });
    } else {
      const scoped = [];
      if (shopAccess.length > 0) {
        scoped.push(
          and(eq(damageReports.subjectType, 'shop'), inArray(damageReports.shopId, shopAccess))!
        );
      }
      if (warehouseAccess.length > 0) {
        scoped.push(
          and(
            eq(damageReports.subjectType, 'warehouse'),
            inArray(damageReports.warehouseId, warehouseAccess)
          )!
        );
      }
      conditions.push(or(...scoped)!);
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: damageReports.id,
        reportNo: damageReports.reportNo,
        subjectType: damageReports.subjectType,
        shopId: damageReports.shopId,
        warehouseId: damageReports.warehouseId,
        subjectName: sql<string | null>`coalesce(${shops.name}, ${warehouses.name})`,
        status: damageReports.status,
        reasonCategory: damageReports.reasonCategory,
        remark: damageReports.remark,
        reviewNote: damageReports.reviewNote,
        submittedAt: damageReports.submittedAt,
        reviewedAt: damageReports.reviewedAt,
        createdAt: damageReports.createdAt,
        updatedAt: damageReports.updatedAt,
        itemCount: sql<number>`(
          select count(*) from damage_report_items i
          where i.report_id = damage_reports.id
        )::int`,
        totalQuantity: sql<string>`(
          select coalesce(sum(i.quantity), 0)::text from damage_report_items i
          where i.report_id = damage_reports.id
        )`,
        totalAmount: sql<string>`(
          select coalesce(sum(i.amount), 0)::text from damage_report_items i
          where i.report_id = damage_reports.id
        )`
      })
      .from(damageReports)
      .leftJoin(shops, eq(shops.id, damageReports.shopId))
      .leftJoin(warehouses, eq(warehouses.id, damageReports.warehouseId))
      .where(where)
      .orderBy(desc(damageReports.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(damageReports)
      .where(where)
  ]);

  return c.json({
    items: items.map((item) => ({
      ...item,
      subjectTypeLabel: SUBJECT_LABELS[item.subjectType] ?? item.subjectType,
      statusLabel: STATUS_LABELS[item.status] ?? item.status,
      reasonLabel: REASON_LABELS[item.reasonCategory] ?? item.reasonCategory
    })),
    total: totalRows[0]?.count ?? 0,
    page,
    pageSize
  });
});

damageReportRoutes.get('/damage-reports/:id', async (c) => {
  const denied = await guardRead(c);
  if (denied) return denied;

  const admin = c.get('admin');
  const db = await getDb();
  const id = c.req.param('id');
  const detail = await loadReportDetail(db, id);
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '报损单不存在' }, 404);

  if (detail.subjectType === 'shop') {
    if (!(await canAccessShop(admin.sub, detail.shopId!))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
    }
  } else if (!(await canAccessWarehouse(admin.sub, detail.warehouseId!))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
  }

  return c.json({ item: detail });
});

/** 提交：draft → submitted，只做可用量校验，不动库存 */
damageReportRoutes.post('/damage-reports/:id/submit', async (c) => {
  const admin = c.get('admin');
  const db = await getDb();
  const id = c.req.param('id');
  const report = await loadReportRow(db, id);
  if (!report) return c.json({ code: 'NOT_FOUND', message: '报损单不存在' }, 404);

  const denied = await guardWrite(
    c,
    admin.sub,
    report.subjectType as 'shop' | 'warehouse',
    report.shopId,
    report.warehouseId
  );
  if (denied) return denied;

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;
  const requestHash = hashIdempotencyRequest({ reportId: id, action: 'submit' });
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'damage_report_submit',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') return c.json(acquired.response ?? { ok: true });
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'DAMAGE_ACTION_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该提交请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const detail = await db.transaction(async (tx) => {
      const current = await loadReportRow(tx, id, true);
      if (!current) throw new DocumentRuleError('NOT_FOUND', '报损单不存在', 404);
      assertTransition(STATE_MACHINE, {
        documentType: MODEL_LABEL,
        from: current.status,
        to: 'submitted'
      });

      const items = await tx
        .select()
        .from(damageReportItems)
        .where(eq(damageReportItems.reportId, id));
      const stocks = await loadStockRows(
        tx,
        current,
        items.map((item) => item.productSkuId ?? item.catalogSkuId!)
      );
      for (const item of items) {
        assertStockEnough(
          current.subjectType,
          item,
          stocks.get(item.productSkuId ?? item.catalogSkuId!),
          current.isTest
        );
      }

      await tx
        .update(damageReports)
        .set({
          status: 'submitted',
          submittedByAdminId: admin.sub,
          submittedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(damageReports.id, id));

      await recordDocumentEvent(tx, {
        documentType: DOCUMENT_TYPE,
        documentId: id,
        fromStatus: current.status,
        toStatus: 'submitted',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        isTest: current.isTest,
        payload: { itemCount: items.length }
      });
      return loadReportDetail(tx, id);
    });
    if (acquiredKey) await completeIdempotencyKey(db, acquiredKey, { item: detail });
    return c.json({ item: detail });
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    if (error instanceof DocumentRuleError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

/**
 * 审核通过：submitted → approved。
 * 同一事务内：锁单据与库存行 → 复核可用量 → 按当前 avg_unit_cost 重算金额 →
 * 扣减库存 → 写 waste 流水（reference_type=damage_report）→ 记事件。
 */
damageReportRoutes.post('/damage-reports/:id/approve', async (c) => {
  const admin = c.get('admin');
  const db = await getDb();
  const id = c.req.param('id');
  const body = actionSchema.safeParse(await c.req.json().catch(() => ({})));
  const note = body.success ? body.data.reason?.trim() || null : null;
  const report = await loadReportRow(db, id);
  if (!report) return c.json({ code: 'NOT_FOUND', message: '报损单不存在' }, 404);

  const denied = await guardWrite(
    c,
    admin.sub,
    report.subjectType as 'shop' | 'warehouse',
    report.shopId,
    report.warehouseId
  );
  if (denied) return denied;

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;
  const requestHash = hashIdempotencyRequest({ reportId: id, action: 'approve', note });
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'damage_report_approve',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') return c.json(acquired.response ?? { ok: true });
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'DAMAGE_ACTION_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该审核请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const detail = await db.transaction(async (tx) => {
      const current = await loadReportRow(tx, id, true);
      if (!current) throw new DocumentRuleError('NOT_FOUND', '报损单不存在', 404);
      assertTransition(STATE_MACHINE, {
        documentType: MODEL_LABEL,
        from: current.status,
        to: 'approved'
      });

      const items = await tx
        .select()
        .from(damageReportItems)
        .where(eq(damageReportItems.reportId, id))
        .orderBy(asc(damageReportItems.id));
      if (items.length === 0) {
        throw new DocumentRuleError('EMPTY_ITEMS', '报损单没有明细，不能审核', 409);
      }

      const skuIds = items.map((item) => item.productSkuId ?? item.catalogSkuId!);
      const stocks = await loadStockRows(tx, current, skuIds, true);

      // 门店流水需要总部规格快照
      let catalogByProductSku = new Map<string, string | null>();
      if (current.subjectType === 'shop') {
        const rows = await tx
          .select({ id: productSkus.id, catalogSkuId: productSkus.catalogSkuId })
          .from(productSkus)
          .where(inArray(productSkus.id, skuIds));
        catalogByProductSku = new Map(rows.map((row) => [row.id, row.catalogSkuId]));
      }

      let totalQuantity = 0;
      let totalAmount = 0;
      const movementValues: Array<typeof stockMovements.$inferInsert> = [];

      for (const item of items) {
        const stockSkuId = item.productSkuId ?? item.catalogSkuId!;
        const stock = stocks.get(stockSkuId);
        assertStockEnough(current.subjectType, item, stock, current.isTest);
        if (!stock) {
          throw new DocumentRuleError(
            'DAMAGE_INSUFFICIENT_STOCK',
            `可用量不足：${item.itemName} 没有库存余额`,
            409
          );
        }

        const quantityCents = toCents(item.quantity);
        const costCents = toCents(stock.avgUnitCost);
        const amount = amountCents(quantityCents, costCents);
        const currentCents = toCents(stock.quantity);
        const nextCents = currentCents - quantityCents;
        if (nextCents < 0) {
          throw new DocumentRuleError(
            'DAMAGE_INSUFFICIENT_STOCK',
            `可用量不足：${item.itemName} 可用 ${formatQty(currentCents)}，报损 ${formatQty(quantityCents)}`,
            409
          );
        }

        if (current.subjectType === 'shop') {
          await tx
            .update(productSkuStocks)
            .set({ quantity: formatQty(nextCents), updatedAt: new Date() })
            .where(eq(productSkuStocks.productSkuId, stockSkuId));
        } else {
          await tx
            .update(warehouseStocks)
            .set({ quantity: formatQty(nextCents), updatedAt: new Date() })
            .where(
              and(
                eq(warehouseStocks.warehouseId, current.warehouseId!),
                eq(warehouseStocks.skuId, stockSkuId)
              )
            );
        }

        await tx
          .update(damageReportItems)
          .set({ unitCost: formatQty(costCents), amount: formatQty(amount) })
          .where(eq(damageReportItems.id, item.id));

        movementValues.push({
          shopId: current.subjectType === 'shop' ? current.shopId : null,
          locationType: current.subjectType,
          locationId:
            current.subjectType === 'shop' ? current.shopId! : current.warehouseId!,
          productSkuId: current.subjectType === 'shop' ? item.productSkuId : null,
          catalogSkuId:
            current.subjectType === 'shop'
              ? catalogByProductSku.get(item.productSkuId!) ?? null
              : item.catalogSkuId,
          movementType: 'waste',
          quantityChange: `-${formatQty(quantityCents)}`,
          balanceAfter: formatQty(nextCents),
          unitCost: formatQty(costCents),
          referenceType: DOCUMENT_TYPE,
          referenceId: id,
          operatorAdminId: admin.sub,
          remark: `报损单 ${current.reportNo}：${REASON_LABELS[current.reasonCategory] ?? current.reasonCategory}`,
          isTest: current.isTest
        });

        totalQuantity += quantityCents;
        totalAmount += amount;
      }

      await tx.insert(stockMovements).values(movementValues);
      await tx
        .update(damageReports)
        .set({
          status: 'approved',
          reviewedByAdminId: admin.sub,
          reviewedAt: new Date(),
          reviewNote: note,
          updatedAt: new Date()
        })
        .where(eq(damageReports.id, id));

      await recordDocumentEvent(tx, {
        documentType: DOCUMENT_TYPE,
        documentId: id,
        fromStatus: current.status,
        toStatus: 'approved',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        reason: note,
        isTest: current.isTest,
        payload: {
          itemCount: items.length,
          totalQuantity: formatQty(totalQuantity),
          totalAmount: formatQty(totalAmount),
          movementType: 'waste',
          referenceType: DOCUMENT_TYPE
        }
      });
      return loadReportDetail(tx, id);
    });
    if (acquiredKey) await completeIdempotencyKey(db, acquiredKey, { item: detail });
    return c.json({ item: detail });
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    if (error instanceof DocumentRuleError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (isUniqueViolation(error)) {
      return c.json(
        { code: 'DAMAGE_MOVEMENT_CONFLICT', message: '该报损单已生成损耗流水' },
        409
      );
    }
    throw error;
  }
});

/** 驳回：submitted → rejected，驳回为终态；原因必填；不动库存 */
damageReportRoutes.post('/damage-reports/:id/reject', async (c) => {
  const admin = c.get('admin');
  const db = await getDb();
  const id = c.req.param('id');
  const parsed = actionSchema.safeParse(await c.req.json().catch(() => ({})));
  const reason = parsed.success ? parsed.data.reason?.trim() ?? '' : '';
  if (!reason) {
    return c.json({ code: 'REASON_REQUIRED', message: '驳回原因必填' }, 400);
  }
  const report = await loadReportRow(db, id);
  if (!report) return c.json({ code: 'NOT_FOUND', message: '报损单不存在' }, 404);

  const denied = await guardWrite(
    c,
    admin.sub,
    report.subjectType as 'shop' | 'warehouse',
    report.shopId,
    report.warehouseId
  );
  if (denied) return denied;

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;
  const requestHash = hashIdempotencyRequest({ reportId: id, action: 'reject', reason });
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'damage_report_reject',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') return c.json(acquired.response ?? { ok: true });
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'DAMAGE_ACTION_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该驳回请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const detail = await db.transaction(async (tx) => {
      const current = await loadReportRow(tx, id, true);
      if (!current) throw new DocumentRuleError('NOT_FOUND', '报损单不存在', 404);
      assertTransition(STATE_MACHINE, {
        documentType: MODEL_LABEL,
        from: current.status,
        to: 'rejected'
      });

      await tx
        .update(damageReports)
        .set({
          status: 'rejected',
          reviewedByAdminId: admin.sub,
          reviewedAt: new Date(),
          reviewNote: reason,
          updatedAt: new Date()
        })
        .where(eq(damageReports.id, id));

      await recordDocumentEvent(tx, {
        documentType: DOCUMENT_TYPE,
        documentId: id,
        fromStatus: current.status,
        toStatus: 'rejected',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        reason,
        isTest: current.isTest
      });
      return loadReportDetail(tx, id);
    });
    if (acquiredKey) await completeIdempotencyKey(db, acquiredKey, { item: detail });
    return c.json({ item: detail });
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    if (error instanceof DocumentRuleError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

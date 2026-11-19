import { Hono, type Context } from 'hono';
import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  adminRoles,
  adminUserRoles,
  adminUserShops,
  adminUsers,
  adminUserWarehouses,
  catalogProducts,
  catalogSkus,
  documentEvents,
  getDb,
  productSkuStocks,
  productSkus,
  shopRequisitionItems,
  shopRequisitions,
  shops,
  stockMovements,
  warehouseStocks,
  warehouseTransferItems,
  warehouseTransfers,
  warehouses
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { checkPermission, guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, canAccessShop, isSuperAdmin } from '../lib/shop-scope.js';
import {
  DOCUMENT_NEW_STATE,
  DocumentRuleError,
  acquireIdempotencyKey,
  completeIdempotencyKey,
  generateDocumentNo,
  hashIdempotencyRequest,
  recordDocumentEvent,
  releaseIdempotencyKey
} from '../lib/documents.js';
import {
  WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
  WAREHOUSE_TRANSFER_NO_PREFIX,
  assertWarehouseTransferTransition,
  releaseWarehouseReservation,
  reserveWarehouseStock,
  resolveTransferSkuMapping,
  shipReservedWarehouseStock,
  type WarehouseTransferStatus
} from '../lib/warehouse-transfers.js';

/**
 * 总部仓 → 门店分拨单接口。
 * - 仓库侧：warehouse.write + admin_user_warehouses 仓库可见性（创建 / 分配 / 发货 / 取消）；
 * - 门店侧：inventory.write + admin_user_shops 门店范围（收货）；
 * - 列表与详情：warehouse.read、warehouse.transfer_read 或 inventory.read，并按仓库 / 门店范围过滤。
 * 所有写操作在事务内完成，库存余额、预留、流水、单据事件、幂等结果同事务提交。
 */
export const warehouseTransferRoutes = new Hono<AdminEnv>();

warehouseTransferRoutes.use('*', requireAdmin);

/** 收货 SLA：全部发出后多少小时内应完成收货。改这里即可调整应收货时间。 */
const RECEIVE_SLA_HOURS = 24;

/** 列表/详情里并列展示「建议收货人」与「实际收货人」 */
const receiverAdmin = alias(adminUsers, 'receiver_admin');
const receivedByAdmin = alias(adminUsers, 'received_by_admin');

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  allocated: '已分配',
  shipped: '已发出',
  received: '已收货',
  cancelled: '已取消'
};

const TRANSFER_STATUSES = ['draft', 'allocated', 'shipped', 'received', 'cancelled'] as const;

const DIFFERENCE_REASONS = [
  'shortage',
  'damaged',
  'expired',
  'spec_mismatch',
  'other'
] as const;

const DIFFERENCE_REASON_LABELS: Record<(typeof DIFFERENCE_REASONS)[number], string> = {
  shortage: '短装',
  damaged: '破损',
  expired: '过期',
  spec_mismatch: '规格不符',
  other: '其他'
};

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

function cents(value: string | number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new DocumentRuleError('INVALID_QUANTITY', '数量不合法', 400);
  }
  return Math.round(numeric * 100);
}

function formatQty(value: number): string {
  return (value / 100).toFixed(2);
}

/** 解析数量为「分」，允许 0；用于部分分配 / 部分发货 / 部分收货 */
function nonNegativeCents(value: string | number, field = '数量'): number {
  const result = cents(value);
  if (result < 0) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}不能为负数`, 400);
  }
  if (result > 9_999_999_900) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}过大`, 400);
  }
  return result;
}

function positiveCents(value: string | number, field = '数量'): number {
  const result = nonNegativeCents(value, field);
  if (result <= 0) {
    throw new DocumentRuleError('INVALID_QUANTITY', `${field}必须大于 0`, 400);
  }
  return result;
}

function amountOf(quantityCents: number, unitCost: string): string {
  return (Math.round(quantityCents * Number(unitCost)) / 100).toFixed(2);
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

/**
 * 列表 / 详情允许仓库侧或门店侧查看：
 * warehouse.read（仓库管理）、warehouse.transfer_read（仅分拨，给店长）、inventory.read（沿用原门店侧规则）。
 */
async function guardTransferRead(c: Context<AdminEnv>) {
  const warehouseDenied = await guardPermission(c, 'warehouse.read');
  if (!warehouseDenied) return null;
  const transferDenied = await guardPermission(c, 'warehouse.transfer_read');
  if (!transferDenied) return null;
  const inventoryDenied = await guardPermission(c, 'inventory.read');
  return inventoryDenied ? warehouseDenied : null;
}

/**
 * 目标门店的候选收货人：绑定该门店、启用中、角色为店长。
 * 多个店长时按绑定时间 + 账号稳定排序，发货弹窗默认取第一个。
 */
async function resolveShopReceivers(shopId: string, dbc?: DbLike) {
  const d = (dbc ?? (await getDb())) as Db;
  return d
    .select({
      id: adminUsers.id,
      username: adminUsers.username,
      displayName: adminUsers.displayName
    })
    .from(adminUserShops)
    .innerJoin(adminUsers, eq(adminUsers.id, adminUserShops.adminUserId))
    .innerJoin(adminUserRoles, eq(adminUserRoles.adminUserId, adminUsers.id))
    .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
    .where(
      and(
        eq(adminUserShops.shopId, shopId),
        eq(adminRoles.code, 'store_manager'),
        eq(adminUsers.status, 1)
      )
    )
    .orderBy(asc(adminUserShops.createdAt), asc(adminUsers.username));
}

function summarizeItems(
  items: Array<{
    requestedQuantity: string;
    allocatedQuantity: string;
    shippedQuantity: string;
    receivedQuantity: string;
    lossQuantity: string;
    lossAmount: string;
  }>
) {
  const total = (key: keyof (typeof items)[number]) =>
    items.reduce((acc, item) => acc + cents(item[key]), 0);
  const requested = total('requestedQuantity');
  const allocated = total('allocatedQuantity');
  const shipped = total('shippedQuantity');
  const received = total('receivedQuantity');
  const lossQuantity = total('lossQuantity');
  const lossAmount = total('lossAmount');
  return {
    totals: {
      requestedQuantity: formatQty(requested),
      allocatedQuantity: formatQty(allocated),
      shippedQuantity: formatQty(shipped),
      receivedQuantity: formatQty(received),
      lossQuantity: formatQty(lossQuantity),
      lossAmount: formatQty(lossAmount)
    },
    fullyAllocated: requested > 0 && allocated >= requested,
    fullyShipped: allocated > 0 && shipped >= allocated,
    fullyReceived: shipped > 0 && received >= shipped,
    partialShipped: shipped > 0 && shipped < allocated,
    partialReceived: received > 0 && received < shipped,
    hasDifference: shipped > received
  };
}

async function loadTransferDetail(id: string, dbc?: DbLike) {
  const d = (dbc ?? (await getDb())) as Db;
  const [header] = await d
    .select({
      id: warehouseTransfers.id,
      transferNo: warehouseTransfers.transferNo,
      fromWarehouseId: warehouseTransfers.fromWarehouseId,
      fromWarehouseCode: warehouses.code,
      fromWarehouseName: warehouses.name,
      toShopId: warehouseTransfers.toShopId,
      toShopName: shops.name,
      status: warehouseTransfers.status,
      deliveryDate: warehouseTransfers.deliveryDate,
      requestedByAdminId: warehouseTransfers.requestedByAdminId,
      handledByAdminId: warehouseTransfers.handledByAdminId,
      receiverAdminId: warehouseTransfers.receiverAdminId,
      receiverName: receiverAdmin.displayName,
      receivedByAdminId: warehouseTransfers.receivedByAdminId,
      receivedByName: receivedByAdmin.displayName,
      receiveDueAt: warehouseTransfers.receiveDueAt,
      allocatedAt: warehouseTransfers.allocatedAt,
      shippedAt: warehouseTransfers.shippedAt,
      receivedAt: warehouseTransfers.receivedAt,
      differenceClosedAt: warehouseTransfers.differenceClosedAt,
      differenceCloseReason: warehouseTransfers.differenceCloseReason,
      cancelledAt: warehouseTransfers.cancelledAt,
      cancelReason: warehouseTransfers.cancelReason,
      remark: warehouseTransfers.remark,
      isTest: warehouseTransfers.isTest,
      createdAt: warehouseTransfers.createdAt,
      updatedAt: warehouseTransfers.updatedAt
    })
    .from(warehouseTransfers)
    .innerJoin(warehouses, eq(warehouses.id, warehouseTransfers.fromWarehouseId))
    .innerJoin(shops, eq(shops.id, warehouseTransfers.toShopId))
    .leftJoin(receiverAdmin, eq(receiverAdmin.id, warehouseTransfers.receiverAdminId))
    .leftJoin(receivedByAdmin, eq(receivedByAdmin.id, warehouseTransfers.receivedByAdminId))
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return null;

  const [items, events] = await Promise.all([
    d
      .select({
        id: warehouseTransferItems.id,
        catalogSkuId: warehouseTransferItems.catalogSkuId,
        catalogProductName: catalogProducts.name,
        catalogSpecName: catalogSkus.specName,
        categoryId: catalogProducts.categoryId,
        productSkuId: warehouseTransferItems.productSkuId,
        productSkuSpecName: productSkus.specName,
        unit: catalogSkus.unit,
        requestedQuantity: warehouseTransferItems.requestedQuantity,
        allocatedQuantity: warehouseTransferItems.allocatedQuantity,
        shippedQuantity: warehouseTransferItems.shippedQuantity,
        receivedQuantity: warehouseTransferItems.receivedQuantity,
        differenceReason: warehouseTransferItems.differenceReason,
        lossQuantity: warehouseTransferItems.lossQuantity,
        lossAmount: warehouseTransferItems.lossAmount,
        unitCost: warehouseTransferItems.unitCost,
        amount: warehouseTransferItems.amount,
        remark: warehouseTransferItems.remark
      })
      .from(warehouseTransferItems)
      .innerJoin(catalogSkus, eq(catalogSkus.id, warehouseTransferItems.catalogSkuId))
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .leftJoin(productSkus, eq(productSkus.id, warehouseTransferItems.productSkuId))
      .where(eq(warehouseTransferItems.transferId, id))
      .orderBy(asc(catalogProducts.name), asc(catalogSkus.specName)),
    d
      .select()
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.documentType, WAREHOUSE_TRANSFER_DOCUMENT_TYPE),
          eq(documentEvents.documentId, id)
        )
      )
      .orderBy(asc(documentEvents.createdAt))
  ]);

  const summary = summarizeItems(items);
  return {
    ...header,
    statusLabel: STATUS_LABELS[header.status] ?? header.status,
    overdue:
      header.status === 'shipped' &&
      header.receiveDueAt !== null &&
      header.receiveDueAt.getTime() < Date.now(),
    differenceClosed: Boolean(header.differenceClosedAt),
    ...summary,
    items: items.map((item) => {
      const pendingShip = Math.max(
        cents(item.allocatedQuantity) - cents(item.shippedQuantity),
        0
      );
      const pendingReceive = Math.max(
        cents(item.shippedQuantity) - cents(item.receivedQuantity),
        0
      );
      return {
        ...item,
        differenceReasonLabel: item.differenceReason
          ? DIFFERENCE_REASON_LABELS[
              item.differenceReason as (typeof DIFFERENCE_REASONS)[number]
            ] ?? item.differenceReason
          : null,
        mapped: Boolean(item.productSkuId),
        pendingShipQuantity: formatQty(pendingShip),
        pendingReceiveQuantity: formatQty(pendingReceive)
      };
    }),
    events
  };
}

/** 创建时只校验总部规格存在且启用；门店 SKU 映射留到分配阶段解析 */
async function resolveCatalogSkuRef(
  tx: DbLike,
  input: { catalogSkuId?: string; catalogProductId?: string }
): Promise<string> {
  const d = tx as Db;
  if (input.catalogSkuId) {
    const [row] = await d
      .select({ id: catalogSkus.id, status: catalogSkus.status })
      .from(catalogSkus)
      .where(eq(catalogSkus.id, input.catalogSkuId))
      .limit(1);
    if (!row) throw new DocumentRuleError('TRANSFER_SKU_NOT_FOUND', '总部规格不存在', 404);
    if (row.status !== 'active') {
      throw new DocumentRuleError('TRANSFER_SKU_DISABLED', '总部规格已停用，不能分拨', 409);
    }
    return row.id;
  }
  const [row] = await d
    .select({ id: catalogSkus.id })
    .from(catalogSkus)
    .where(
      and(
        eq(catalogSkus.catalogProductId, input.catalogProductId!),
        eq(catalogSkus.isDefault, true),
        eq(catalogSkus.status, 'active')
      )
    )
    .limit(1);
  if (!row) {
    throw new DocumentRuleError(
      'TRANSFER_SKU_NOT_FOUND',
      '总部商品没有启用中的默认规格',
      404
    );
  }
  return row.id;
}

const createItemSchema = z
  .object({
    catalogSkuId: z.uuid('总部规格 ID 不合法').optional(),
    catalogProductId: z.uuid('总部商品 ID 不合法').optional(),
    requestedQuantity: z.union([z.string(), z.number()]),
    remark: z.string().trim().max(200).nullish()
  })
  .refine((value) => Boolean(value.catalogSkuId || value.catalogProductId), {
    message: '明细必须指定总部规格或总部商品'
  });

const createSchema = z.object({
  fromWarehouseId: z.uuid('仓库 ID 不合法'),
  toShopId: z.uuid('门店 ID 不合法'),
  remark: z.string().trim().max(500).nullish(),
  items: z.array(createItemSchema).min(1, '至少一条分拨明细').max(200)
});

warehouseTransferRoutes.post('/warehouse-transfers', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const admin = c.get('admin');
  if (!(await canAccessWarehouse(admin.sub, parsed.data.fromWarehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的分拨权限' }, 403);
  }

  const db = await getDb();
  const [warehouse] = await db
    .select({ id: warehouses.id, status: warehouses.status })
    .from(warehouses)
    .where(eq(warehouses.id, parsed.data.fromWarehouseId))
    .limit(1);
  if (!warehouse) return c.json({ code: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' }, 404);
  if (warehouse.status !== 'active') {
    return c.json({ code: 'WAREHOUSE_DISABLED', message: '仓库已停用，不能分拨' }, 409);
  }

  const [shop] = await db
    .select({ id: shops.id, name: shops.name, isTest: shops.isTest })
    .from(shops)
    .where(eq(shops.id, parsed.data.toShopId))
    .limit(1);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在' }, 404);

  try {
    const created = await db.transaction(async (tx) => {
      const [header] = await tx
        .insert(warehouseTransfers)
        .values({
          transferNo: generateDocumentNo(WAREHOUSE_TRANSFER_NO_PREFIX),
          fromWarehouseId: parsed.data.fromWarehouseId,
          toShopId: parsed.data.toShopId,
          status: 'draft',
          requestedByAdminId: admin.sub,
          remark: parsed.data.remark?.trim() || null,
          isTest: shop.isTest
        })
        .returning();

      const seen = new Set<string>();
      const lines = [];
      for (const input of parsed.data.items) {
        const catalogSkuId = await resolveCatalogSkuRef(tx, input);
        if (seen.has(catalogSkuId)) {
          throw new DocumentRuleError(
            'TRANSFER_DUPLICATE_SKU',
            '同一总部规格不能重复添加',
            400
          );
        }
        seen.add(catalogSkuId);
        const requestedCents = positiveCents(input.requestedQuantity, '申请数量');
        lines.push({
          transferId: header.id,
          catalogSkuId,
          productSkuId: null,
          requestedQuantity: formatQty(requestedCents),
          allocatedQuantity: '0.00',
          shippedQuantity: '0.00',
          receivedQuantity: '0.00',
          unitCost: '0.00',
          amount: '0.00',
          remark: input.remark?.trim() || null,
          isTest: shop.isTest
        });
      }
      await tx.insert(warehouseTransferItems).values(lines);

      await recordDocumentEvent(tx, {
        documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
        documentId: header.id,
        fromStatus: DOCUMENT_NEW_STATE,
        toStatus: 'draft',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        isTest: shop.isTest,
        payload: {
          transferNo: header.transferNo,
          fromWarehouseId: header.fromWarehouseId,
          toShopId: header.toShopId,
          lineCount: lines.length
        }
      });
      return header;
    });

    return c.json({ item: await loadTransferDetail(created.id) }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'TRANSFER_NO_CONFLICT', message: '分拨单号冲突，请重试' }, 409);
    }
    throw error;
  }
});

warehouseTransferRoutes.get('/warehouse-transfers', async (c) => {
  const denied = await guardTransferRead(c);
  if (denied) return denied;

  const admin = c.get('admin');
  const db = await getDb();
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  /** 收货视角：mine 仅待我收货（已发出且责任人是自己）；shop 仅本店单据；all / 空为按数据范围取并集 */
  const receiptScope = c.req.query('receiptScope')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  if (status && !TRANSFER_STATUSES.includes(status as (typeof TRANSFER_STATUSES)[number])) {
    return c.json({ code: 'INVALID_STATUS', message: '分拨单状态不合法' }, 400);
  }
  if (receiptScope && !['mine', 'shop', 'all'].includes(receiptScope)) {
    return c.json({ code: 'INVALID_RECEIPT_SCOPE', message: '收货范围不合法' }, 400);
  }

  const conditions = [];
  const warehouseIds = await accessibleWarehouseIds(admin.sub);
  const shopIds = await accessibleShopIds(admin.sub);

  if (warehouseId) {
    if (warehouseIds !== null && !warehouseIds.includes(warehouseId)) {
      return c.json({ code: 'FORBIDDEN', message: '没有该仓库的查看权限' }, 403);
    }
    conditions.push(eq(warehouseTransfers.fromWarehouseId, warehouseId));
  }
  if (shopId) {
    if (!(await canAccessShop(admin.sub, shopId))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
    }
    conditions.push(eq(warehouseTransfers.toShopId, shopId));
  }
  if (!warehouseId && !shopId) {
    // 未指定筛选时按仓库可见范围与门店可见范围取并集。
    // null 表示该维度不限制（仅 super_admin）；门店维度未绑定门店时为空数组，不再视为全部门店可见。
    if (warehouseIds !== null && shopIds !== null) {
      if (warehouseIds.length === 0 && shopIds.length === 0) {
        return c.json({ items: [], total: 0, page, pageSize });
      }
      const scopes = [];
      if (warehouseIds.length > 0) {
        scopes.push(inArray(warehouseTransfers.fromWarehouseId, warehouseIds));
      }
      if (shopIds.length > 0) {
        scopes.push(inArray(warehouseTransfers.toShopId, shopIds));
      }
      conditions.push(or(...scopes)!);
    }
  }
  if (status) {
    conditions.push(eq(warehouseTransfers.status, status));
  }
  if (receiptScope === 'mine') {
    // 待我收货：责任人是自己且尚未收货（status=shipped 即已全部发出、未收货）
    conditions.push(eq(warehouseTransfers.receiverAdminId, admin.sub));
    conditions.push(eq(warehouseTransfers.status, 'shipped'));
  } else if (receiptScope === 'shop' && shopIds !== null) {
    // 本店全部：忽略仓库维度，只看绑定门店收到的单据
    if (shopIds.length === 0) {
      return c.json({ items: [], total: 0, page, pageSize });
    }
    conditions.push(inArray(warehouseTransfers.toShopId, shopIds));
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(warehouseTransfers.transferNo, `%${keyword}%`),
        ilike(shops.name, `%${keyword}%`),
        ilike(warehouses.name, `%${keyword}%`)
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: warehouseTransfers.id,
        transferNo: warehouseTransfers.transferNo,
        fromWarehouseId: warehouseTransfers.fromWarehouseId,
        fromWarehouseName: warehouses.name,
        fromWarehouseCode: warehouses.code,
        toShopId: warehouseTransfers.toShopId,
        toShopName: shops.name,
        status: warehouseTransfers.status,
        deliveryDate: warehouseTransfers.deliveryDate,
        receiverAdminId: warehouseTransfers.receiverAdminId,
        receiverName: receiverAdmin.displayName,
        receivedByAdminId: warehouseTransfers.receivedByAdminId,
        receivedByName: receivedByAdmin.displayName,
        receiveDueAt: warehouseTransfers.receiveDueAt,
        remark: warehouseTransfers.remark,
        isTest: warehouseTransfers.isTest,
        allocatedAt: warehouseTransfers.allocatedAt,
        shippedAt: warehouseTransfers.shippedAt,
        receivedAt: warehouseTransfers.receivedAt,
        differenceClosedAt: warehouseTransfers.differenceClosedAt,
        cancelledAt: warehouseTransfers.cancelledAt,
        createdAt: warehouseTransfers.createdAt,
        updatedAt: warehouseTransfers.updatedAt,
        itemCount: sql<number>`(
          select count(*) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        )::int`,
        requestedTotal: sql<string>`coalesce((
          select sum(i.requested_quantity) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        ), 0)::text`,
        shippedTotal: sql<string>`coalesce((
          select sum(i.shipped_quantity) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        ), 0)::text`,
        receivedTotal: sql<string>`coalesce((
          select sum(i.received_quantity) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        ), 0)::text`,
        lossTotal: sql<string>`coalesce((
          select sum(i.loss_quantity) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        ), 0)::text`,
        lossAmountTotal: sql<string>`coalesce((
          select sum(i.loss_amount) from warehouse_transfer_items i
          where i.transfer_id = warehouse_transfers.id
        ), 0)::text`
      })
      .from(warehouseTransfers)
      .innerJoin(warehouses, eq(warehouses.id, warehouseTransfers.fromWarehouseId))
      .innerJoin(shops, eq(shops.id, warehouseTransfers.toShopId))
      .leftJoin(receiverAdmin, eq(receiverAdmin.id, warehouseTransfers.receiverAdminId))
      .leftJoin(receivedByAdmin, eq(receivedByAdmin.id, warehouseTransfers.receivedByAdminId))
      .where(where)
      .orderBy(desc(warehouseTransfers.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(warehouseTransfers)
      .innerJoin(warehouses, eq(warehouses.id, warehouseTransfers.fromWarehouseId))
      .innerJoin(shops, eq(shops.id, warehouseTransfers.toShopId))
      .where(where)
  ]);

  const now = Date.now();
  return c.json({
    items: items.map((item) => ({
      ...item,
      statusLabel: STATUS_LABELS[item.status] ?? item.status,
      overdue:
        item.status === 'shipped' &&
        item.receiveDueAt !== null &&
        item.receiveDueAt.getTime() < now
    })),
    total: totalRows[0]?.total ?? 0,
    page,
    pageSize
  });
});

/**
 * 新建分拨单的可选规格：按来源仓的可用库存（quantity - reserved_qty）返回，
 * 并带上门店 SKU 映射状态，供前端直接禁用未映射或在门店不可售的规格。
 */
warehouseTransferRoutes.get('/warehouse-transfers/options', async (c) => {
  const admin = c.get('admin');
  const allowed =
    (await checkPermission(admin.sub, 'warehouse.read')) ||
    (await checkPermission(admin.sub, 'warehouse.write'));
  if (!allowed) return c.json({ code: 'FORBIDDEN', message: '缺少权限：warehouse.read' }, 403);

  const warehouseId = c.req.query('warehouseId')?.trim();
  const shopId = c.req.query('shopId')?.trim();
  if (!warehouseId || !shopId) {
    return c.json({ code: 'INVALID_QUERY', message: '需要 warehouseId 与 shopId' }, 400);
  }
  if (!(await canAccessWarehouse(admin.sub, warehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的分拨权限' }, 403);
  }

  const db = await getDb();
  const [warehouse] = await db
    .select({ id: warehouses.id, name: warehouses.name, status: warehouses.status })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) return c.json({ code: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' }, 404);
  if (warehouse.status !== 'active') {
    return c.json({ code: 'WAREHOUSE_DISABLED', message: '仓库已停用，不能分拨' }, 409);
  }

  const [shop] = await db
    .select({ id: shops.id, name: shops.name, isTest: shops.isTest })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在' }, 404);

  const [stockRows, mappings] = await Promise.all([
    db
      .select({
        catalogSkuId: catalogSkus.id,
        catalogProductId: catalogProducts.id,
        productName: catalogProducts.name,
        specName: catalogSkus.specName,
        unit: catalogSkus.unit,
        quantity: warehouseStocks.quantity,
        reservedQuantity: warehouseStocks.reservedQty,
        avgUnitCost: warehouseStocks.avgUnitCost,
        minThreshold: warehouseStocks.minThreshold,
        maxThreshold: warehouseStocks.maxThreshold
      })
      .from(warehouseStocks)
      .innerJoin(catalogSkus, eq(catalogSkus.id, warehouseStocks.skuId))
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
      .where(
        and(
          eq(warehouseStocks.warehouseId, warehouseId),
          eq(warehouseStocks.isTest, shop.isTest),
          eq(catalogSkus.status, 'active'),
          eq(catalogProducts.status, 'published')
        )
      )
      .orderBy(asc(catalogProducts.name), asc(catalogSkus.specName)),
    db
      .select({ catalogSkuId: productSkus.catalogSkuId, id: productSkus.id })
      .from(productSkus)
      .where(and(eq(productSkus.shopId, shopId), eq(productSkus.isAvailable, true)))
  ]);

  const mapping = new Map(mappings.map((row) => [row.catalogSkuId, row.id]));
  return c.json({
    warehouse,
    shop,
    items: stockRows.map((row) => {
      const availableCents = Math.max(
        cents(row.quantity) - cents(row.reservedQuantity),
        0
      );
      const productSkuId = mapping.get(row.catalogSkuId) ?? null;
      return {
        ...row,
        quantity: formatQty(cents(row.quantity)),
        reservedQuantity: formatQty(cents(row.reservedQuantity)),
        availableQuantity: formatQty(availableCents),
        minThreshold: formatQty(cents(row.minThreshold)),
        maxThreshold: row.maxThreshold === null ? null : formatQty(cents(row.maxThreshold)),
        // 只提示不阻断：新建分拨单时可用量低于下限的规格标记「低库存」
        lowStock: availableCents <= cents(row.minThreshold),
        productSkuId,
        mapped: Boolean(productSkuId)
      };
    })
  });
});

/** 发货弹窗的候选收货人：目标门店绑定的店长（启用中）。 */
warehouseTransferRoutes.get('/warehouse-transfers/receivers', async (c) => {
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: '缺少门店参数' }, 400);

  const rows = await resolveShopReceivers(shopId);
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName
    }))
  });
});

/* -------------------------------------------------------------------------- */
/* 计划联动：已审核要货单 → 按门店生成草稿分拨单                                  */
/* -------------------------------------------------------------------------- */
const FROM_DEMAND_SCOPE = 'warehouse_transfer_from_demand';

const fromDemandSchema = z.object({
  warehouseId: z.uuid('仓库 ID 不合法'),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '交付日期格式应为 YYYY-MM-DD'),
  shopId: z.uuid('门店 ID 不合法').nullish(),
  /** 默认只取已审核；传 false 时连同已提交一并汇总 */
  onlyApproved: z.boolean().optional()
});

type FromDemandInput = z.infer<typeof fromDemandSchema>;

type FromDemandLine = {
  catalogSkuId: string;
  productSkuId: string;
  productName: string;
  specName: string | null;
  unit: string;
  requestedQuantity: string;
  availableQuantity: string;
  gapQuantity: string;
  hasGap: boolean;
  stockMissing: boolean;
};

type FromDemandUnmappable = {
  productSkuId: string;
  itemName: string;
  specName: string | null;
  unit: string;
  requestedQuantity: string;
  reasonCode: string;
  reason: string;
};

type FromDemandShopPlan = {
  shopId: string;
  shopName: string;
  shopIsTest: boolean;
  action: 'created' | 'reused' | 'skipped';
  transferId: string | null;
  transferNo: string | null;
  reasonCode: string | null;
  reason: string | null;
  requisitionNos: string[];
  lines: FromDemandLine[];
  unmappable: FromDemandUnmappable[];
  lineCount: number;
  requestedTotal: string;
  availableTotal: string;
  gapTotal: string;
};

const FROM_DEMAND_SKIP_LABELS: Record<string, string> = {
  TRANSFER_IN_PROGRESS: '当日已有已分配/已发出的分拨单，跳过以避免改动在途数量',
  DRAFT_ALLOCATED: '当日草稿已部分分配，不能自动更新数量，请手工处理',
  NO_MAPPABLE_ITEMS: '要货明细均无法映射到门店 SKU，未生成草稿'
};

/**
 * 计算「要货单 → 草稿分拨单」的计划，预览与正式生成共用同一逻辑。
 * - 单位：同一门店 + 同一交付日聚合该门店全部已审核（或已提交）要货明细；
 * - 数量：取要货明细的申请数量 requested_qty；
 * - 映射：门店 SKU → 总部规格沿用 resolveTransferSkuMapping，未映射的明细只进「无法生成」清单；
 * - 可用量：warehouse_stocks 的 quantity - reserved_qty，不足时只记缺口，不阻断建草稿；
 * - 去重：同门店 + 同交付日已有未分配草稿时复用该草稿；已有已分配/已发出单据时跳过。
 */
async function buildFromDemandPlan(
  dbc: DbLike,
  params: FromDemandInput & { onlyApproved: boolean; adminId: string }
): Promise<FromDemandShopPlan[]> {
  const d = dbc as Db;
  const statuses = params.onlyApproved ? ['approved'] : ['approved', 'submitted'];
  const conditions = [
    eq(shopRequisitions.expectedDate, params.deliveryDate),
    inArray(shopRequisitions.status, statuses)
  ];
  if (params.shopId) {
    conditions.push(eq(shopRequisitions.shopId, params.shopId));
  } else {
    const ids = await accessibleShopIds(params.adminId);
    if (ids !== null) {
      if (ids.length === 0) return [];
      conditions.push(inArray(shopRequisitions.shopId, ids));
    }
  }

  const headers = await d
    .select({
      id: shopRequisitions.id,
      requisitionNo: shopRequisitions.requisitionNo,
      shopId: shopRequisitions.shopId,
      shopName: shops.name,
      shopIsTest: shops.isTest,
      createdAt: shopRequisitions.createdAt
    })
    .from(shopRequisitions)
    .innerJoin(shops, eq(shops.id, shopRequisitions.shopId))
    .where(and(...conditions))
    .orderBy(asc(shops.name), asc(shopRequisitions.createdAt));
  if (headers.length === 0) return [];

  const byShop = new Map<string, typeof headers>();
  for (const header of headers) {
    const list = byShop.get(header.shopId) ?? [];
    list.push(header);
    byShop.set(header.shopId, list);
  }

  const planned: FromDemandShopPlan[] = [];

  for (const [shopId, list] of byShop) {
    const shop = list[0];
    const requisitionIds = list.map((row) => row.id);
    const requisitionNoById = new Map(list.map((row) => [row.id, row.requisitionNo]));

    const rawItems = await d
      .select({
        requisitionId: shopRequisitionItems.requisitionId,
        productSkuId: shopRequisitionItems.productSkuId,
        catalogSkuId: shopRequisitionItems.catalogSkuId,
        itemName: shopRequisitionItems.itemName,
        specName: shopRequisitionItems.specName,
        unit: shopRequisitionItems.unit,
        requestedQty: shopRequisitionItems.requestedQty
      })
      .from(shopRequisitionItems)
      .where(inArray(shopRequisitionItems.requisitionId, requisitionIds));

    // 同一门店可能有多张要货单（如已审核后撤回再提交），按总部规格聚合申请数量
    type Grouped = {
      catalogSkuId: string | null;
      productSkuId: string;
      itemName: string;
      specName: string | null;
      unit: string;
      requestedCents: number;
    };
    const grouped = new Map<string, Grouped>();
    for (const item of rawItems) {
      const key = item.catalogSkuId ?? `product:${item.productSkuId}`;
      const cents = Math.round(Number(item.requestedQty) * 100);
      const existing = grouped.get(key);
      if (existing) {
        existing.requestedCents += cents;
      } else {
        grouped.set(key, {
          catalogSkuId: item.catalogSkuId,
          productSkuId: item.productSkuId,
          itemName: item.itemName,
          specName: item.specName,
          unit: item.unit,
          requestedCents: cents
        });
      }
    }

    const catalogSkuIds = [...grouped.values()]
      .map((row) => row.catalogSkuId)
      .filter((id): id is string => Boolean(id));

    const [stockRows, existingTransfers] = await Promise.all([
      catalogSkuIds.length > 0
        ? d
            .select({
              skuId: warehouseStocks.skuId,
              quantity: warehouseStocks.quantity,
              reservedQty: warehouseStocks.reservedQty,
              isTest: warehouseStocks.isTest
            })
            .from(warehouseStocks)
            .where(
              and(
                eq(warehouseStocks.warehouseId, params.warehouseId),
                inArray(warehouseStocks.skuId, catalogSkuIds)
              )
            )
        : Promise.resolve([] as Array<{ skuId: string; quantity: string; reservedQty: string; isTest: boolean }>),
      d
        .select({
          id: warehouseTransfers.id,
          transferNo: warehouseTransfers.transferNo,
          status: warehouseTransfers.status,
          createdAt: warehouseTransfers.createdAt
        })
        .from(warehouseTransfers)
        .where(
          and(
            eq(warehouseTransfers.toShopId, shopId),
            eq(warehouseTransfers.deliveryDate, params.deliveryDate),
            inArray(warehouseTransfers.status, ['draft', 'allocated', 'shipped'])
          )
        )
        .orderBy(desc(warehouseTransfers.createdAt))
    ]);

    const stockMap = new Map(
      stockRows.filter((row) => row.isTest === shop.shopIsTest).map((row) => [row.skuId, row])
    );

    const lines: FromDemandLine[] = [];
    const unmappable: FromDemandUnmappable[] = [];

    for (const entry of grouped.values()) {
      if (!entry.catalogSkuId) {
        unmappable.push({
          productSkuId: entry.productSkuId,
          itemName: entry.itemName,
          specName: entry.specName,
          unit: entry.unit,
          requestedQuantity: formatQty(entry.requestedCents),
          reasonCode: 'SKU_WITHOUT_CATALOG',
          reason: '门店规格未关联总部规格，无法生成分拨明细'
        });
        continue;
      }
      let mapping: { catalogSkuId: string; productSkuId: string };
      try {
        mapping = await resolveTransferSkuMapping(d, {
          shopId,
          catalogSkuId: entry.catalogSkuId
        });
      } catch (error) {
        if (error instanceof DocumentRuleError) {
          unmappable.push({
            productSkuId: entry.productSkuId,
            itemName: entry.itemName,
            specName: entry.specName,
            unit: entry.unit,
            requestedQuantity: formatQty(entry.requestedCents),
            reasonCode: error.code,
            reason: error.message
          });
          continue;
        }
        throw error;
      }

      const [catalog] = await d
        .select({
          productName: catalogProducts.name,
          specName: catalogSkus.specName,
          unit: catalogSkus.unit
        })
        .from(catalogSkus)
        .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
        .where(eq(catalogSkus.id, mapping.catalogSkuId))
        .limit(1);

      const stock = stockMap.get(mapping.catalogSkuId);
      const availableCents = stock
        ? Math.max(
            Math.round(Number(stock.quantity) * 100) -
              Math.round(Number(stock.reservedQty) * 100),
            0
          )
        : 0;
      const gapCents = Math.max(entry.requestedCents - availableCents, 0);

      lines.push({
        catalogSkuId: mapping.catalogSkuId,
        productSkuId: mapping.productSkuId,
        productName: catalog?.productName ?? entry.itemName,
        specName: catalog?.specName ?? entry.specName,
        unit: catalog?.unit ?? entry.unit,
        requestedQuantity: formatQty(entry.requestedCents),
        availableQuantity: formatQty(availableCents),
        gapQuantity: formatQty(gapCents),
        hasGap: gapCents > 0,
        stockMissing: !stock
      });
    }

    lines.sort((a, b) => a.productName.localeCompare(b.productName, 'zh-Hans-CN'));

    const inProgress = existingTransfers.find(
      (row) => row.status === 'allocated' || row.status === 'shipped'
    );
    const draft = existingTransfers.find((row) => row.status === 'draft');
    let draftAllocated = false;
    if (draft) {
      const [allocatedRow] = await d
        .select({
          total: sql<string>`coalesce(sum(${warehouseTransferItems.allocatedQuantity}), 0)::text`
        })
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, draft.id));
      draftAllocated = Number(allocatedRow?.total ?? 0) > 0;
    }

    let action: FromDemandShopPlan['action'] = 'created';
    let reasonCode: string | null = null;
    let reason: string | null = null;
    let transferId: string | null = null;
    let transferNo: string | null = null;

    if (lines.length === 0) {
      action = 'skipped';
      reasonCode = 'NO_MAPPABLE_ITEMS';
      reason = FROM_DEMAND_SKIP_LABELS.NO_MAPPABLE_ITEMS;
    } else if (draft && !draftAllocated) {
      action = 'reused';
      transferId = draft.id;
      transferNo = draft.transferNo;
    } else if (draft && draftAllocated) {
      action = 'skipped';
      reasonCode = 'DRAFT_ALLOCATED';
      reason = FROM_DEMAND_SKIP_LABELS.DRAFT_ALLOCATED;
    } else if (inProgress) {
      action = 'skipped';
      reasonCode = 'TRANSFER_IN_PROGRESS';
      reason = FROM_DEMAND_SKIP_LABELS.TRANSFER_IN_PROGRESS;
    }

    const requestedCents = lines.reduce(
      (acc, line) => acc + Math.round(Number(line.requestedQuantity) * 100),
      0
    );
    const availableTotalCents = lines.reduce(
      (acc, line) => acc + Math.round(Number(line.availableQuantity) * 100),
      0
    );
    const gapTotalCents = lines.reduce(
      (acc, line) => acc + Math.round(Number(line.gapQuantity) * 100),
      0
    );

    planned.push({
      shopId,
      shopName: shop.shopName,
      shopIsTest: shop.shopIsTest,
      action,
      transferId,
      transferNo,
      reasonCode,
      reason,
      requisitionNos: [...new Set(list.map((row) => requisitionNoById.get(row.id)!))],
      lines,
      unmappable,
      lineCount: lines.length,
      requestedTotal: formatQty(requestedCents),
      availableTotal: formatQty(availableTotalCents),
      gapTotal: formatQty(gapTotalCents)
    });
  }

  return planned;
}

function summarizeFromDemandPlan(shops: FromDemandShopPlan[]) {
  const count = (action: FromDemandShopPlan['action']) =>
    shops.filter((shop) => shop.action === action).length;
  const sum = (key: 'requestedTotal' | 'gapTotal') =>
    shops.reduce((acc, shop) => acc + Math.round(Number(shop[key]) * 100), 0);
  return {
    shopCount: shops.length,
    createdCount: count('created'),
    reusedCount: count('reused'),
    skippedCount: count('skipped'),
    lineCount: shops.reduce((acc, shop) => acc + shop.lines.length, 0),
    gapLineCount: shops.reduce(
      (acc, shop) => acc + shop.lines.filter((line) => line.hasGap).length,
      0
    ),
    unmappableCount: shops.reduce((acc, shop) => acc + shop.unmappable.length, 0),
    requestedTotal: formatQty(sum('requestedTotal')),
    gapTotal: formatQty(sum('gapTotal'))
  };
}

/** 解析请求体与权限，预览和生成共用；返回错误响应或参数 */
async function parseFromDemandRequest(c: Context<AdminEnv>) {
  const rawBody = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = fromDemandSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      error: c.json(
        { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
        400
      )
    };
  }

  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return { error: denied };

  const admin = c.get('admin');
  if (!(await canAccessWarehouse(admin.sub, parsed.data.warehouseId))) {
    return { error: c.json({ code: 'FORBIDDEN', message: '没有该仓库的分拨权限' }, 403) };
  }
  if (parsed.data.shopId && !(await canAccessShop(admin.sub, parsed.data.shopId))) {
    return { error: c.json({ code: 'FORBIDDEN', message: '没有该门店的操作权限' }, 403) };
  }

  const db = await getDb();
  const [warehouse] = await db
    .select({ id: warehouses.id, name: warehouses.name, status: warehouses.status })
    .from(warehouses)
    .where(eq(warehouses.id, parsed.data.warehouseId))
    .limit(1);
  if (!warehouse) {
    return { error: c.json({ code: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' }, 404) };
  }
  if (warehouse.status !== 'active') {
    return {
      error: c.json({ code: 'WAREHOUSE_DISABLED', message: '仓库已停用，不能生成分拨单' }, 409)
    };
  }

  return {
    admin,
    warehouse,
    input: parsed.data,
    rawBody,
    onlyApproved: parsed.data.onlyApproved ?? true
  };
}

/** 预览：只计算计划，不落库；供 admin「从要货生成」弹窗确认前查看 */
warehouseTransferRoutes.post('/warehouse-transfers/from-demand/preview', async (c) => {
  const parsed = await parseFromDemandRequest(c);
  if ('error' in parsed) return parsed.error;

  const db = await getDb();
  const shopsPlan = await buildFromDemandPlan(db, {
    ...parsed.input,
    onlyApproved: parsed.onlyApproved,
    adminId: parsed.admin.sub
  });

  return c.json({
    preview: true,
    warehouse: parsed.warehouse,
    deliveryDate: parsed.input.deliveryDate,
    onlyApproved: parsed.onlyApproved,
    summary: summarizeFromDemandPlan(shopsPlan),
    shops: shopsPlan
  });
});

/**
 * 正式生成：一次事务内完成所有门店的「新建 / 复用」。
 * - 幂等：Idempotency-Key（或 body.idempotencyKey），scope=warehouse_transfer_from_demand，
 *   重放返回相同结果，内容不一致返回 409；
 * - 去重：复用同日同门店的未分配草稿并更新数量，已分配/已发出则跳过（见 buildFromDemandPlan）。
 */
warehouseTransferRoutes.post('/warehouse-transfers/from-demand', async (c) => {
  const parsed = await parseFromDemandRequest(c);
  if ('error' in parsed) return parsed.error;

  const admin = parsed.admin;
  const db = await getDb();
  const bodyKey = parsed.rawBody?.idempotencyKey;
  const idempotencyKey =
    c.req.header('Idempotency-Key')?.trim() ||
    (typeof bodyKey === 'string' && bodyKey.trim()) ||
    null;
  const requestHash = hashIdempotencyRequest({
    warehouseId: parsed.input.warehouseId,
    deliveryDate: parsed.input.deliveryDate,
    shopId: parsed.input.shopId ?? null,
    onlyApproved: parsed.onlyApproved
  });

  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: FROM_DEMAND_SCOPE,
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') {
      return c.json(acquired.response ?? { ok: true, replayed: true });
    }
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'FROM_DEMAND_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该生成请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致，请更换幂等键'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const response = await db.transaction(async (tx) => {
      const shopsPlan = await buildFromDemandPlan(tx, {
        ...parsed.input,
        onlyApproved: parsed.onlyApproved,
        adminId: admin.sub
      });

      for (const shop of shopsPlan) {
        if (shop.action === 'skipped') continue;

        if (shop.action === 'created') {
          const [header] = await tx
            .insert(warehouseTransfers)
            .values({
              transferNo: generateDocumentNo(WAREHOUSE_TRANSFER_NO_PREFIX),
              fromWarehouseId: parsed.input.warehouseId,
              toShopId: shop.shopId,
              status: 'draft',
              deliveryDate: parsed.input.deliveryDate,
              requestedByAdminId: admin.sub,
              remark: `由要货单 ${shop.requisitionNos.join('、')} 生成`.slice(0, 500),
              isTest: shop.shopIsTest
            })
            .returning();
          await tx.insert(warehouseTransferItems).values(
            shop.lines.map((line) => ({
              transferId: header.id,
              catalogSkuId: line.catalogSkuId,
              productSkuId: line.productSkuId,
              requestedQuantity: line.requestedQuantity,
              allocatedQuantity: '0.00',
              shippedQuantity: '0.00',
              receivedQuantity: '0.00',
              unitCost: '0.00',
              amount: '0.00',
              isTest: shop.shopIsTest
            }))
          );
          await recordDocumentEvent(tx, {
            documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
            documentId: header.id,
            fromStatus: DOCUMENT_NEW_STATE,
            toStatus: 'draft',
            operatorAdminId: admin.sub,
            operatorName: admin.username,
            isTest: shop.shopIsTest,
            payload: {
              source: 'shop_requisition',
              requisitionNos: shop.requisitionNos,
              deliveryDate: parsed.input.deliveryDate,
              lineCount: shop.lines.length,
              gapLines: shop.lines
                .filter((line) => line.hasGap)
                .map((line) => ({
                  catalogSkuId: line.catalogSkuId,
                  requestedQuantity: line.requestedQuantity,
                  availableQuantity: line.availableQuantity,
                  gapQuantity: line.gapQuantity
                })),
              unmappableCount: shop.unmappable.length
            }
          });
          shop.transferId = header.id;
          shop.transferNo = header.transferNo;
          continue;
        }

        // reused：复用当日未分配草稿，按要货数量整体刷新明细
        const transferId = shop.transferId!;
        const existingItems = await tx
          .select({
            id: warehouseTransferItems.id,
            catalogSkuId: warehouseTransferItems.catalogSkuId
          })
          .from(warehouseTransferItems)
          .where(eq(warehouseTransferItems.transferId, transferId));
        const existingBySku = new Map(existingItems.map((row) => [row.catalogSkuId, row.id]));

        for (const line of shop.lines) {
          const existingId = existingBySku.get(line.catalogSkuId);
          if (existingId) {
            await tx
              .update(warehouseTransferItems)
              .set({
                productSkuId: line.productSkuId,
                requestedQuantity: line.requestedQuantity,
                updatedAt: new Date()
              })
              .where(eq(warehouseTransferItems.id, existingId));
          } else {
            await tx.insert(warehouseTransferItems).values({
              transferId,
              catalogSkuId: line.catalogSkuId,
              productSkuId: line.productSkuId,
              requestedQuantity: line.requestedQuantity,
              allocatedQuantity: '0.00',
              shippedQuantity: '0.00',
              receivedQuantity: '0.00',
              unitCost: '0.00',
              amount: '0.00',
              isTest: shop.shopIsTest
            });
          }
        }

        const keepSkuIds = shop.lines.map((line) => line.catalogSkuId);
        await tx
          .delete(warehouseTransferItems)
          .where(
            and(
              eq(warehouseTransferItems.transferId, transferId),
              notInArray(warehouseTransferItems.catalogSkuId, keepSkuIds)
            )
          );

        await tx
          .update(warehouseTransfers)
          .set({ updatedAt: new Date() })
          .where(eq(warehouseTransfers.id, transferId));

        await recordDocumentEvent(tx, {
          documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
          documentId: transferId,
          fromStatus: 'draft',
          toStatus: 'draft',
          operatorAdminId: admin.sub,
          operatorName: admin.username,
          reason: '由要货单重新生成并更新数量',
          isTest: shop.shopIsTest,
          payload: {
            source: 'shop_requisition',
            requisitionNos: shop.requisitionNos,
            deliveryDate: parsed.input.deliveryDate,
            lineCount: shop.lines.length,
            gapTotal: shop.gapTotal,
            unmappableCount: shop.unmappable.length
          }
        });
      }

      return {
        preview: false,
        replayed: false,
        warehouse: parsed.warehouse,
        deliveryDate: parsed.input.deliveryDate,
        onlyApproved: parsed.onlyApproved,
        summary: summarizeFromDemandPlan(shopsPlan),
        shops: shopsPlan
      };
    });

    if (acquiredKey) await completeIdempotencyKey(db, acquiredKey, response);
    return c.json(response);
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    if (isUniqueViolation(error)) {
      return c.json(
        {
          code: 'TRANSFER_DRAFT_CONFLICT',
          message: '该门店当日草稿已存在（可能由并发请求创建），请刷新后重试'
        },
        409
      );
    }
    throw error;
  }
});

warehouseTransferRoutes.get('/warehouse-transfers/:id', async (c) => {
  const denied = await guardTransferRead(c);
  if (denied) return denied;

  const detail = await loadTransferDetail(c.req.param('id'));
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);

  const admin = c.get('admin');
  const warehouseVisible = await canAccessWarehouse(admin.sub, detail.fromWarehouseId);
  const shopVisible = await canAccessShop(admin.sub, detail.toShopId);
  if (!warehouseVisible && !shopVisible) {
    return c.json({ code: 'FORBIDDEN', message: '没有该分拨单的查看权限' }, 403);
  }

  return c.json({ item: detail });
});

const allocateSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.uuid('分拨明细 ID 不合法'),
        /** 本行累计分配数量（绝对量），允许小于申请量表示部分分配 */
        allocatedQuantity: z.union([z.string(), z.number()])
      })
    )
    .min(1, '至少一条分配明细')
    .max(200),
  remark: z.string().trim().max(500).nullish()
});

warehouseTransferRoutes.post('/warehouse-transfers/:id/allocate', async (c) => {
  const parsed = allocateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const admin = c.get('admin');
  const id = c.req.param('id');
  const db = await getDb();
  const [header] = await db
    .select({ id: warehouseTransfers.id, fromWarehouseId: warehouseTransfers.fromWarehouseId })
    .from(warehouseTransfers)
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);
  if (!(await canAccessWarehouse(admin.sub, header.fromWarehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的分拨权限' }, 403);
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(warehouseTransfers)
      .where(eq(warehouseTransfers.id, id))
      .for('update');
    if (!locked) throw new DocumentRuleError('NOT_FOUND', '分拨单不存在', 404);
    if (locked.status !== 'draft') {
      throw new DocumentRuleError(
        'TRANSFER_NOT_ALLOCATABLE',
        `只有草稿状态的分拨单可以分配，当前为「${STATUS_LABELS[locked.status] ?? locked.status}」`,
        409
      );
    }

    const items = await tx
      .select()
      .from(warehouseTransferItems)
      .where(eq(warehouseTransferItems.transferId, id))
      .orderBy(asc(warehouseTransferItems.catalogSkuId))
      .for('update');
    const itemMap = new Map(items.map((item) => [item.id, item]));

    let changed = false;
    for (const input of parsed.data.items) {
      const item = itemMap.get(input.itemId);
      if (!item) {
        throw new DocumentRuleError('TRANSFER_ITEM_MISMATCH', '存在不属于该分拨单的明细', 400);
      }
      const currentCents = cents(item.allocatedQuantity);
      const requestedCents = cents(item.requestedQuantity);
      const nextCents = nonNegativeCents(input.allocatedQuantity, '分配数量');
      if (nextCents > requestedCents) {
        throw new DocumentRuleError(
          'TRANSFER_ALLOCATE_EXCEEDS_REQUEST',
          `分配数量不能超过申请数量：申请 ${item.requestedQuantity}，本次分配 ${formatQty(nextCents)}`,
          409
        );
      }
      if (nextCents === currentCents) continue;

      if (nextCents > currentCents) {
        // 只有真正增加分配时才解析门店映射并占用预留
        const mapping = await resolveTransferSkuMapping(tx, {
          shopId: locked.toShopId,
          catalogSkuId: item.catalogSkuId
        });
        await reserveWarehouseStock(tx, {
          warehouseId: locked.fromWarehouseId,
          skuId: item.catalogSkuId,
          quantity: formatQty(nextCents - currentCents),
          isTest: locked.isTest
        });
        const [stock] = await tx
          .select({ avgUnitCost: warehouseStocks.avgUnitCost })
          .from(warehouseStocks)
          .where(
            and(
              eq(warehouseStocks.warehouseId, locked.fromWarehouseId),
              eq(warehouseStocks.skuId, item.catalogSkuId)
            )
          )
          .limit(1);
        const unitCost = stock?.avgUnitCost ?? '0.00';
        await tx
          .update(warehouseTransferItems)
          .set({
            allocatedQuantity: formatQty(nextCents),
            productSkuId: mapping.productSkuId,
            unitCost,
            amount: amountOf(nextCents, unitCost),
            updatedAt: new Date()
          })
          .where(eq(warehouseTransferItems.id, item.id));
      } else {
        await releaseWarehouseReservation(tx, {
          warehouseId: locked.fromWarehouseId,
          skuId: item.catalogSkuId,
          quantity: formatQty(currentCents - nextCents),
          isTest: locked.isTest
        });
        await tx
          .update(warehouseTransferItems)
          .set({
            allocatedQuantity: formatQty(nextCents),
            amount: amountOf(nextCents, item.unitCost),
            updatedAt: new Date()
          })
          .where(eq(warehouseTransferItems.id, item.id));
      }
      changed = true;
    }

    if (!changed) {
      throw new DocumentRuleError(
        'TRANSFER_ALLOCATE_UNCHANGED',
        '本次没有调整任何分配数量',
        409
      );
    }

    const refreshed = await tx
      .select({
        requestedQuantity: warehouseTransferItems.requestedQuantity,
        allocatedQuantity: warehouseTransferItems.allocatedQuantity
      })
      .from(warehouseTransferItems)
      .where(eq(warehouseTransferItems.transferId, id));
    const fullyAllocated =
      refreshed.length > 0 &&
      refreshed.every((row) => cents(row.allocatedQuantity) >= cents(row.requestedQuantity));
    const nextStatus: WarehouseTransferStatus = fullyAllocated ? 'allocated' : 'draft';
    if (fullyAllocated) {
      assertWarehouseTransferTransition(locked.status, 'allocated');
    }

    await tx
      .update(warehouseTransfers)
      .set({
        status: nextStatus,
        handledByAdminId: admin.sub,
        allocatedAt: fullyAllocated ? new Date() : locked.allocatedAt,
        updatedAt: new Date()
      })
      .where(eq(warehouseTransfers.id, id));

    await recordDocumentEvent(tx, {
      documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
      documentId: id,
      fromStatus: locked.status,
      toStatus: nextStatus,
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      reason: fullyAllocated ? null : '部分分配',
      payload: {
        transferNo: locked.transferNo,
        fullyAllocated,
        lines: parsed.data.items.map((input) => ({
          itemId: input.itemId,
          allocatedQuantity: formatQty(nonNegativeCents(input.allocatedQuantity, '分配数量'))
        }))
      },
      isTest: locked.isTest
    });
  });

  return c.json({ item: await loadTransferDetail(id) });
});

const shipSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.uuid('分拨明细 ID 不合法'),
        /** 本行累计发出数量（绝对量），多次部分发货时需大于上次 */
        shippedQuantity: z.union([z.string(), z.number()])
      })
    )
    .min(1, '至少一条发货明细')
    .max(200),
  /** 收货责任人：为空时按目标门店店长自动推导；显式传入则校验后写入 */
  receiverAdminId: z.uuid('收货责任人 ID 不合法').nullish(),
  remark: z.string().trim().max(500).nullish(),
  idempotencyKey: z.string().trim().max(120).nullish()
});

warehouseTransferRoutes.post('/warehouse-transfers/:id/ship', async (c) => {
  const parsed = shipSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const admin = c.get('admin');
  const id = c.req.param('id');
  const db = await getDb();
  const [header] = await db
    .select({
      id: warehouseTransfers.id,
      fromWarehouseId: warehouseTransfers.fromWarehouseId,
      toShopId: warehouseTransfers.toShopId,
      transferNo: warehouseTransfers.transferNo
    })
    .from(warehouseTransfers)
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);
  if (!(await canAccessWarehouse(admin.sub, header.fromWarehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的发货权限' }, 403);
  }

  const requestHash = hashIdempotencyRequest({
    transferId: id,
    kind: 'ship',
    items: parsed.data.items,
    receiverAdminId: parsed.data.receiverAdminId ?? null,
    remark: parsed.data.remark ?? null
  });
  const idempotencyKey =
    c.req.header('Idempotency-Key')?.trim() || parsed.data.idempotencyKey?.trim() || null;
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'warehouse_transfer_ship',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') {
      return c.json(acquired.response ?? { ok: true, replayed: true });
    }
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'TRANSFER_SHIP_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该发货请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致，请更换幂等键'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(warehouseTransfers)
        .where(eq(warehouseTransfers.id, id))
        .for('update');
      if (!locked) throw new DocumentRuleError('NOT_FOUND', '分拨单不存在', 404);
      if (locked.status === 'shipped') {
        throw new DocumentRuleError('TRANSFER_ALREADY_SHIPPED', '该分拨单已全部发出，请勿重复发货', 409);
      }
      if (locked.status === 'received') {
        throw new DocumentRuleError('TRANSFER_ALREADY_RECEIVED', '该分拨单已收货，不能再次发货', 409);
      }
      if (locked.status === 'cancelled') {
        throw new DocumentRuleError('TRANSFER_CANCELLED', '该分拨单已取消，不能发货', 409);
      }
      if (locked.status !== 'allocated') {
        throw new DocumentRuleError('TRANSFER_NOT_ALLOCATED', '请先完成分配后再发货', 409);
      }

      // 收货责任人：显式指定则校验必须是该门店启用的店长；未指定时按门店自动推导。
      // 该门店没有绑定店长时留空，不阻断发货。
      const candidates = await resolveShopReceivers(locked.toShopId, tx);
      let receiverAdminId: string | null = locked.receiverAdminId;
      if (parsed.data.receiverAdminId) {
        if (!candidates.some((row) => row.id === parsed.data.receiverAdminId)) {
          throw new DocumentRuleError(
            'TRANSFER_RECEIVER_INVALID',
            '收货责任人必须是该门店绑定的店长',
            400
          );
        }
        receiverAdminId = parsed.data.receiverAdminId;
      } else if (!receiverAdminId) {
        receiverAdminId = candidates[0]?.id ?? null;
      }

      const items = await tx
        .select()
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, id))
        .orderBy(asc(warehouseTransferItems.catalogSkuId))
        .for('update');
      const itemMap = new Map(items.map((item) => [item.id, item]));

      let totalDeltaCents = 0;
      const deltaLines: Array<{ itemId: string; shippedQuantity: string; delta: string }> = [];

      for (const input of parsed.data.items) {
        const item = itemMap.get(input.itemId);
        if (!item) {
          throw new DocumentRuleError('TRANSFER_ITEM_MISMATCH', '存在不属于该分拨单的明细', 400);
        }
        const currentCents = cents(item.shippedQuantity);
        const allocatedCents = cents(item.allocatedQuantity);
        const nextCents = nonNegativeCents(input.shippedQuantity, '发出数量');
        if (nextCents < currentCents) {
          throw new DocumentRuleError(
            'TRANSFER_SHIP_QUANTITY_DECREASED',
            `发出数量不能小于已发出数量（已发 ${item.shippedQuantity}）`,
            409
          );
        }
        if (nextCents > allocatedCents) {
          throw new DocumentRuleError(
            'TRANSFER_SHIP_EXCEEDS_ALLOCATED',
            `发出数量不能超过分配数量：分配 ${item.allocatedQuantity}，本次发出 ${formatQty(nextCents)}`,
            409
          );
        }
        const delta = nextCents - currentCents;
        if (delta === 0) continue;

        const shipped = await shipReservedWarehouseStock(tx, {
          warehouseId: locked.fromWarehouseId,
          skuId: item.catalogSkuId,
          quantity: formatQty(delta),
          isTest: locked.isTest
        });
        // 分拨成本以「仓库发货时」的 avg_unit_cost 为准；多次部分发货按数量加权，
        // 后续门店收货即使用这里冻结的成本做移动加权。
        const prevShippedQty = currentCents / 100;
        const prevCost = Number(item.unitCost ?? 0);
        const nextShippedQty = nextCents / 100;
        const batchCost = Number(shipped.unitCost);
        const weightedCost =
          nextShippedQty > 0
            ? (prevShippedQty * prevCost + (delta / 100) * batchCost) / nextShippedQty
            : batchCost;
        const unitCost = weightedCost.toFixed(2);
        await tx.insert(stockMovements).values({
          shopId: null,
          locationType: 'warehouse',
          locationId: locked.fromWarehouseId,
          productSkuId: null,
          catalogSkuId: item.catalogSkuId,
          movementType: 'transfer_out',
          quantityChange: formatQty(-delta),
          balanceAfter: shipped.balanceAfter,
          unitCost: shipped.unitCost,
          referenceType: 'warehouse_transfer',
          referenceId: locked.id,
          operatorAdminId: admin.sub,
          remark: `分拨发出 ${locked.transferNo}`,
          isTest: locked.isTest
        });
        await tx
          .update(warehouseTransferItems)
          .set({
            shippedQuantity: formatQty(nextCents),
            unitCost,
            amount: amountOf(allocatedCents, unitCost),
            updatedAt: new Date()
          })
          .where(eq(warehouseTransferItems.id, item.id));

        totalDeltaCents += delta;
        deltaLines.push({
          itemId: item.id,
          shippedQuantity: formatQty(nextCents),
          delta: formatQty(delta)
        });
      }

      if (totalDeltaCents === 0) {
        throw new DocumentRuleError(
          'TRANSFER_SHIP_QUANTITY_UNCHANGED',
          '本次没有新增发出数量',
          409
        );
      }

      const refreshed = await tx
        .select({
          allocatedQuantity: warehouseTransferItems.allocatedQuantity,
          shippedQuantity: warehouseTransferItems.shippedQuantity
        })
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, id));
      const fullyShipped =
        refreshed.length > 0 &&
        refreshed.some((row) => cents(row.allocatedQuantity) > 0) &&
        refreshed.every((row) => cents(row.shippedQuantity) >= cents(row.allocatedQuantity));
      const nextStatus: WarehouseTransferStatus = fullyShipped ? 'shipped' : 'allocated';
      if (fullyShipped) {
        assertWarehouseTransferTransition(locked.status, 'shipped');
      }

      const receiveDueAt = fullyShipped
        ? new Date(Date.now() + RECEIVE_SLA_HOURS * 60 * 60 * 1000)
        : locked.receiveDueAt;

      await tx
        .update(warehouseTransfers)
        .set({
          status: nextStatus,
          handledByAdminId: admin.sub,
          receiverAdminId,
          // 全部发出才进入应收货状态：按 SLA 写入截止时间；部分发货沿用原值
          receiveDueAt,
          shippedAt: fullyShipped ? new Date() : locked.shippedAt,
          updatedAt: new Date()
        })
        .where(eq(warehouseTransfers.id, id));

      await recordDocumentEvent(tx, {
        documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
        documentId: id,
        fromStatus: locked.status,
        toStatus: nextStatus,
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        reason: fullyShipped ? '全部发出' : '部分发货',
        payload: {
          transferNo: locked.transferNo,
          fullyShipped,
          receiverAdminId,
          receiveDueAt: receiveDueAt ? receiveDueAt.toISOString() : null,
          lines: deltaLines
        },
        isTest: locked.isTest
      });

      const payload = { ok: true, item: await loadTransferDetail(id, tx) };
      if (acquiredKey) await completeIdempotencyKey(tx, acquiredKey, payload);
      return payload;
    });

    return c.json(result);
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    throw error;
  }
});

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.uuid('分拨明细 ID 不合法'),
        /** 本行累计实收数量（绝对量），不得超过已发出数量 */
        receivedQuantity: z.union([z.string(), z.number()]),
        differenceReason: z.enum(DIFFERENCE_REASONS).nullish(),
        remark: z.string().trim().max(200).nullish()
      })
    )
    .min(1, '至少一条收货明细')
    .max(200),
  remark: z.string().trim().max(500).nullish(),
  idempotencyKey: z.string().trim().max(120).nullish()
});

warehouseTransferRoutes.post('/warehouse-transfers/:id/receive', async (c) => {
  const parsed = receiveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const admin = c.get('admin');
  const id = c.req.param('id');
  const db = await getDb();
  const [header] = await db
    .select({
      id: warehouseTransfers.id,
      toShopId: warehouseTransfers.toShopId,
      transferNo: warehouseTransfers.transferNo
    })
    .from(warehouseTransfers)
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);

  const denied = await guardPermission(c, 'inventory.write', { shopId: header.toShopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, header.toShopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的收货权限' }, 403);
  }

  const requestHash = hashIdempotencyRequest({
    transferId: id,
    kind: 'receive',
    items: parsed.data.items,
    remark: parsed.data.remark ?? null
  });
  const idempotencyKey =
    c.req.header('Idempotency-Key')?.trim() || parsed.data.idempotencyKey?.trim() || null;
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'warehouse_transfer_receive',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') {
      return c.json(acquired.response ?? { ok: true, replayed: true });
    }
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'TRANSFER_RECEIVE_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该收货请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致，请更换幂等键'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(warehouseTransfers)
        .where(eq(warehouseTransfers.id, id))
        .for('update');
      if (!locked) throw new DocumentRuleError('NOT_FOUND', '分拨单不存在', 404);
      if (locked.status === 'received') {
        throw new DocumentRuleError('TRANSFER_ALREADY_RECEIVED', '该分拨单已收货，请勿重复收货', 409);
      }
      if (locked.status === 'cancelled') {
        throw new DocumentRuleError('TRANSFER_CANCELLED', '该分拨单已取消，不能收货', 409);
      }
      if (locked.status !== 'shipped') {
        throw new DocumentRuleError('TRANSFER_NOT_SHIPPED', '分拨单尚未全部发出，不能收货', 409);
      }

      const items = await tx
        .select()
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, id))
        .orderBy(asc(warehouseTransferItems.catalogSkuId))
        .for('update');
      const itemMap = new Map(items.map((item) => [item.id, item]));

      let totalDeltaCents = 0;
      const deltaLines: Array<{
        itemId: string;
        receivedQuantity: string;
        delta: string;
        differenceReason: string | null;
      }> = [];

      for (const input of parsed.data.items) {
        const item = itemMap.get(input.itemId);
        if (!item) {
          throw new DocumentRuleError('TRANSFER_ITEM_MISMATCH', '存在不属于该分拨单的明细', 400);
        }
        const currentCents = cents(item.receivedQuantity);
        const shippedCents = cents(item.shippedQuantity);
        const nextCents = nonNegativeCents(input.receivedQuantity, '实收数量');
        if (nextCents < currentCents) {
          throw new DocumentRuleError(
            'TRANSFER_RECEIVE_QUANTITY_DECREASED',
            `实收数量不能小于已收数量（已收 ${item.receivedQuantity}）`,
            409
          );
        }
        if (nextCents > shippedCents) {
          throw new DocumentRuleError(
            'TRANSFER_RECEIVE_EXCEEDS_SHIPPED',
            `实收数量不能超过发出数量：发出 ${item.shippedQuantity}，本次实收 ${formatQty(nextCents)}`,
            409
          );
        }

        const delta = nextCents - currentCents;
        if (delta > 0) {
          // 门店 SKU 必须在分配阶段解析成功，收货阶段不允许补建映射
          if (!item.productSkuId) {
            throw new DocumentRuleError(
              'TRANSFER_SKU_UNMAPPED',
              '该明细尚未映射到门店 SKU，请先完成分配后再收货',
              409
            );
          }
          const [stock] = await tx
            .select({
              quantity: productSkuStocks.quantity,
              avgUnitCost: productSkuStocks.avgUnitCost,
              isTest: productSkuStocks.isTest
            })
            .from(productSkuStocks)
            .where(eq(productSkuStocks.productSkuId, item.productSkuId))
            .for('update');
          if (stock && stock.isTest !== locked.isTest) {
            throw new DocumentRuleError(
              'TEST_DATA_MISMATCH',
              '分拨单与门店库存行的测试标记不一致',
              409
            );
          }

          const oldQty = Number(stock?.quantity ?? 0);
          const oldAvg = Number(stock?.avgUnitCost ?? 0);
          const addQty = delta / 100;
          const newQty = oldQty + addQty;
          const unitCost = Number(item.unitCost);
          // 门店成本按仓库发货时冻结的成本做移动加权
          const newAvg = newQty > 0 ? (oldQty * oldAvg + addQty * unitCost) / newQty : oldAvg;
          const balanceAfter = newQty.toFixed(2);
          const avgUnitCost = newAvg.toFixed(2);

          if (stock) {
            await tx
              .update(productSkuStocks)
              .set({ quantity: balanceAfter, avgUnitCost, updatedAt: new Date() })
              .where(eq(productSkuStocks.productSkuId, item.productSkuId));
          } else {
            await tx.insert(productSkuStocks).values({
              productSkuId: item.productSkuId,
              shopId: locked.toShopId,
              quantity: balanceAfter,
              avgUnitCost,
              isTest: locked.isTest
            });
          }

          await tx.insert(stockMovements).values({
            shopId: locked.toShopId,
            locationType: 'shop',
            locationId: locked.toShopId,
            productSkuId: item.productSkuId,
            catalogSkuId: item.catalogSkuId,
            movementType: 'transfer_in',
            quantityChange: formatQty(delta),
            balanceAfter,
            unitCost: item.unitCost,
            referenceType: 'warehouse_transfer',
            referenceId: locked.id,
            operatorAdminId: admin.sub,
            remark: `分拨收货 ${locked.transferNo}`,
            isTest: locked.isTest
          });

          totalDeltaCents += delta;
        }

        const nextReceivedCents = nextCents;
        const differenceReason = input.differenceReason ?? item.differenceReason ?? null;
        const effectiveShippedCents = shippedCents;
        if (delta > 0 && nextReceivedCents < effectiveShippedCents && !differenceReason) {
          throw new DocumentRuleError(
            'TRANSFER_DIFFERENCE_REASON_REQUIRED',
            '实收数量少于发出数量时必须填写差异原因',
            400
          );
        }

        await tx
          .update(warehouseTransferItems)
          .set({
            receivedQuantity: formatQty(nextReceivedCents),
            differenceReason,
            ...(input.remark === undefined ? {} : { remark: input.remark?.trim() || null }),
            updatedAt: new Date()
          })
          .where(eq(warehouseTransferItems.id, item.id));

        deltaLines.push({
          itemId: item.id,
          receivedQuantity: formatQty(nextReceivedCents),
          delta: formatQty(delta),
          differenceReason
        });
      }

      if (totalDeltaCents === 0) {
        throw new DocumentRuleError(
          'TRANSFER_RECEIVE_QUANTITY_UNCHANGED',
          '本次没有新增实收数量',
          409
        );
      }

      const refreshed = await tx
        .select({
          shippedQuantity: warehouseTransferItems.shippedQuantity,
          receivedQuantity: warehouseTransferItems.receivedQuantity
        })
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, id));
      const fullyReceived =
        refreshed.length > 0 &&
        refreshed.some((row) => cents(row.shippedQuantity) > 0) &&
        refreshed.every((row) => cents(row.receivedQuantity) >= cents(row.shippedQuantity));
      const nextStatus: WarehouseTransferStatus = fullyReceived ? 'received' : 'shipped';
      if (fullyReceived) {
        assertWarehouseTransferTransition(locked.status, 'received');
      }

      await tx
        .update(warehouseTransfers)
        .set({
          status: nextStatus,
          handledByAdminId: admin.sub,
          /** 实际收货人：代收时与建议责任人不一致，用于事后追溯 */
          receivedByAdminId: admin.sub,
          receivedAt: fullyReceived ? new Date() : locked.receivedAt,
          updatedAt: new Date()
        })
        .where(eq(warehouseTransfers.id, id));

      await recordDocumentEvent(tx, {
        documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
        documentId: id,
        fromStatus: locked.status,
        toStatus: nextStatus,
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        reason: fullyReceived ? '收货完成' : '部分收货',
        payload: {
          transferNo: locked.transferNo,
          fullyReceived,
          lines: deltaLines
        },
        isTest: locked.isTest
      });

      const payload = { ok: true, item: await loadTransferDetail(id, tx) };
      if (acquiredKey) await completeIdempotencyKey(tx, acquiredKey, payload);
      return payload;
    });

    return c.json(result);
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    throw error;
  }
});

const closeSchema = z.object({
  differenceReason: z.enum(DIFFERENCE_REASONS),
  remark: z.string().trim().max(500).nullish(),
  idempotencyKey: z.string().trim().max(120).nullish()
});

/**
 * 差异关闭：门店确认剩余未收数量放弃。
 * - 仅 shipped 状态、且存在未收差额时可用；
 * - 差额按损耗记账：明细冻结 loss_quantity / loss_amount，写一条门店 waste 备忘流水；
 * - 门店库存不做二次扣减（发出时仓库已扣、门店本就没收到），仓库库存也不变；
 * - 状态 shipped → received，并写 difference_closed_at 区分「差异关闭」与「全部收满」。
 */
warehouseTransferRoutes.post('/warehouse-transfers/:id/close', async (c) => {
  const parsed = closeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return c.json(
      {
        code: 'INVALID_BODY',
        message:
          issue?.path?.[0] === 'differenceReason'
            ? '请选择差异原因'
            : issue?.message ?? '参数不合法'
      },
      400
    );
  }

  const admin = c.get('admin');
  const id = c.req.param('id');
  const db = await getDb();
  const [header] = await db
    .select({
      id: warehouseTransfers.id,
      toShopId: warehouseTransfers.toShopId,
      transferNo: warehouseTransfers.transferNo
    })
    .from(warehouseTransfers)
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);

  const denied = await guardPermission(c, 'inventory.write', { shopId: header.toShopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, header.toShopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的差异关闭权限' }, 403);
  }

  const requestHash = hashIdempotencyRequest({
    transferId: id,
    kind: 'close',
    differenceReason: parsed.data.differenceReason,
    remark: parsed.data.remark ?? null
  });
  const idempotencyKey =
    c.req.header('Idempotency-Key')?.trim() || parsed.data.idempotencyKey?.trim() || null;
  let acquiredKey: string | null = null;
  if (idempotencyKey) {
    const acquired = await acquireIdempotencyKey(db, {
      scope: 'warehouse_transfer_close',
      key: idempotencyKey,
      requestHash
    });
    if (acquired.state === 'replayed') {
      return c.json(acquired.response ?? { ok: true, replayed: true });
    }
    if (acquired.state === 'conflict') {
      return c.json(
        {
          code:
            acquired.reason === 'in_progress'
              ? 'TRANSFER_CLOSE_IN_PROGRESS'
              : 'IDEMPOTENCY_CONFLICT',
          message:
            acquired.reason === 'in_progress'
              ? '该差异关闭请求正在处理，请稍后重试'
              : '同一幂等键的请求内容不一致，请更换幂等键'
        },
        409
      );
    }
    acquiredKey = acquired.key;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(warehouseTransfers)
        .where(eq(warehouseTransfers.id, id))
        .for('update');
      if (!locked) throw new DocumentRuleError('NOT_FOUND', '分拨单不存在', 404);
      if (locked.differenceClosedAt) {
        throw new DocumentRuleError(
          'TRANSFER_DIFFERENCE_ALREADY_CLOSED',
          '该分拨单的差异已关闭，请勿重复操作',
          409
        );
      }
      if (locked.status === 'received') {
        throw new DocumentRuleError(
          'TRANSFER_NO_DIFFERENCE',
          '该分拨单已全部收满，没有需要关闭的差异',
          409
        );
      }
      if (locked.status === 'cancelled') {
        throw new DocumentRuleError('TRANSFER_CANCELLED', '该分拨单已取消，不能关闭差异', 409);
      }
      if (locked.status !== 'shipped') {
        throw new DocumentRuleError(
          'TRANSFER_NOT_SHIPPED',
          '只有已发出的分拨单可以关闭差异',
          409
        );
      }

      const items = await tx
        .select()
        .from(warehouseTransferItems)
        .where(eq(warehouseTransferItems.transferId, id))
        .orderBy(asc(warehouseTransferItems.catalogSkuId))
        .for('update');

      const pendingLines = items.filter(
        (item) => cents(item.shippedQuantity) > cents(item.receivedQuantity)
      );
      if (pendingLines.length === 0) {
        throw new DocumentRuleError(
          'TRANSFER_NO_DIFFERENCE',
          '该分拨单已全部收满，没有需要关闭的差异',
          409
        );
      }

      let lossQuantityCents = 0;
      let lossAmountCents = 0;
      const eventLines: Array<{
        itemId: string;
        lossQuantity: string;
        lossAmount: string;
        unitCost: string;
        differenceReason: string;
      }> = [];

      for (const item of pendingLines) {
        if (!item.productSkuId) {
          throw new DocumentRuleError(
            'TRANSFER_SKU_UNMAPPED',
            '该明细尚未映射到门店 SKU，不能关闭差异',
            409
          );
        }
        const pendingCents = cents(item.shippedQuantity) - cents(item.receivedQuantity);
        const lossAmount = amountOf(pendingCents, item.unitCost);
        const differenceReason = item.differenceReason ?? parsed.data.differenceReason;

        const [stock] = await tx
          .select({ quantity: productSkuStocks.quantity, isTest: productSkuStocks.isTest })
          .from(productSkuStocks)
          .where(eq(productSkuStocks.productSkuId, item.productSkuId))
          .for('update');
        if (stock && stock.isTest !== locked.isTest) {
          throw new DocumentRuleError(
            'TEST_DATA_MISMATCH',
            '分拨单与门店库存行的测试标记不一致',
            409
          );
        }

        // 备忘流水：quantity_change = 0，仅记录损耗事实与成本，不改变门店库存
        await tx.insert(stockMovements).values({
          shopId: locked.toShopId,
          locationType: 'shop',
          locationId: locked.toShopId,
          productSkuId: item.productSkuId,
          catalogSkuId: item.catalogSkuId,
          movementType: 'waste',
          quantityChange: '0.00',
          balanceAfter: stock?.quantity ?? '0.00',
          unitCost: item.unitCost,
          referenceType: 'warehouse_transfer',
          referenceId: locked.id,
          operatorAdminId: admin.sub,
          remark: `分拨差异损耗 ${locked.transferNo}：${formatQty(pendingCents)} × ${item.unitCost}`,
          isTest: locked.isTest
        });

        await tx
          .update(warehouseTransferItems)
          .set({
            differenceReason,
            lossQuantity: formatQty(pendingCents),
            lossAmount,
            updatedAt: new Date()
          })
          .where(eq(warehouseTransferItems.id, item.id));

        lossQuantityCents += pendingCents;
        lossAmountCents += Math.round(Number(lossAmount) * 100);
        eventLines.push({
          itemId: item.id,
          lossQuantity: formatQty(pendingCents),
          lossAmount,
          unitCost: item.unitCost,
          differenceReason
        });
      }

      assertWarehouseTransferTransition(locked.status, 'received');
      await tx
        .update(warehouseTransfers)
        .set({
          status: 'received',
          receivedAt: new Date(),
          differenceClosedAt: new Date(),
          differenceCloseReason: parsed.data.remark?.trim() || null,
          handledByAdminId: admin.sub,
          updatedAt: new Date()
        })
        .where(eq(warehouseTransfers.id, id));

      await recordDocumentEvent(tx, {
        documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
        documentId: id,
        fromStatus: locked.status,
        toStatus: 'received',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        reason: `差异关闭：${
          DIFFERENCE_REASON_LABELS[parsed.data.differenceReason]
        }${parsed.data.remark ? `，${parsed.data.remark}` : ''}`,
        payload: {
          transferNo: locked.transferNo,
          differenceReason: parsed.data.differenceReason,
          lossQuantity: formatQty(lossQuantityCents),
          lossAmount: formatQty(lossAmountCents),
          lines: eventLines
        },
        isTest: locked.isTest
      });

      const payload = { ok: true, item: await loadTransferDetail(id, tx) };
      if (acquiredKey) await completeIdempotencyKey(tx, acquiredKey, payload);
      return payload;
    });

    return c.json(result);
  } catch (error) {
    if (acquiredKey) await releaseIdempotencyKey(db, acquiredKey);
    throw error;
  }
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1, '请填写取消原因').max(200)
});

warehouseTransferRoutes.post('/warehouse-transfers/:id/cancel', async (c) => {
  const parsed = cancelSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '请填写取消原因' },
      400
    );
  }

  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const admin = c.get('admin');
  const id = c.req.param('id');
  const db = await getDb();
  const [header] = await db
    .select({ id: warehouseTransfers.id, fromWarehouseId: warehouseTransfers.fromWarehouseId })
    .from(warehouseTransfers)
    .where(eq(warehouseTransfers.id, id))
    .limit(1);
  if (!header) return c.json({ code: 'NOT_FOUND', message: '分拨单不存在' }, 404);
  if (!(await canAccessWarehouse(admin.sub, header.fromWarehouseId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该仓库的取消权限' }, 403);
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(warehouseTransfers)
      .where(eq(warehouseTransfers.id, id))
      .for('update');
    if (!locked) throw new DocumentRuleError('NOT_FOUND', '分拨单不存在', 404);
    if (locked.status === 'cancelled') {
      throw new DocumentRuleError('TRANSFER_ALREADY_CANCELLED', '该分拨单已取消，请勿重复操作', 409);
    }
    if (locked.status === 'shipped') {
      throw new DocumentRuleError(
        'TRANSFER_ALREADY_SHIPPED',
        '分拨单已发出，不能取消；如需处理请联系门店走退货流程',
        409
      );
    }
    if (locked.status === 'received') {
      throw new DocumentRuleError('TRANSFER_ALREADY_RECEIVED', '分拨单已收货，不能取消', 409);
    }

    const items = await tx
      .select()
      .from(warehouseTransferItems)
      .where(eq(warehouseTransferItems.transferId, id))
      .orderBy(asc(warehouseTransferItems.catalogSkuId))
      .for('update');

    const shippedCents = items.reduce((acc, item) => acc + cents(item.shippedQuantity), 0);
    if (shippedCents > 0) {
      throw new DocumentRuleError(
        'TRANSFER_PARTIALLY_SHIPPED',
        '该分拨单已有发出数量，不能取消',
        409
      );
    }

    // 仅释放尚未发出的分配预留
    for (const item of items) {
      const releaseCents = cents(item.allocatedQuantity) - cents(item.shippedQuantity);
      if (releaseCents <= 0) continue;
      await releaseWarehouseReservation(tx, {
        warehouseId: locked.fromWarehouseId,
        skuId: item.catalogSkuId,
        quantity: formatQty(releaseCents),
        isTest: locked.isTest
      });
    }

    assertWarehouseTransferTransition(locked.status, 'cancelled');
    await tx
      .update(warehouseTransfers)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: parsed.data.reason,
        handledByAdminId: admin.sub,
        updatedAt: new Date()
      })
      .where(eq(warehouseTransfers.id, id));

    await recordDocumentEvent(tx, {
      documentType: WAREHOUSE_TRANSFER_DOCUMENT_TYPE,
      documentId: id,
      fromStatus: locked.status,
      toStatus: 'cancelled',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      reason: parsed.data.reason,
      payload: {
        transferNo: locked.transferNo,
        releasedQuantity: formatQty(
          items.reduce((acc, item) => acc + cents(item.allocatedQuantity), 0)
        )
      },
      isTest: locked.isTest
    });
  });

  return c.json({ item: await loadTransferDetail(id) });
});

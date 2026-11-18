import { and, eq } from 'drizzle-orm';
import { catalogSkus, getDb, productSkus, warehouseStocks } from '@sds/db';
import {
  DocumentRuleError,
  assertTransition,
  type DocumentStateMachine
} from './documents.js';

type Db = Awaited<ReturnType<typeof getDb>>;
type DbLike = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** 单据类型与单号前缀；单号统一由 generateDocumentNo 生成 */
export const WAREHOUSE_TRANSFER_DOCUMENT_TYPE = 'warehouse_transfer';
export const WAREHOUSE_TRANSFER_NO_PREFIX = 'WT';

export type WarehouseTransferStatus =
  | 'draft'
  | 'allocated'
  | 'shipped'
  | 'received'
  | 'cancelled';

/**
 * 分拨单状态机：全部为单向流转，不设回退。
 * - draft → allocated（分配并冻结库存）或 cancelled；
 * - allocated → shipped（扣减库存）或 cancelled（释放预留）；
 * - shipped → received（门店收货完成后进入终态），发出后不可取消；
 * - received / cancelled 为终态。
 */
export const WAREHOUSE_TRANSFER_STATE_MACHINE = {
  __new__: ['draft'],
  draft: ['allocated', 'cancelled'],
  allocated: ['shipped', 'cancelled'],
  shipped: ['received'],
  received: [],
  cancelled: []
} as const satisfies DocumentStateMachine;

export function assertWarehouseTransferTransition(
  from: string | null | undefined,
  to: WarehouseTransferStatus
): void {
  assertTransition(WAREHOUSE_TRANSFER_STATE_MACHINE, {
    documentType: '分拨单',
    from,
    to
  });
}

function toCents(value: string | number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new DocumentRuleError('TRANSFER_QUANTITY_INVALID', '分拨数量不合法', 400);
  }
  return Math.round(numeric * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function positiveCents(value: string | number): number {
  const cents = toCents(value);
  if (cents <= 0) {
    throw new DocumentRuleError('TRANSFER_QUANTITY_INVALID', '分拨数量必须大于 0', 400);
  }
  return cents;
}

type LockedStock = {
  quantity: string;
  reservedQty: string;
  avgUnitCost: string;
  isTest: boolean;
};

async function lockWarehouseStock(
  tx: DbLike,
  params: { warehouseId: string; skuId: string; isTest?: boolean }
): Promise<LockedStock> {
  const [stock] = await (tx as Db)
    .select({
      quantity: warehouseStocks.quantity,
      reservedQty: warehouseStocks.reservedQty,
      avgUnitCost: warehouseStocks.avgUnitCost,
      isTest: warehouseStocks.isTest
    })
    .from(warehouseStocks)
    .where(
      and(
        eq(warehouseStocks.warehouseId, params.warehouseId),
        eq(warehouseStocks.skuId, params.skuId)
      )
    )
    .for('update');
  if (!stock) {
    throw new DocumentRuleError(
      'WAREHOUSE_STOCK_MISSING',
      '仓库缺少该规格的库存行，请先完成总部仓入库',
      409
    );
  }
  if (params.isTest !== undefined && stock.isTest !== params.isTest) {
    throw new DocumentRuleError(
      'TEST_DATA_MISMATCH',
      '分拨单与仓库库存行的测试标记不一致',
      409
    );
  }
  return stock;
}

/**
 * 分配时预留库存：`reserved_qty += quantity`。
 * 并发策略：事务内 `SELECT ... FOR UPDATE` 锁住仓库库存行，再校验可用量（quantity - reserved_qty），
 * 同一仓库规格的并发分配会被串行化，避免超配。
 */
export async function reserveWarehouseStock(
  tx: DbLike,
  params: { warehouseId: string; skuId: string; quantity: string | number; isTest?: boolean }
): Promise<{ availableBefore: string; reservedAfter: string }> {
  const needCents = positiveCents(params.quantity);
  const stock = await lockWarehouseStock(tx, params);
  const quantityCents = toCents(stock.quantity);
  const reservedCents = toCents(stock.reservedQty);
  const availableCents = quantityCents - reservedCents;
  if (availableCents < needCents) {
    throw new DocumentRuleError(
      'WAREHOUSE_STOCK_INSUFFICIENT',
      `仓库可用库存不足：可用 ${fromCents(availableCents)}，需分配 ${fromCents(needCents)}`,
      409
    );
  }
  const reservedAfter = fromCents(reservedCents + needCents);
  await (tx as Db)
    .update(warehouseStocks)
    .set({ reservedQty: reservedAfter, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseStocks.warehouseId, params.warehouseId),
        eq(warehouseStocks.skuId, params.skuId)
      )
    );
  return { availableBefore: fromCents(availableCents), reservedAfter };
}

/**
 * 取消（draft/allocated）时释放预留：`reserved_qty -= quantity`。
 * 锁行后校验预留量，避免释放出负数。
 */
export async function releaseWarehouseReservation(
  tx: DbLike,
  params: { warehouseId: string; skuId: string; quantity: string | number; isTest?: boolean }
): Promise<{ reservedAfter: string }> {
  const releaseCents = positiveCents(params.quantity);
  const stock = await lockWarehouseStock(tx, params);
  const reservedCents = toCents(stock.reservedQty);
  if (reservedCents < releaseCents) {
    throw new DocumentRuleError(
      'WAREHOUSE_RESERVATION_INSUFFICIENT',
      `仓库预留量不足：当前预留 ${fromCents(reservedCents)}，需释放 ${fromCents(releaseCents)}`,
      409
    );
  }
  const reservedAfter = fromCents(reservedCents - releaseCents);
  await (tx as Db)
    .update(warehouseStocks)
    .set({ reservedQty: reservedAfter, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseStocks.warehouseId, params.warehouseId),
        eq(warehouseStocks.skuId, params.skuId)
      )
    );
  return { reservedAfter };
}

/**
 * 发货时扣减库存并同步释放预留：
 * `quantity -= shipped`、`reserved_qty -= shipped`，余额不得为负。
 * 返回扣减后的余额与成本，供仓库流水与门店成本结转使用。
 */
export async function shipReservedWarehouseStock(
  tx: DbLike,
  params: { warehouseId: string; skuId: string; quantity: string | number; isTest?: boolean }
): Promise<{ balanceAfter: string; reservedAfter: string; unitCost: string }> {
  const shipCents = positiveCents(params.quantity);
  const stock = await lockWarehouseStock(tx, params);
  const quantityCents = toCents(stock.quantity);
  const reservedCents = toCents(stock.reservedQty);
  if (quantityCents < shipCents) {
    throw new DocumentRuleError(
      'WAREHOUSE_STOCK_INSUFFICIENT',
      `仓库库存不足：当前 ${fromCents(quantityCents)}，需发出 ${fromCents(shipCents)}`,
      409
    );
  }
  if (reservedCents < shipCents) {
    throw new DocumentRuleError(
      'WAREHOUSE_RESERVATION_INSUFFICIENT',
      `仓库预留量不足：当前预留 ${fromCents(reservedCents)}，需发出 ${fromCents(shipCents)}`,
      409
    );
  }
  const balanceAfter = fromCents(quantityCents - shipCents);
  const reservedAfter = fromCents(reservedCents - shipCents);
  await (tx as Db)
    .update(warehouseStocks)
    .set({ quantity: balanceAfter, reservedQty: reservedAfter, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseStocks.warehouseId, params.warehouseId),
        eq(warehouseStocks.skuId, params.skuId)
      )
    );
  return { balanceAfter, reservedAfter, unitCost: stock.avgUnitCost };
}

/**
 * 总部规格 → 门店 SKU 映射规则：
 * 1. 优先用显式 catalogSkuId；只给 catalogProductId 时取该商品启用中的默认规格；
 * 2. 总部规格必须存在且启用；
 * 3. 门店必须已基于该总部规格建档（product_skus.catalog_sku_id 指向它），且规格可用；
 * 4. 任一条件不满足都返回明确错误码，禁止分拨。
 */
export async function resolveTransferSkuMapping(
  db: DbLike,
  params: {
    shopId: string;
    catalogSkuId?: string | null;
    catalogProductId?: string | null;
  }
): Promise<{ catalogSkuId: string; productSkuId: string }> {
  if (!params.catalogSkuId && !params.catalogProductId) {
    throw new DocumentRuleError(
      'TRANSFER_SKU_REQUIRED',
      '分拨明细必须指定总部规格或总部商品',
      400
    );
  }

  const [catalogSku] = params.catalogSkuId
    ? await (db as Db)
        .select({ id: catalogSkus.id, status: catalogSkus.status })
        .from(catalogSkus)
        .where(eq(catalogSkus.id, params.catalogSkuId))
        .limit(1)
    : await (db as Db)
        .select({ id: catalogSkus.id, status: catalogSkus.status })
        .from(catalogSkus)
        .where(
          and(
            eq(catalogSkus.catalogProductId, params.catalogProductId!),
            eq(catalogSkus.isDefault, true),
            eq(catalogSkus.status, 'active')
          )
        )
        .limit(1);
  if (!catalogSku) {
    throw new DocumentRuleError(
      'TRANSFER_SKU_NOT_FOUND',
      params.catalogSkuId ? '总部规格不存在' : '总部商品没有启用中的默认规格',
      404
    );
  }
  if (catalogSku.status !== 'active') {
    throw new DocumentRuleError('TRANSFER_SKU_DISABLED', '总部规格已停用，不能分拨', 409);
  }

  const [productSku] = await (db as Db)
    .select({ id: productSkus.id, isAvailable: productSkus.isAvailable })
    .from(productSkus)
    .where(
      and(
        eq(productSkus.shopId, params.shopId),
        eq(productSkus.catalogSkuId, catalogSku.id)
      )
    )
    .limit(1);
  if (!productSku) {
    throw new DocumentRuleError(
      'TRANSFER_SKU_UNMAPPED',
      '目标门店未建档该总部规格，请先在门店商品中建档后再分拨',
      409
    );
  }
  if (!productSku.isAvailable) {
    throw new DocumentRuleError(
      'TRANSFER_SKU_UNAVAILABLE',
      '目标门店的商品规格已停用，不能分拨',
      409
    );
  }

  return { catalogSkuId: catalogSku.id, productSkuId: productSku.id };
}

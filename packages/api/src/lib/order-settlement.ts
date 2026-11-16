import { and, eq, inArray, sql } from 'drizzle-orm';
import { customers, getDb, productSkuStocks, stockMovements } from '@sds/db';

type Database = Awaited<ReturnType<typeof getDb>>;

/** 订单相关写操作都在事务内，这里统一用事务句柄类型 */
export type OrderTx = Parameters<Parameters<Database['transaction']>[0]>[0];

function cents(value: string | number | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function money(value: number) {
  return (value / 100).toFixed(2);
}

// 按原始扣减流水回补，避免商品库存类型改变后漏补或凭空增加库存。
export async function restoreOrderStock(
  tx: OrderTx,
  params: {
    orderId: string;
    shopId: string;
    orderNo: string;
    reason: string;
    operatorAdminId?: string | null;
    operatorUserId?: string | null;
  }
) {
  const deducted = await tx
    .select({
      productSkuId: stockMovements.productSkuId,
      quantity: sql<string>`-${stockMovements.quantityChange}`
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.shopId, params.shopId),
        eq(stockMovements.referenceType, 'order'),
        eq(stockMovements.referenceId, params.orderId),
        eq(stockMovements.movementType, 'sale_out')
      )
    );
  if (deducted.length === 0) return;

  const skuIds = deducted.map((item) => item.productSkuId);
  const stockRows = await tx
    .select({
      productSkuId: productSkuStocks.productSkuId,
      quantity: productSkuStocks.quantity
    })
    .from(productSkuStocks)
    .where(inArray(productSkuStocks.productSkuId, skuIds))
    .for('update');
  const balance = new Map(stockRows.map((row) => [row.productSkuId, cents(row.quantity)]));

  for (const item of deducted) {
    const before = balance.get(item.productSkuId);
    if (before === undefined) continue;
    const after = before + cents(item.quantity);
    balance.set(item.productSkuId, after);
    await tx
      .update(productSkuStocks)
      .set({ quantity: money(after), updatedAt: new Date() })
      .where(eq(productSkuStocks.productSkuId, item.productSkuId));
    await tx.insert(stockMovements).values({
      shopId: params.shopId,
      productSkuId: item.productSkuId,
      movementType: 'order_return',
      quantityChange: money(cents(item.quantity)),
      balanceAfter: money(after),
      referenceType: 'order',
      referenceId: params.orderId,
      operatorAdminId: params.operatorAdminId ?? null,
      operatorUserId: params.operatorUserId ?? null,
      remark: `${params.reason} ${params.orderNo}`
    });
  }
}

/**
 * 顾客累计口径：现金单在下单时计入，线上单在支付成功时计入；
 * 取消已计入的订单或退款通过时按负数回退，计数与金额都不会跌破 0。
 */
export async function adjustCustomerStats(
  tx: OrderTx,
  customerId: string,
  delta: { orders: number; spentCents: number }
) {
  if (delta.orders === 0 && delta.spentCents === 0) return;
  await tx
    .update(customers)
    .set({
      totalOrders: sql`greatest(0, ${customers.totalOrders} + ${delta.orders})`,
      totalSpent: sql`greatest(0, ${customers.totalSpent} + ${money(delta.spentCents)})`,
      updatedAt: new Date()
    })
    .where(eq(customers.id, customerId));
}

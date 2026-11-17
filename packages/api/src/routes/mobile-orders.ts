import { Hono, type Context } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  isOnlinePayment,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderStatus,
  type PaymentMethod
} from '@sds/shared';
import {
  addresses,
  cartItems,
  carts,
  catalogProducts,
  catalogSkus,
  getDb,
  orderItems,
  orderPayments,
  orders,
  productSkuStocks,
  productSkus,
  products,
  shops,
  stockMovements
} from '@sds/db';
import { findCustomerSession, tokenFromHeader } from '../lib/customer-session.js';
import { quantityNumber } from '../lib/quantity.js';
import { adjustCustomerStats, restoreOrderStock } from '../lib/order-settlement.js';
import { chargePayment, PAYMENT_PROVIDER } from '../lib/payments.js';

/**
 * 顾客下单与支付，对应 PRD 6 章订单流程。
 * - 只接受购物车里被选中的条目，一店一单；
 * - 下单是唯一扣库存的入口：同一事务内锁定库存行、扣减余额、写 sale_out；
 *   货到付款与线上支付都在下单时占用库存，取消/退款再回补；
 * - 售罄或库存不足的条目直接拒绝，不做部分下单；
 * - 下单成功后清掉对应购物车条目，空车删除；
 * - 微信支付走沙箱通道：先落 pending_payment，支付成功后才计入顾客消费。
 */
export const mobileOrderRoutes = new Hono();

const createSchema = z.object({
  fulfillmentType: z.enum(['delivery', 'pickup']),
  paymentMethod: z.enum(['wechat', 'cash']).default('cash'),
  addressId: z.uuid('地址不合法').optional(),
  remark: z.string().trim().max(200).optional(),
  groups: z
    .array(
      z.object({
        shopId: z.uuid('门店不合法'),
        itemIds: z.array(z.uuid('条目不合法')).min(1, '请选择要买的菜'),
        remark: z.string().trim().max(200).optional()
      })
    )
    .min(1, '请选择要买的菜')
});

const paySchema = z.object({
  orderIds: z.array(z.uuid('订单不合法')).min(1, '请选择要支付的订单')
});

const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional()
});

/** 顾客能自己说「不要了」的状态；再往后（配送中/已完成）只能找门店 */
const CUSTOMER_CANCEL_STATUSES: OrderStatus[] = [
  'pending_payment',
  'paid',
  'preparing',
  'pickup_ready'
];

type CartOrderRow = {
  itemId: string;
  cartId: string;
  shopId: string;
  shopName: string;
  cartRemark: string | null;
  productId: string;
  skuId: string;
  quantity: string;
  name: string;
  imageUrl: string | null;
  unit: string;
  specName: string | null;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  stockQuantity: string;
  unitPrice: string | null;
  skuAvailable: boolean;
  productAvailable: boolean;
  productBlocked: boolean;
  catalogStatus: string | null;
};

class OrderError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 404 | 409 = 400
  ) {
    super(message);
  }
}

function money(value: number) {
  return (value / 100).toFixed(2);
}

function cents(value: string | number | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function orderNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  const tail = Date.now().toString(36).slice(-5).toUpperCase();
  return `SO${date}${tail}${random}`.slice(0, 20);
}

function statusLabel(status: string) {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

async function resolveCustomer(c: Context) {
  const token = tokenFromHeader(c.req.header('authorization'));
  return findCustomerSession(token);
}

function ensureBuyable(row: CartOrderRow) {
  if (
    !row.skuAvailable ||
    !row.productAvailable ||
    row.productBlocked ||
    (row.catalogStatus && row.catalogStatus !== 'active')
  ) {
    throw new OrderError('SKU_UNAVAILABLE', `「${row.name}」暂时不能购买`, 400);
  }
  if (row.stockType === 'tracked' && cents(row.stockQuantity) <= 0) {
    throw new OrderError('STOCK_INSUFFICIENT', `「${row.name}」已售罄`, 409);
  }
  if (row.stockType === 'tracked' && cents(row.quantity) > cents(row.stockQuantity)) {
    throw new OrderError('STOCK_INSUFFICIENT', `「${row.name}」库存不足`, 409);
  }
  if (row.unitPrice === null || cents(row.unitPrice) < 0) {
    throw new OrderError('PRICE_MISSING', `「${row.name}」还没有价格`, 400);
  }
}

async function listOrders(customerId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      shopId: orders.shopId,
      shopName: shops.name,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
      itemCount: orders.itemCount,
      totalAmount: orders.totalAmount,
      remark: orders.remark,
      contactName: orders.contactName,
      contactPhone: orders.contactPhone,
      addressText: orders.addressText,
      cancelledReason: orders.cancelledReason,
      paymentMethod: orders.paymentMethod,
      paidAt: orders.paidAt,
      refundedAt: orders.refundedAt,
      refundAmount: orders.refundAmount,
      refundReason: orders.refundReason,
      refundRejectedReason: orders.refundRejectedReason,
      createdAt: orders.createdAt,
      completedAt: orders.completedAt
    })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(and(eq(orders.customerId, customerId), inArray(orders.id, ids)))
    .orderBy(sql`${orders.createdAt} desc`);

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .orderBy(orderItems.createdAt);

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId);
    if (list) list.push(item);
    else itemsByOrder.set(item.orderId, [item]);
  }

  return rows.map((row) => ({
    id: row.id,
    orderNo: row.orderNo,
    shopId: row.shopId,
    shopName: row.shopName,
    status: row.status,
    statusLabel: statusLabel(row.status),
    fulfillmentType: row.fulfillmentType,
    itemCount: quantityNumber(row.itemCount),
    totalAmount: row.totalAmount,
    remark: row.remark,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    addressText: row.addressText,
    cancelledReason: row.cancelledReason,
    paymentMethod: row.paymentMethod,
    paymentMethodLabel: row.paymentMethod
      ? PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod]
      : null,
    paidAt: row.paidAt,
    refundedAt: row.refundedAt,
    refundAmount: row.refundAmount,
    refundReason: row.refundReason,
    refundRejectedReason: row.refundRejectedReason,
    canPay: row.status === 'pending_payment',
    canCancel: CUSTOMER_CANCEL_STATUSES.includes(row.status as OrderStatus),
    // 线上已收款的订单，顾客点「不要了」会转成退款申请，等店长确认
    cancelNeedsRefund: isOnlinePayment(row.paymentMethod) && row.paidAt !== null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    items: (itemsByOrder.get(row.id) ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      skuId: item.productSkuId,
      name: item.name,
      specName: item.specName,
      imageUrl: item.imageUrl,
      unit: item.unit,
      quantityMode: item.quantityMode,
      unitPrice: item.unitPrice,
      quantity: quantityNumber(item.quantity),
      subtotal: item.subtotal
    }))
  }));
}

mobileOrderRoutes.get('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const db = await getDb();
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.customerId, session.customerId))
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(50);

  return c.json({ items: await listOrders(session.customerId, rows.map((row) => row.id)) });
});

mobileOrderRoutes.post('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '下单信息不完整' },
      400
    );
  }

  const requested = new Map<string, { shopId: string; group: (typeof parsed.data.groups)[number] }>();
  for (const group of parsed.data.groups) {
    const seen = new Set<string>();
    for (const itemId of group.itemIds) {
      if (seen.has(itemId)) {
        return c.json({ code: 'DUPLICATE_ITEM', message: '同一商品重复提交' }, 400);
      }
      seen.add(itemId);
      if (requested.has(itemId)) {
        return c.json({ code: 'DUPLICATE_ITEM', message: '同一商品重复提交' }, 400);
      }
      requested.set(itemId, { shopId: group.shopId, group });
    }
  }
  const itemIds = [...requested.keys()];

  const db = await getDb();
  const rows = (await db
    .select({
      itemId: cartItems.id,
      cartId: cartItems.cartId,
      shopId: carts.shopId,
      shopName: shops.name,
      cartRemark: carts.remark,
      productId: cartItems.productId,
      skuId: cartItems.productSkuId,
      quantity: cartItems.quantity,
      name: sql<string>`coalesce(${catalogProducts.name}, ${products.name})`,
      imageUrl: sql<string | null>`coalesce(${catalogProducts.imageUrl}, ${products.imageUrl})`,
      unit: sql<string>`coalesce(${productSkus.unit}, ${catalogProducts.unit}, ${products.unit})`,
      specName: productSkus.specName,
      quantityMode: productSkus.quantityMode,
      stockType: productSkus.stockType,
      stockQuantity: sql<string>`coalesce(${productSkuStocks.quantity}, 0)`,
      unitPrice: sql<
        string | null
      >`coalesce(${productSkus.price}, ${catalogSkus.defaultPrice}, ${products.price})`,
      skuAvailable: productSkus.isAvailable,
      productAvailable: products.isAvailable,
      productBlocked: products.isBlocked,
      catalogStatus: catalogSkus.status
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(shops, eq(shops.id, carts.shopId))
    .innerJoin(productSkus, eq(productSkus.id, cartItems.productSkuId))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .leftJoin(catalogProducts, eq(catalogProducts.id, products.catalogProductId))
    .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
    .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id))
    .where(
      and(
        eq(carts.customerId, session.customerId),
        inArray(cartItems.id, itemIds)
      )
    )) as unknown as CartOrderRow[];

  if (rows.length !== itemIds.length) {
    return c.json({ code: 'ITEM_NOT_FOUND', message: '部分商品已不在购物车里，请刷新后重试' }, 409);
  }

  try {
    for (const row of rows) {
      const target = requested.get(row.itemId);
      if (!target || target.shopId !== row.shopId) {
        throw new OrderError('ITEM_SHOP_MISMATCH', '商品与门店不匹配，请刷新购物车', 400);
      }
      ensureBuyable(row);
    }
  } catch (error) {
    if (error instanceof OrderError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }

  let address: typeof addresses.$inferSelect | null = null;
  if (parsed.data.fulfillmentType === 'delivery') {
    if (!parsed.data.addressId) {
      return c.json({ code: 'ADDRESS_REQUIRED', message: '请选择收货地址' }, 400);
    }
    const [found] = await db
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.id, parsed.data.addressId),
          eq(addresses.customerId, session.customerId)
        )
      )
      .limit(1);
    if (!found) {
      return c.json({ code: 'ADDRESS_NOT_FOUND', message: '收货地址不存在' }, 404);
    }
    address = found;
  }

  const contactName =
    address?.contactName ?? session.nickname ?? session.userName ?? session.phone;
  const contactPhone = address?.contactPhone ?? session.phone ?? session.userPhone;
  const addressText = address
    ? `${address.province ?? ''}${address.city ?? ''}${address.district ?? ''}${address.detail}`
    : null;

  const groups = parsed.data.groups.map((group) => {
    const items = rows.filter(
      (row) => row.shopId === group.shopId && requested.get(row.itemId)?.group === group
    );
    return {
      ...group,
      items,
      remark: group.remark?.trim() || items[0]?.cartRemark?.trim() || parsed.data.remark?.trim() || null
    };
  });

  try {
    const created = await db.transaction(async (tx) => {
      const paymentMethod = parsed.data.paymentMethod;
      const payOnline = isOnlinePayment(paymentMethod);
      const trackedSkuIds = [
        ...new Set(
          rows.filter((row) => row.stockType === 'tracked').map((row) => row.skuId)
        )
      ];
      const lockedStocks = new Map<string, number>();
      if (trackedSkuIds.length > 0) {
        const stockRows = await tx
          .select({
            skuId: productSkuStocks.productSkuId,
            quantity: productSkuStocks.quantity
          })
          .from(productSkuStocks)
          .where(inArray(productSkuStocks.productSkuId, trackedSkuIds))
          .for('update');
        for (const stock of stockRows) {
          lockedStocks.set(stock.skuId, cents(stock.quantity));
        }
      }

      const resultIds: string[] = [];
      const affectedCartIds = new Set<string>();

      for (const group of groups) {
        if (group.items.length === 0) {
          throw new OrderError('ITEM_NOT_FOUND', '购物车条目不存在，请刷新后重试', 409);
        }

        let totalCents = 0;
        let countCents = 0;
        for (const item of group.items) {
          if (item.stockType === 'tracked') {
            const available = lockedStocks.get(item.skuId);
            if (available === undefined) {
              throw new OrderError('STOCK_ROW_MISSING', `「${item.name}」缺少库存记录`, 409);
            }
            if (cents(item.quantity) > available) {
              throw new OrderError('STOCK_INSUFFICIENT', `「${item.name}」库存不足`, 409);
            }
          }
          totalCents += cents(item.unitPrice) * quantityNumber(item.quantity);
          countCents += cents(item.quantity);
        }

        const totalAmount = money(totalCents);
        const [order] = await tx
          .insert(orders)
          .values({
            orderNo: orderNo(),
            shopId: group.shopId,
            customerId: session.customerId,
            status: payOnline ? 'pending_payment' : 'paid',
            fulfillmentType: parsed.data.fulfillmentType,
            addressId: address?.id ?? null,
            contactName,
            contactPhone,
            addressText,
            itemCount: money(countCents),
            subtotal: totalAmount,
            totalAmount,
            paymentMethod,
            remark: group.remark
          })
          .returning({ id: orders.id, orderNo: orders.orderNo });
        resultIds.push(order.id);

        await tx.insert(orderPayments).values({
          orderId: order.id,
          method: paymentMethod,
          provider: payOnline ? PAYMENT_PROVIDER : 'offline',
          amount: totalAmount,
          status: payOnline ? 'created' : 'offline'
        });

        for (const item of group.items) {
          const lineCents = cents(item.unitPrice) * quantityNumber(item.quantity);
          await tx.insert(orderItems).values({
            orderId: order.id,
            productId: item.productId,
            productSkuId: item.skuId,
            name: item.name,
            specName: item.specName,
            imageUrl: item.imageUrl,
            unit: item.unit,
            quantityMode: item.quantityMode,
            unitPrice: money(cents(item.unitPrice)),
            quantity: money(cents(item.quantity)),
            subtotal: money(lineCents)
          });

          if (item.stockType === 'tracked') {
            const available = lockedStocks.get(item.skuId) ?? 0;
            const afterCents = available - cents(item.quantity);
            lockedStocks.set(item.skuId, afterCents);
            await tx
              .update(productSkuStocks)
              .set({ quantity: money(afterCents), updatedAt: new Date() })
              .where(eq(productSkuStocks.productSkuId, item.skuId));
            await tx.insert(stockMovements).values({
              shopId: item.shopId,
              productSkuId: item.skuId,
              movementType: 'sale_out',
              quantityChange: `-${money(cents(item.quantity))}`,
              balanceAfter: money(afterCents),
              referenceType: 'order',
              referenceId: order.id,
              operatorUserId: session.userId,
              remark: `订单出库 ${order.orderNo}`
            });
          }

          affectedCartIds.add(item.cartId);
        }
      }

      await tx.delete(cartItems).where(inArray(cartItems.id, itemIds));
      for (const cartId of affectedCartIds) {
        const [remaining] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(cartItems)
          .where(eq(cartItems.cartId, cartId));
        if (Number(remaining?.count ?? 0) === 0) {
          await tx.delete(carts).where(eq(carts.id, cartId));
        } else {
          await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
        }
      }

      // 线上支付要等付款成功才计入消费；货到付款下单即算
      if (!payOnline) {
        const spentCents = groups
          .flatMap((group) => group.items)
          .reduce((sum, item) => sum + cents(item.unitPrice) * quantityNumber(item.quantity), 0);
        await adjustCustomerStats(tx, session.customerId, {
          orders: groups.length,
          spentCents
        });
      }

      return resultIds;
    });

    return c.json({ orders: await listOrders(session.customerId, created) }, 201);
  } catch (error) {
    if (error instanceof OrderError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

/** 支付待付款订单：多店多单可以一次付完，逐单记账并计入顾客消费 */
mobileOrderRoutes.post('/pay', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = paySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '支付信息不完整' },
      400
    );
  }
  const ids = [...new Set(parsed.data.orderIds)];
  const db = await getDb();

  try {
    const paidIds = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: orders.id,
          status: orders.status,
          totalAmount: orders.totalAmount,
          paymentMethod: orders.paymentMethod
        })
        .from(orders)
        .where(and(eq(orders.customerId, session.customerId), inArray(orders.id, ids)))
        .for('update');

      if (rows.length !== ids.length) {
        throw new OrderError('ORDER_NOT_FOUND', '订单不存在，请刷新后重试', 404);
      }
      for (const row of rows) {
        if (row.status !== 'pending_payment') {
          throw new OrderError('ORDER_NOT_PAYABLE', '订单状态已经变化，请刷新后重试', 409);
        }
      }

      for (const row of rows) {
        const charge = chargePayment(row.totalAmount);
        await tx
          .update(orders)
          .set({
            status: 'paid',
            paidAt: charge.paidAt,
            updatedAt: charge.paidAt
          })
          .where(eq(orders.id, row.id));
        await tx
          .update(orderPayments)
          .set({
            status: 'paid',
            provider: charge.provider,
            externalNo: charge.externalNo,
            amount: charge.amount,
            paidAt: charge.paidAt,
            updatedAt: charge.paidAt
          })
          .where(eq(orderPayments.orderId, row.id));
        await adjustCustomerStats(tx, session.customerId, {
          orders: 1,
          spentCents: cents(row.totalAmount)
        });
      }

      return rows.map((row) => row.id);
    });

    return c.json({ orders: await listOrders(session.customerId, paidIds) });
  } catch (error) {
    if (error instanceof OrderError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

/**
 * 顾客说「不要了」：
 * - 没付钱（待支付 / 货到付款）直接取消并回补库存；
 * - 线上已收款转成退款申请（refund_pending），店长确认后才退款、回补库存。
 */
mobileOrderRoutes.post('/:id/cancel', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const id = c.req.param('id');
  const parsed = cancelSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '取消信息不完整' },
      400
    );
  }
  const reason = parsed.data.reason?.trim() || '顾客取消订单';
  const db = await getDb();

  try {
    const refundPending = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          shopId: orders.shopId,
          status: orders.status,
          totalAmount: orders.totalAmount,
          paymentMethod: orders.paymentMethod,
          paidAt: orders.paidAt
        })
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.customerId, session.customerId)))
        .for('update');

      if (!locked) throw new OrderError('ORDER_NOT_FOUND', '订单不存在', 404);
      if (!CUSTOMER_CANCEL_STATUSES.includes(locked.status as OrderStatus)) {
        throw new OrderError(
          'CANCEL_NOT_ALLOWED',
          `订单已经是「${statusLabel(locked.status)}」，请联系门店处理`,
          409
        );
      }

      const now = new Date();
      if (isOnlinePayment(locked.paymentMethod) && locked.paidAt !== null) {
        await tx
          .update(orders)
          .set({
            status: 'refund_pending',
            refundReason: reason,
            refundRejectedReason: null,
            statusBeforeRefund: locked.status,
            updatedAt: now
          })
          .where(eq(orders.id, id));
        return true;
      }

      await restoreOrderStock(tx, {
        orderId: id,
        shopId: locked.shopId,
        orderNo: locked.orderNo,
        reason: '取消订单回补',
        operatorUserId: session.userId
      });
      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledReason: reason, updatedAt: now })
        .where(eq(orders.id, id));
      await tx
        .update(orderPayments)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(orderPayments.orderId, id));
      if (locked.status !== 'pending_payment') {
        await adjustCustomerStats(tx, session.customerId, {
          orders: -1,
          spentCents: -cents(locked.totalAmount)
        });
      }
      return false;
    });

    const [order] = await listOrders(session.customerId, [id]);
    return c.json({
      order: order ?? null,
      refundPending,
      message: refundPending ? '已经提交退款申请，店长确认后会退回' : '订单已经取消'
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

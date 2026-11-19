import { Hono } from 'hono';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  isOnlinePayment,
  ORDER_NEXT_STATUS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderStatus,
  type PaymentMethod
} from '@sds/shared';
import { customers, getDb, orderItems, orderPayments, orders, shops, users } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, canAccessShop } from '../lib/shop-scope.js';
import { adjustCustomerStats, restoreOrderStock } from '../lib/order-settlement.js';
import { refundPayment } from '../lib/payments.js';

/**
 * 后台订单管理：列表、详情、接单/配送/完成/取消、退款审核，对应 PRD 4.3 订单管理。
 * 线上已收款的订单不能直接取消，必须走退款（退款通过才回补库存）。
 */
export const adminOrderRoutes = new Hono<AdminEnv>();

adminOrderRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function statusLabel(status: string) {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

function paymentLabel(method: string | null) {
  return method ? PAYMENT_METHOD_LABELS[method as PaymentMethod] : null;
}

function cents(value: string | number | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function httpError(status: 400 | 404 | 409, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

const statusSchema = z.object({
  status: z.enum(['preparing', 'delivering', 'pickup_ready', 'completed', 'cancelled']),
  remark: z.string().trim().max(200).optional()
});

const refundSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  remark: z.string().trim().max(200).optional()
});

/** 门店能直接退款的已收款状态；再往后（配送中/已完成）需要先与顾客沟通 */
const REFUNDABLE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'pickup_ready'];

async function loadOrderDetail(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      shopId: orders.shopId,
      shopName: shops.name,
      customerId: orders.customerId,
      customerName: sql<string>`coalesce(${customers.nickname}, ${users.name}, ${users.phone})`,
      customerPhone: sql<string | null>`coalesce(${customers.phone}, ${users.phone})`,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
      contactName: orders.contactName,
      contactPhone: orders.contactPhone,
      addressText: orders.addressText,
      itemCount: orders.itemCount,
      subtotal: orders.subtotal,
      deliveryFee: orders.deliveryFee,
      discountAmount: orders.discountAmount,
      totalAmount: orders.totalAmount,
      paymentMethod: orders.paymentMethod,
      remark: orders.remark,
      cancelledReason: orders.cancelledReason,
      paidAt: orders.paidAt,
      completedAt: orders.completedAt,
      refundedAt: orders.refundedAt,
      refundAmount: orders.refundAmount,
      refundReason: orders.refundReason,
      refundRejectedReason: orders.refundRejectedReason,
      statusBeforeRefund: orders.statusBeforeRefund,
      paymentStatus: orderPayments.status,
      paymentProvider: orderPayments.provider,
      paymentExternalNo: orderPayments.externalNo,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt
    })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(orderPayments, eq(orderPayments.orderId, orders.id))
    .where(eq(orders.id, id))
    .limit(1);

  if (!row) return null;

  const items = await db
    .select({
      id: orderItems.id,
      productId: orderItems.productId,
      skuId: orderItems.productSkuId,
      name: orderItems.name,
      specName: orderItems.specName,
      imageUrl: orderItems.imageUrl,
      unit: orderItems.unit,
      quantityMode: orderItems.quantityMode,
      unitPrice: orderItems.unitPrice,
      quantity: orderItems.quantity,
      subtotal: orderItems.subtotal
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .orderBy(orderItems.createdAt);

  const status = row.status as OrderStatus;
  const collected = isOnlinePayment(row.paymentMethod) && row.paidAt !== null;

  return {
    ...row,
    statusLabel: statusLabel(row.status),
    paymentMethodLabel: paymentLabel(row.paymentMethod),
    nextStatuses: ORDER_NEXT_STATUS[status] ?? [],
    // 顾客已申请退款，或门店对已收款的订单主动退款
    canApproveRefund: status === 'refund_pending' || (collected && REFUNDABLE_STATUSES.includes(status)),
    canRejectRefund: status === 'refund_pending',
    items
  };
}

adminOrderRoutes.get('/', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const denied = await guardPermission(c, 'orders.read', shopId ? { shopId } : {});
  if (denied) return denied;

  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  // 非超管只能看 admin_user_shops 绑定的门店；未绑定视为无任何门店权限
  const shopIds = await accessibleShopIds(c.get('admin').sub);
  if (shopId && shopIds !== null && !shopIds.includes(shopId)) {
    return c.json({ code: 'FORBIDDEN', message: '无权查看该门店的订单' }, 403);
  }
  if (!shopId && shopIds !== null && shopIds.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize });
  }

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';

  const conditions = [];
  if (shopId) conditions.push(eq(orders.shopId, shopId));
  else if (shopIds !== null) conditions.push(inArray(orders.shopId, shopIds));
  if (keyword) {
    conditions.push(
      or(
        ilike(orders.orderNo, `%${keyword}%`),
        ilike(orders.contactName, `%${keyword}%`),
        ilike(orders.contactPhone, `%${keyword}%`),
        ilike(customers.nickname, `%${keyword}%`),
        ilike(users.phone, `%${keyword}%`)
      )!
    );
  }
  if (status && status in ORDER_STATUS_LABELS) {
    conditions.push(eq(orders.status, status as OrderStatus));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        shopId: orders.shopId,
        shopName: shops.name,
        customerId: orders.customerId,
        customerName: sql<string>`coalesce(${customers.nickname}, ${users.name}, ${users.phone})`,
        customerPhone: sql<string | null>`coalesce(${customers.phone}, ${users.phone})`,
        status: orders.status,
        fulfillmentType: orders.fulfillmentType,
        contactName: orders.contactName,
        contactPhone: orders.contactPhone,
        itemCount: orders.itemCount,
        totalAmount: orders.totalAmount,
        remark: orders.remark,
        paymentMethod: orders.paymentMethod,
        paidAt: orders.paidAt,
        refundAmount: orders.refundAmount,
        createdAt: orders.createdAt,
        itemSummary: sql<string | null>`(
          select string_agg(oi.name, '、' order by oi.created_at)
            from order_items oi
           where oi.order_id = "orders"."id"
        )`
      })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(where)
  ]);

  return c.json({
    items: items.map((row) => ({
      ...row,
      statusLabel: statusLabel(row.status),
      paymentMethodLabel: paymentLabel(row.paymentMethod)
    })),
    total: totalRows[0]?.total ?? 0,
    page,
    pageSize
  });
});

adminOrderRoutes.get('/:id', async (c) => {
  const detail = await loadOrderDetail(c.req.param('id'));
  if (!detail) return c.json({ code: 'ORDER_NOT_FOUND', message: '订单不存在' }, 404);
  const denied = await guardPermission(c, 'orders.read', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(c.get('admin').sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '无权查看该门店的订单' }, 403);
  }
  return c.json({ order: detail });
});

adminOrderRoutes.patch('/:id/status', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const [existing] = await db
    .select({
      id: orders.id,
      shopId: orders.shopId,
      status: orders.status,
      orderNo: orders.orderNo,
      fulfillmentType: orders.fulfillmentType
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!existing) return c.json({ code: 'ORDER_NOT_FOUND', message: '订单不存在' }, 404);

  const denied = await guardPermission(c, 'orders.write', { shopId: existing.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(c.get('admin').sub, existing.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '无权处理该门店的订单' }, 403);
  }

  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '状态不合法' },
      400
    );
  }
  const next = parsed.data.status;
  const admin = c.get('admin');

  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: orders.id,
          shopId: orders.shopId,
          customerId: orders.customerId,
          status: orders.status,
          orderNo: orders.orderNo,
          fulfillmentType: orders.fulfillmentType,
          totalAmount: orders.totalAmount,
          paymentMethod: orders.paymentMethod,
          paidAt: orders.paidAt
        })
        .from(orders)
        .where(eq(orders.id, id))
        .for('update');
      if (!locked) {
        throw Object.assign(new Error('订单不存在'), { status: 404, code: 'ORDER_NOT_FOUND' });
      }
      if (!(ORDER_NEXT_STATUS[locked.status as OrderStatus] ?? []).includes(next)) {
        throw Object.assign(new Error(`订单当前状态不能变更为「${statusLabel(next)}」`), {
          status: 409,
          code: 'INVALID_STATUS_TRANSITION'
        });
      }
      if (next === 'delivering' && locked.fulfillmentType !== 'delivery') {
        throw Object.assign(new Error('到店自取的订单不需要配送'), {
          status: 400,
          code: 'INVALID_FULFILLMENT'
        });
      }
      if (next === 'pickup_ready' && locked.fulfillmentType !== 'pickup') {
        throw Object.assign(new Error('配送订单请使用配送流程'), {
          status: 400,
          code: 'INVALID_FULFILLMENT'
        });
      }

      if (next === 'cancelled') {
        if (isOnlinePayment(locked.paymentMethod) && locked.paidAt !== null) {
          throw Object.assign(new Error('线上已收款的订单请用「同意退款」处理'), {
            status: 409,
            code: 'REFUND_REQUIRED'
          });
        }
        await restoreOrderStock(tx, {
          orderId: id,
          shopId: locked.shopId,
          orderNo: locked.orderNo,
          reason: '取消订单回补',
          operatorAdminId: admin?.sub ?? null
        });
        await tx
          .update(orderPayments)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(orderPayments.orderId, id));
        if (locked.status !== 'pending_payment') {
          await adjustCustomerStats(tx, locked.customerId, {
            orders: -1,
            spentCents: -cents(locked.totalAmount)
          });
        }
      }

      await tx
        .update(orders)
        .set({
          status: next,
          completedAt: next === 'completed' ? new Date() : undefined,
          cancelledReason:
            next === 'cancelled' ? parsed.data.remark?.trim() || '门店取消订单' : undefined,
          updatedAt: new Date()
        })
        .where(eq(orders.id, id));
    });
  } catch (error) {
    const known = error as { status?: number; code?: string; message?: string };
    if (known.status && known.code) {
      return c.json({ code: known.code, message: known.message ?? '操作失败' }, known.status as 400);
    }
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        return c.json({ code: 'DUPLICATE_MOVEMENT', message: '该订单已经回补过库存' }, 409);
      }
    }
    throw error;
  }

  return c.json({ order: await loadOrderDetail(id) });
});

/**
 * 退款审核，对应 PRD 6 章「已付款走店长确认」：
 * - approve：退钱（沙箱通道记账）、回补库存、回退顾客累计，订单转 refunded；
 * - reject：驳回顾客申请，订单回到申请前的状态，并记下驳回理由给顾客看。
 */
adminOrderRoutes.post('/:id/refund', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const [existing] = await db
    .select({ id: orders.id, shopId: orders.shopId })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!existing) return c.json({ code: 'ORDER_NOT_FOUND', message: '订单不存在' }, 404);

  const denied = await guardPermission(c, 'orders.write', { shopId: existing.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(c.get('admin').sub, existing.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '无权处理该门店的订单' }, 403);
  }

  const parsed = refundSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '退款参数不合法' },
      400
    );
  }
  const { decision } = parsed.data;
  const remark = parsed.data.remark?.trim();
  const admin = c.get('admin');

  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: orders.id,
          orderNo: orders.orderNo,
          shopId: orders.shopId,
          customerId: orders.customerId,
          status: orders.status,
          totalAmount: orders.totalAmount,
          paymentMethod: orders.paymentMethod,
          paidAt: orders.paidAt,
          refundReason: orders.refundReason,
          statusBeforeRefund: orders.statusBeforeRefund
        })
        .from(orders)
        .where(eq(orders.id, id))
        .for('update');
      if (!locked) throw httpError(404, 'ORDER_NOT_FOUND', '订单不存在');

      const now = new Date();

      if (decision === 'reject') {
        if (locked.status !== 'refund_pending') {
          throw httpError(409, 'INVALID_STATUS_TRANSITION', '该订单没有待审核的退款申请');
        }
        await tx
          .update(orders)
          .set({
            status: locked.statusBeforeRefund ?? 'paid',
            statusBeforeRefund: null,
            refundRejectedReason: remark || '门店驳回了退款申请',
            updatedAt: now
          })
          .where(eq(orders.id, id));
        return;
      }

      const collected = isOnlinePayment(locked.paymentMethod) && locked.paidAt !== null;
      if (locked.status !== 'refund_pending') {
        if (!collected || !REFUNDABLE_STATUSES.includes(locked.status as OrderStatus)) {
          throw httpError(409, 'INVALID_STATUS_TRANSITION', '该订单当前状态不能退款');
        }
      }
      if (!collected) {
        throw httpError(409, 'REFUND_NOT_COLLECTED', '这笔订单没有线上收款，直接取消即可');
      }

      const refund = refundPayment(locked.totalAmount);
      await restoreOrderStock(tx, {
        orderId: id,
        shopId: locked.shopId,
        orderNo: locked.orderNo,
        reason: '退款回补',
        operatorAdminId: admin?.sub ?? null
      });
      await tx
        .update(orders)
        .set({
          status: 'refunded',
          refundedAt: refund.refundedAt,
          refundAmount: refund.amount,
          refundReason: locked.refundReason ?? remark ?? null,
          statusBeforeRefund: null,
          cancelledReason:
            locked.status === 'refund_pending' ? undefined : remark || '门店退款并取消订单',
          updatedAt: now
        })
        .where(eq(orders.id, id));
      await tx
        .update(orderPayments)
        .set({
          status: 'refunded',
          refundedAt: refund.refundedAt,
          refundReason: remark ?? locked.refundReason ?? null,
          updatedAt: now
        })
        .where(eq(orderPayments.orderId, id));
      await adjustCustomerStats(tx, locked.customerId, {
        orders: -1,
        spentCents: -cents(locked.totalAmount)
      });
    });
  } catch (error) {
    const known = error as { status?: number; code?: string; message?: string };
    if (known.status && known.code) {
      return c.json(
        { code: known.code, message: known.message ?? '操作失败' },
        known.status as 400
      );
    }
    throw error;
  }

  return c.json({ order: await loadOrderDetail(id) });
});

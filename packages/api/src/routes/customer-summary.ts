import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { addresses, getDb, orders } from '@sds/db';
import type { OrderStatus } from '@sds/shared';
import { findCustomerSession, tokenFromHeader } from '../lib/customer-session.js';

/**
 * 顶栏下拉菜单的两个数字：只做 count，不返回订单/地址明细。
 * 之前顶栏复用了订单列表接口（最近 50 单含商品），每次导航都拉着整页数据。
 */
const ONGOING_STATUSES: OrderStatus[] = [
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'refund_pending'
];

export const customerSummaryRoutes = new Hono();

customerSummaryRoutes.get('/', async (c) => {
  const session = await findCustomerSession(tokenFromHeader(c.req.header('Authorization')));
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const db = await getDb();
  const [addressRows, orderRows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(addresses)
      .where(eq(addresses.customerId, session.customerId)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, session.customerId),
          inArray(orders.status, ONGOING_STATUSES)
        )
      )
  ]);

  return c.json({
    addressCount: Number(addressRows[0]?.total ?? 0),
    ongoingOrderCount: Number(orderRows[0]?.total ?? 0)
  });
});

import { and, eq, gt } from 'drizzle-orm';
import { customerSessions, customers, getDb, users } from '@sds/db';

/**
 * 顾客会话读取：供 /api/auth 与 /api/mobile/cart 共用。
 * token 为不透明随机串，落 customer_sessions；过期即视为未登录。
 */
export type CustomerSessionRow = {
  customerId: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  totalOrders: number;
  createdAt: Date;
  userId: string;
  userPhone: string;
  userName: string | null;
};

export function tokenFromHeader(header: string | undefined) {
  if (!header) return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function findCustomerSession(token: string): Promise<CustomerSessionRow | null> {
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({
      customerId: customers.id,
      nickname: customers.nickname,
      phone: customers.phone,
      avatarUrl: users.avatarUrl,
      totalOrders: customers.totalOrders,
      createdAt: customers.createdAt,
      userId: users.id,
      userPhone: users.phone,
      userName: users.name
    })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(customerSessions.token, token), gt(customerSessions.expiresAt, new Date())))
    .limit(1);
  return (rows[0] as unknown as CustomerSessionRow | undefined) ?? null;
}

export function customerPayload(row: CustomerSessionRow) {
  return {
    id: row.customerId,
    nickname: row.nickname,
    phone: row.phone ?? row.userPhone,
    avatarUrl: row.avatarUrl,
    totalOrders: Number(row.totalOrders),
    createdAt: row.createdAt
  };
}

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { customerSessions, customers, getDb, users } from '@sds/db';
import {
  customerPayload,
  findCustomerSession,
  tokenFromHeader,
  type CustomerSessionRow
} from '../lib/customer-session';

/**
 * 顾客端认证，对应 PRD 6.2 认证模块。
 *
 * ⚠️ 开发态临时方案：仓库尚未接入短信服务商，`send-code` 不真正发短信，
 * 验证码固定为 123456（可用 DEV_SMS_CODE 覆盖）。登录校验也直接比对这个固定值。
 * 正式上线前必须替换为「真实短信下发 + 一次性验证码（有效期/频控/防爆破）」，
 * 不要把固定验证码当作正式产品行为。
 */
export const authRoutes = new Hono();

const DEV_FIXED_CODE = process.env.DEV_SMS_CODE ?? '123456';
const SESSION_DAYS = 30;

const phoneSchema = z.string().trim().regex(/^1[3-9]\d{9}$/, '请输入正确的 11 位手机号');
const codeSchema = z.string().trim().regex(/^\d{6}$/, '验证码为 6 位数字');

const loginSchema = z.object({
  phone: phoneSchema,
  code: codeSchema,
  /** login：已注册手机号直接登录；register：新手机号建号 */
  mode: z.enum(['login', 'register']).default('login'),
  nickname: z.string().trim().max(50).optional()
});

function toCustomerPayload(row: CustomerSessionRow) {
  return customerPayload(row);
}

authRoutes.post('/send-code', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ phone: phoneSchema }).safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_PHONE', message: '请输入正确的 11 位手机号' }, 400);
  }

  // ⚠️ 临时方案：这里不调用短信服务，直接把固定验证码回给客户端，便于开发联调。
  return c.json({
    devMode: true,
    devCode: DEV_FIXED_CODE,
    expiresIn: 300,
    message: '开发态固定验证码（临时方案，接入短信服务后移除）'
  });
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }
  const { phone, code, mode, nickname } = parsed.data;

  // ⚠️ 临时方案：固定验证码比对；接入短信后改为校验一次性验证码及有效期。
  if (code !== DEV_FIXED_CODE) {
    return c.json({ code: 'INVALID_CODE', message: '验证码不正确' }, 400);
  }
  if (mode === 'register' && !nickname) {
    return c.json({ code: 'NAME_REQUIRED', message: '请填写姓名' }, 400);
  }

  const db = await getDb();
  const outcome = await db.transaction(async (tx) => {
    const existingUser = (
      await tx.select().from(users).where(eq(users.phone, phone)).limit(1)
    )[0];

    if (mode === 'register') {
      if (existingUser) {
        return { error: { code: 'ACCOUNT_EXISTS', message: '该手机号已注册，请直接登录', status: 409 } };
      }
      const user = (
        await tx.insert(users).values({ phone, name: nickname ?? null }).returning()
      )[0];
      const customer = (
        await tx
          .insert(customers)
          .values({ userId: user.id, nickname: nickname ?? null, realName: nickname ?? null, phone })
          .returning()
      )[0];
      return { user, customer, isNew: true };
    }

    if (!existingUser) {
      return {
        error: { code: 'ACCOUNT_NOT_FOUND', message: '该手机号还没有注册，请先注册', status: 404 }
      };
    }
    if (!existingUser.isActive) {
      return { error: { code: 'ACCOUNT_DISABLED', message: '账号已停用，请联系门店', status: 403 } };
    }

    let customer = (
      await tx.select().from(customers).where(eq(customers.userId, existingUser.id)).limit(1)
    )[0];
    if (!customer) {
      customer = (
        await tx
          .insert(customers)
          .values({ userId: existingUser.id, nickname: existingUser.name, phone })
          .returning()
      )[0];
    }
    if (nickname && nickname !== customer.nickname) {
      customer = (
        await tx
          .update(customers)
          .set({ nickname, phone, updatedAt: new Date() })
          .where(eq(customers.id, customer.id))
          .returning()
      )[0];
    }
    return { user: existingUser, customer, isNew: false };
  });

  if ('error' in outcome && outcome.error) {
    return c.json({ code: outcome.error.code, message: outcome.error.message }, outcome.error.status as 403 | 404 | 409);
  }

  const { user, customer, isNew } = outcome as {
    user: typeof users.$inferSelect;
    customer: typeof customers.$inferSelect;
    isNew: boolean;
  };

  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(customerSessions).values({ customerId: customer.id, token, expiresAt });

  return c.json({
    accessToken: token,
    expiresAt: expiresAt.toISOString(),
    isNew,
    customer: {
      id: customer.id,
      nickname: customer.nickname,
      phone: customer.phone ?? user.phone,
      avatarUrl: user.avatarUrl,
      totalOrders: Number(customer.totalOrders),
      createdAt: customer.createdAt
    },
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role }
  });
});

authRoutes.get('/me', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  const session = await findCustomerSession(token);
  if (!session) {
    return c.json({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' }, 401);
  }
  return c.json({
    customer: toCustomerPayload(session),
    user: { id: session.userId, phone: session.userPhone, name: session.userName }
  });
});

authRoutes.post('/logout', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  if (token) {
    const db = await getDb();
    await db.delete(customerSessions).where(eq(customerSessions.token, token));
  }
  return c.json({ ok: true });
});

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { and, eq, ilike, ne } from 'drizzle-orm';
import { z } from 'zod';
import { customerSessions, customers, getDb, users } from '@sds/db';
import {
  customerPayload,
  findCustomerSession,
  tokenFromHeader,
  type CustomerSessionRow
} from '../lib/customer-session';
import { hashPassword } from '../lib/password';
import {
  publicObjectUrl,
  readStorageConfig,
  StorageNotConfiguredError,
  uploadObject
} from '../lib/storage';

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

const nicknameSchema = z
  .string()
  .trim()
  .min(2, '用户名至少 2 个字')
  .max(20, '用户名最多 20 个字')
  .regex(/^\S+$/, '用户名不能包含空格');

const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(32, '密码最多 32 位')
  .regex(/^(?=.*[A-Za-z])(?=.*\d)\S+$/, '密码需同时包含字母和数字，且不能有空格');

/** 个人信息页：修改用户名（同时同步 users.name 与 customers.nickname） */
authRoutes.patch('/profile', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  const session = await findCustomerSession(token);
  if (!session) {
    return c.json({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ nickname: nicknameSchema }).safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const nickname = parsed.data.nickname;
  const db = await getDb();
  const sameName = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(ilike(users.name, nickname), ne(users.id, session.userId)))
    .limit(20);
  if (sameName.some((row) => (row.name ?? '').trim().toLowerCase() === nickname.toLowerCase())) {
    return c.json({ code: 'NAME_TAKEN', message: '这个用户名已被使用，换一个试试' }, 409);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ name: nickname, updatedAt: new Date() })
      .where(eq(users.id, session.userId));
    await tx
      .update(customers)
      .set({ nickname, updatedAt: new Date() })
      .where(eq(customers.id, session.customerId));
  });

  return c.json({ customer: toCustomerPayload((await findCustomerSession(token)) ?? session) });
});

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const AVATAR_CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

interface UploadedFile {
  name?: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  const file = value as UploadedFile | undefined;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof file?.arrayBuffer === 'function' &&
    typeof file?.type === 'string' &&
    typeof file?.size === 'number'
  );
}

/** 个人信息页：上传头像，沿用管理端同一套 Supabase Storage 上传能力 */
authRoutes.post('/avatar', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  const session = await findCustomerSession(token);
  if (!session) {
    return c.json({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' }, 401);
  }

  const body = await c.req.parseBody().catch(() => null);
  const file = body?.file;
  if (!isUploadedFile(file)) {
    return c.json({ code: 'INVALID_BODY', message: '请选择要上传的头像图片（字段名 file）' }, 400);
  }

  const ext = AVATAR_CONTENT_TYPE_EXT[file.type];
  if (!ext) {
    return c.json({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅支持 JPG / PNG / WebP / GIF' }, 415);
  }
  if (file.size <= 0 || file.size > AVATAR_MAX_SIZE) {
    return c.json({ code: 'FILE_TOO_LARGE', message: '头像大小需在 2MB 以内' }, 413);
  }

  const config = readStorageConfig();
  if (!config) {
    return c.json(
      {
        code: 'STORAGE_NOT_CONFIGURED',
        message: '图片存储未配置，请在 .env 中填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY'
      },
      503
    );
  }

  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const path = `avatars/${month}/${crypto.randomUUID()}.${ext}`;

  try {
    await uploadObject(config, path, await file.arrayBuffer(), file.type);
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return c.json({ code: 'STORAGE_NOT_CONFIGURED', message: error.message }, 503);
    }
    console.error('[sds-api] 头像上传失败:', error);
    return c.json({ code: 'UPLOAD_FAILED', message: '头像上传失败，请稍后再试' }, 502);
  }

  const avatarUrl = publicObjectUrl(config, path);
  const db = await getDb();
  await db
    .update(users)
    .set({ avatarUrl, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  return c.json({ avatarUrl }, 201);
});

/** 个人信息页：移除头像，恢复默认字母头像 */
authRoutes.delete('/avatar', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  const session = await findCustomerSession(token);
  if (!session) {
    return c.json({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' }, 401);
  }

  const db = await getDb();
  await db
    .update(users)
    .set({ avatarUrl: null, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  return c.json({ avatarUrl: null });
});

/**
 * 个人信息页：重置密码。
 * 校验方式与登录一致（手机号 + 固定开发态验证码），只落 password_hash，不回显密码。
 * ⚠️ 顾客端登录目前仍是验证码登录，密码字段为后续密码登录预留。
 */
authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({ phone: phoneSchema, code: codeSchema, password: passwordSchema })
    .safeParse(body);
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }
  const { phone, code, password } = parsed.data;

  if (code !== DEV_FIXED_CODE) {
    return c.json({ code: 'INVALID_CODE', message: '验证码不正确' }, 400);
  }

  const db = await getDb();
  const user = (await db.select().from(users).where(eq(users.phone, phone)).limit(1))[0];
  if (!user) {
    return c.json({ code: 'ACCOUNT_NOT_FOUND', message: '该手机号还没有注册，请先注册' }, 404);
  }
  if (!user.isActive) {
    return c.json({ code: 'ACCOUNT_DISABLED', message: '账号已停用，请联系门店' }, 403);
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return c.json({ ok: true, message: '密码已重置' });
});

authRoutes.post('/logout', async (c) => {
  const token = tokenFromHeader(c.req.header('authorization'));
  if (token) {
    const db = await getDb();
    await db.delete(customerSessions).where(eq(customerSessions.token, token));
  }
  return c.json({ ok: true });
});

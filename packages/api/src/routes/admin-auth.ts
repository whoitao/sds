import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminUsers, getDb } from '@sds/db';
import { verifyPassword } from '../lib/password';
import { signAdminToken } from '../lib/jwt';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { normalizePreferences } from '../lib/preferences';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(128)
});

export const adminAuthRoutes = new Hono<AdminEnv>();

adminAuthRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: '请输入账号和密码' }, 400);
  }

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return c.json({ code: 'DB_NOT_CONFIGURED', message: '数据库未配置，暂时无法登录' }, 503);
  }

  const username = parsed.data.username.toLowerCase();
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);

  // 账号不存在与密码错误返回同一提示，避免枚举账号
  if (!admin) {
    return c.json({ code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' }, 401);
  }
  if (admin.status !== 1) {
    return c.json({ code: 'ACCOUNT_DISABLED', message: '账号已停用，请联系平台管理员' }, 403);
  }
  if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    return c.json({ code: 'ACCOUNT_LOCKED', message: '密码错误次数过多，请稍后再试' }, 423);
  }

  const passwordOk = await verifyPassword(parsed.data.password, admin.passwordHash);
  if (!passwordOk) {
    const failedCount = admin.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
    await db
      .update(adminUsers)
      .set({
        failedLoginCount: shouldLock ? 0 : failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        updatedAt: new Date()
      })
      .where(eq(adminUsers.id, admin.id));

    return c.json({ code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' }, 401);
  }

  await db
    .update(adminUsers)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(adminUsers.id, admin.id));

  const token = await signAdminToken({ sub: admin.id, username: admin.username, role: admin.role });

  return c.json({
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role
    }
  });
});

adminAuthRoutes.get('/me', requireAdmin, async (c) => {
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch {
    return c.json({ code: 'DB_NOT_CONFIGURED', message: '数据库未配置' }, 503);
  }

  const { sub } = c.get('admin');
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, sub)).limit(1);
  if (!admin || admin.status !== 1) {
    return c.json({ code: 'UNAUTHORIZED', message: '账号不存在或已停用' }, 401);
  }

  return c.json({
    admin: {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      lastLoginAt: admin.lastLoginAt,
      preferences: normalizePreferences(admin.preferences)
    }
  });
});


import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminUsers, getDb } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { DISPLAY_DENSITIES, normalizePreferences, PAGE_SIZES } from '../lib/preferences.js';

/** 后台界面偏好：主题与每页条数，按管理员账号持久化在 admin_users.preferences */
export const adminPreferenceRoutes = new Hono<AdminEnv>();

adminPreferenceRoutes.use('*', requireAdmin);

const updateSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    pageSize: z
      .number()
      .int()
      .refine((value) => (PAGE_SIZES as readonly number[]).includes(value), '每页条数仅支持 10 / 20 / 50 / 100')
      .optional(),
    displayDensity: z.enum(DISPLAY_DENSITIES, {
      message: '展示效果仅支持 compact / standard / relaxed'
    }).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个设置项');

adminPreferenceRoutes.get('/me/preferences', async (c) => {
  const db = await getDb();
  const { sub } = c.get('admin');
  const [admin] = await db
    .select({ preferences: adminUsers.preferences })
    .from(adminUsers)
    .where(eq(adminUsers.id, sub))
    .limit(1);

  if (!admin) return c.json({ code: 'UNAUTHORIZED', message: '账号不存在' }, 401);

  return c.json({ preferences: normalizePreferences(admin.preferences) });
});

adminPreferenceRoutes.patch('/me/preferences', async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const { sub } = c.get('admin');
  const [admin] = await db
    .select({ preferences: adminUsers.preferences })
    .from(adminUsers)
    .where(eq(adminUsers.id, sub))
    .limit(1);

  if (!admin) return c.json({ code: 'UNAUTHORIZED', message: '账号不存在' }, 401);

  const next = { ...normalizePreferences(admin.preferences), ...parsed.data };
  await db
    .update(adminUsers)
    .set({ preferences: next, updatedAt: new Date() })
    .where(eq(adminUsers.id, sub));

  return c.json({ preferences: next });
});

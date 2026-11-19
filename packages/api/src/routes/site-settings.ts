import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getDb, siteSettings } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { isSuperAdmin } from '../lib/shop-scope.js';
import { readSiteSettings } from '../lib/site-settings.js';

/**
 * 后台站点设置：读取与保存站点维护、SEO 默认值。
 * 没有独立的 settings 权限码，这里收敛到 super_admin（最高级管理权限）：
 * 读取与保存都只允许超管，读取也走后台鉴权；顾客端另有公开只读接口。
 */
export const siteSettingsRoutes = new Hono<AdminEnv>();

siteSettingsRoutes.use('*', requireAdmin);

async function denyUnlessSuperAdmin(c: Context<AdminEnv>) {
  const admin = c.get('admin');
  if (await isSuperAdmin(admin.sub)) return null;
  return c.json({ code: 'FORBIDDEN', message: '仅超级管理员可管理站点设置' }, 403);
}

const bodySchema = z.object({
  maintenanceEnabled: z.boolean(),
  maintenanceMessage: z.string().max(500),
  siteUrl: z.string().max(500),
  defaultTitle: z.string().max(200),
  defaultKeywords: z.string().max(300),
  defaultDescription: z.string().max(500)
});

siteSettingsRoutes.get('/site', async (c) => {
  const denied = await denyUnlessSuperAdmin(c);
  if (denied) return denied;
  return c.json(await readSiteSettings());
});

siteSettingsRoutes.put('/site', async (c) => {
  const denied = await denyUnlessSuperAdmin(c);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const maintenanceMessage = parsed.data.maintenanceMessage.trim();
  if (parsed.data.maintenanceEnabled && !maintenanceMessage) {
    return c.json(
      { code: 'INVALID_BODY', message: '启用站点维护时必须填写维护通知' },
      400
    );
  }

  const siteUrl = parsed.data.siteUrl.trim().replace(/\/+$/, '');
  if (siteUrl) {
    try {
      const url = new URL(siteUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    } catch {
      return c.json(
        { code: 'INVALID_BODY', message: '站点 URL 需为 http:// 或 https:// 开头的完整地址' },
        400
      );
    }
  }

  // 关键词允许中英文逗号输入，统一存成英文逗号并去重，方便 web 端直接 split(',')
  const defaultKeywords = parsed.data.defaultKeywords
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .join(',');

  const values = {
    maintenanceEnabled: parsed.data.maintenanceEnabled,
    maintenanceMessage,
    siteUrl,
    defaultTitle: parsed.data.defaultTitle.trim(),
    defaultKeywords,
    defaultDescription: parsed.data.defaultDescription.trim()
  };

  const admin = c.get('admin');
  const db = await getDb();
  await db
    .insert(siteSettings)
    .values({ id: 1, ...values, updatedBy: admin.sub, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: { ...values, updatedBy: admin.sub, updatedAt: new Date() }
    });

  return c.json(await readSiteSettings());
});

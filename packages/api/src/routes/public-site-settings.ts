import { Hono } from 'hono';
import { readSiteSettings } from '../lib/site-settings.js';

/**
 * 顾客端公开的站点配置。
 * 只输出维护开关/维护文案与 SEO 默认值，不包含保存人、内部 ID 等信息。
 * 维护开关需要即时生效，因此不做 CDN/浏览器缓存。
 */
export const publicSiteSettingsRoutes = new Hono();

publicSiteSettingsRoutes.get('/site', async (c) => {
  const settings = await readSiteSettings();
  c.header('Cache-Control', 'no-store');
  return c.json({
    maintenanceEnabled: settings.maintenanceEnabled,
    maintenanceMessage: settings.maintenanceMessage,
    siteUrl: settings.siteUrl,
    defaultTitle: settings.defaultTitle,
    defaultKeywords: settings.defaultKeywords,
    defaultDescription: settings.defaultDescription,
    updatedAt: settings.updatedAt
  });
});

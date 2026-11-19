import { eq } from 'drizzle-orm';
import { adminUsers, getDb, siteSettings } from '@sds/db';

/** 维护通知缺省文案；表中为空时回退到这里，避免顾客端出现空提示 */
export const DEFAULT_MAINTENANCE_MESSAGE = '站点正在维护，请稍后访问。';

export type SiteSettingsValue = {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  siteUrl: string;
  defaultTitle: string;
  defaultKeywords: string;
  defaultDescription: string;
  /** ISO 时间；从未保存过为 null */
  updatedAt: string | null;
  /** 最后保存人；只给 admin 用，公开接口会剔除 */
  updatedByName: string | null;
};

/** 单行配置读取：没有行或字段为空时都回落到默认值，调用方不用处理 null */
export async function readSiteSettings(): Promise<SiteSettingsValue> {
  const db = await getDb();
  const [row] = await db
    .select({
      maintenanceEnabled: siteSettings.maintenanceEnabled,
      maintenanceMessage: siteSettings.maintenanceMessage,
      siteUrl: siteSettings.siteUrl,
      defaultTitle: siteSettings.defaultTitle,
      defaultKeywords: siteSettings.defaultKeywords,
      defaultDescription: siteSettings.defaultDescription,
      updatedAt: siteSettings.updatedAt,
      updatedByName: adminUsers.displayName
    })
    .from(siteSettings)
    .leftJoin(adminUsers, eq(adminUsers.id, siteSettings.updatedBy))
    .where(eq(siteSettings.id, 1))
    .limit(1);

  if (!row) {
    return {
      maintenanceEnabled: false,
      maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
      siteUrl: '',
      defaultTitle: '',
      defaultKeywords: '',
      defaultDescription: '',
      updatedAt: null,
      updatedByName: null
    };
  }

  return {
    ...row,
    maintenanceMessage: row.maintenanceMessage.trim() || DEFAULT_MAINTENANCE_MESSAGE,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null
  };
}

import { cache } from 'react';
import { apiRequest } from '@/lib/api';

/** 顾客端可见的站点配置，只包含公开字段 */
export type SiteSettings = {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  siteUrl: string;
  defaultTitle: string;
  defaultKeywords: string;
  defaultDescription: string;
};

/** 接口不可用或字段为空时的兜底：与接入前代码里的默认值保持一致 */
export const SITE_SETTINGS_FALLBACK: SiteSettings = {
  maintenanceEnabled: false,
  maintenanceMessage: '站点正在维护，请稍后访问。',
  siteUrl: '',
  defaultTitle: '捎点啥 · 顾客端',
  defaultKeywords: '',
  defaultDescription: '面向老年人的多店铺买菜与生鲜电商'
};

type PublicSiteSettingsPayload = Partial<Record<keyof SiteSettings, unknown>> & {
  updatedAt?: string | null;
};

function pickText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * 读取站点配置：同一请求内 layout 与 metadata 共用一次取数。
 * 接口按 no-store 返回，这里也不缓存，开关切换后下一次请求即生效。
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  const response = await apiRequest<PublicSiteSettingsPayload>('/api/settings/site');
  // 接口挂掉时按「未开启维护 + 代码默认值」处理，不能因为配置服务不可用而让站点整体打不开
  if (!response.ok || !response.data) return SITE_SETTINGS_FALLBACK;

  const data = response.data;
  return {
    maintenanceEnabled: data.maintenanceEnabled === true,
    maintenanceMessage: pickText(
      data.maintenanceMessage,
      SITE_SETTINGS_FALLBACK.maintenanceMessage
    ),
    siteUrl: pickText(data.siteUrl, ''),
    defaultTitle: pickText(data.defaultTitle, SITE_SETTINGS_FALLBACK.defaultTitle),
    defaultKeywords: pickText(data.defaultKeywords, ''),
    defaultDescription: pickText(
      data.defaultDescription,
      SITE_SETTINGS_FALLBACK.defaultDescription
    )
  };
});

/**
 * 是否正式环境：Vercel 以部署环境为准，其它平台退回 NODE_ENV。
 * 开发（development）与预览（preview）即使开了维护开关也照常访问。
 */
export function isProductionDeployment() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === 'production';
  return process.env.NODE_ENV === 'production';
}

/** 只接受 http(s) 绝对地址，非法或为空时返回 null，由调用方跳过 canonical/OG 绝对地址 */
export function normalizeSiteUrl(value: string): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** 关键词支持中英文逗号、分号分隔，空项自动丢弃 */
export function parseKeywords(value: string): string[] {
  return value
    .split(/[,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

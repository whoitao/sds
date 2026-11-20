/**
 * 语言配置与纯函数：不依赖请求上下文，客户端与服务端都可以引用。
 * 语言值写进 cookie，服务端渲染时直接读到，避免首帧先中文再切英文。
 */

export const LOCALE_COOKIE = 'sds_locale';

export const LOCALES = ['zh', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh';

/** 把 cookie / 表单里的值收敛成两档之一，非法值回落到中文 */
export function parseLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** <html lang> 取值 */
export function htmlLangOf(locale: Locale): string {
  return locale === 'en' ? 'en' : 'zh-CN';
}

/** Intl 日期等格式化用的 BCP 47 标签 */
export function dateLocaleOf(locale: Locale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}

/** 文案里的占位符统一写成 {name}，缺值时保留原样便于发现漏配 */
export function formatMessage(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

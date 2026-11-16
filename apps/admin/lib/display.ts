/**
 * 展示效果（密度）设置：全局控制字号、行高、字间距与元素间距。
 * 三档取值与 antd token（app/providers.tsx）和 globals.css 的 CSS 变量一一对应。
 */
export type DisplayDensity = 'compact' | 'standard' | 'relaxed';

export const DISPLAY_DENSITIES = ['compact', 'standard', 'relaxed'] as const;

export const DEFAULT_DISPLAY_DENSITY: DisplayDensity = 'standard';

/** 记录「最终展示效果」，供服务端首帧写入 html[data-display]，避免刷新闪烁 */
export const DISPLAY_COOKIE = 'sds_display';

export function isDisplayDensity(value: string | undefined | null): value is DisplayDensity {
  return value === 'compact' || value === 'standard' || value === 'relaxed';
}

/** 仅在浏览器执行：把展示效果写回 cookie（非 httpOnly，客户端需要自己维护） */
export function writeDisplayCookie(density: DisplayDensity) {
  if (typeof document === 'undefined') return;
  document.cookie = `${DISPLAY_COOKIE}=${density}; path=/; max-age=31536000; samesite=lax`;
}

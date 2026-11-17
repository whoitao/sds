export const THEME_COOKIE = 'sds_theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/** 把 cookie / 表单里的值收敛成三档之一，非法值回落到跟随系统 */
export function parseTheme(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** 读取浏览器里的主题偏好；首屏由 layout 内联脚本兜底，这里给交互时用 */
export function readThemeCookie(): ThemePreference {
  if (typeof document === 'undefined') return 'system';
  const match = document.cookie.match(/(?:^|;\s*)sds_theme=(light|dark|system)/);
  return parseTheme(match?.[1]);
}

export function writeThemeCookie(preference: ThemePreference) {
  document.cookie = `${THEME_COOKIE}=${preference}; path=/; max-age=31536000; samesite=lax`;
}

/** 当前偏好是否需要深色：跟随系统时看 prefers-color-scheme */
export function shouldUseDark(preference: ThemePreference) {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 切换根节点 class；Tailwind 的 dark: 与 CSS 变量都会跟着变 */
export function applyTheme(preference: ThemePreference) {
  const dark = shouldUseDark(preference);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

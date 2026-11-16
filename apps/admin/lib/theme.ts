/**
 * admin 品牌主色：唯一色值来源。
 * antd token（providers.tsx）与手写样式引用的 CSS 变量都由这里生成，页面与组件不再写死色值。
 * 深色主题单独给出 soft/strong 两档，保证深底上的选中态与强调文字可读。
 */
export const adminBrand = {
  /** 浅色主题主色 */
  primary: '#4C9A6A',
  /** 浅色主题选中底色 */
  softLight: '#E8F2EC',
  /** 浅色主题强调文字（链接、选中项文字），在白底上对比度 ≥ 4.5 */
  strongLight: '#356B48',
  /** 深色主题主色：同色系提亮，用于深底上的按钮与强调元素 */
  primaryDark: '#5FB37F',
  /** 深色主题选中底色 */
  softDark: '#203028',
  /** 深色主题强调文字，在深底上对比度 ≥ 4.5 */
  strongDark: '#8FD3A8'
} as const;

/** 由品牌常量生成 CSS 变量，根布局注入，避免 globals.css 再写一份色值 */
export function adminBrandCss() {
  const { primary, softLight, strongLight, primaryDark, softDark, strongDark } = adminBrand;
  return [
    `:root{--admin-primary:${primary};--admin-primary-soft:${softLight};--admin-primary-strong:${strongLight};}`,
    `[data-theme='dark']{--admin-primary:${primaryDark};--admin-primary-soft:${softDark};--admin-primary-strong:${strongDark};}`
  ].join('');
}

/**
 * admin 端自定义配色。中性色与明暗切换变量定义在 app/globals.css，
 * 品牌相关的 --admin-primary* 由 adminBrandCss() 在根布局注入；组件只引用变量名。
 */
export const adminColors = {
  page: 'var(--admin-page)',
  surface: 'var(--admin-surface)',
  border: 'var(--admin-border)',
  text: 'var(--admin-text)',
  textSecondary: 'var(--admin-text-secondary)',
  textTertiary: 'var(--admin-text-tertiary)',
  subtle: 'var(--admin-subtle)',
  /** 品牌主色（浅色/深色由 CSS 变量切换） */
  primary: 'var(--admin-primary)',
  primarySoft: 'var(--admin-primary-soft)',
  primaryStrong: 'var(--admin-primary-strong)',
  /** 兼容既有命名：选中态底色 / 强调文字 */
  accentLight: 'var(--admin-primary-soft)',
  accentStrong: 'var(--admin-primary-strong)',
  danger: '#d9480f'
} as const;

/** 记录「最终生效」的明暗主题，供服务端首帧决定 antd 算法与 data-theme */
export const THEME_COOKIE = 'sds_theme';

export type ResolvedTheme = 'light' | 'dark';

export function isResolvedTheme(value: string | undefined | null): value is ResolvedTheme {
  return value === 'light' || value === 'dark';
}

/** 仅在浏览器执行：把解析后的明暗写回 cookie（非 httpOnly，客户端需要自己维护） */
export function writeThemeCookie(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}


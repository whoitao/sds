'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { writeThemeCookie } from '../lib/theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

interface SettingsSnapshot {
  theme: ThemePreference;
  pageSize: number;
}

interface AdminSettingsValue {
  theme: ThemePreference;
  /** 实际生效的主题：theme=system 时跟随 prefers-color-scheme */
  resolvedTheme: 'light' | 'dark';
  pageSize: number;
  setTheme: (theme: ThemePreference) => void;
  setPageSize: (pageSize: number) => void;
}

const AdminSettingsContext = createContext<AdminSettingsValue | null>(null);

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 主题与分页的全局设置：偏好持久化在管理员账号上，
 * 首屏的偏好与「最终明暗」由控制台布局在服务端解析后注入，首帧即是最终观感。
 */
export function AdminSettingsProvider({
  children,
  initialTheme,
  initialPageSize,
  initialResolvedTheme
}: {
  children: React.ReactNode;
  initialTheme: ThemePreference;
  initialPageSize: number;
  /** 服务端解析出的最终明暗；缺省时按偏好推导（system 视为浅色，客户端挂载后再跟随系统） */
  initialResolvedTheme?: 'light' | 'dark';
}) {
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);
  const [pageSize, setPageSizeState] = useState(() =>
    (PAGE_SIZE_OPTIONS as readonly number[]).includes(initialPageSize) ? initialPageSize : DEFAULT_PAGE_SIZE
  );
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(
    () => initialResolvedTheme ?? (initialTheme === 'system' ? 'light' : initialTheme)
  );

  // 主题生效：写入 html[data-theme] 与主题 cookie；system 时监听系统变化
  useEffect(() => {
    const apply = () => {
      const next = theme === 'system' ? systemTheme() : theme;
      setResolvedTheme(next);
      // color-scheme 与配色变量都由 globals.css 按 data-theme 声明，不额外写行内样式
      document.documentElement.dataset.theme = next;
      // 服务端下次渲染直接按这个值产出 antd 算法与 data-theme
      writeThemeCookie(next);
    };
    apply();

    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const persist = useCallback(async (patch: Partial<SettingsSnapshot>) => {
    try {
      await fetch('/api/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
    } catch {
      // 网络失败时保留本地设置，下次打开仍可用缓存
    }
  }, []);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      void persist({ theme: next });
    },
    [persist]
  );

  const setPageSize = useCallback(
    (next: number) => {
      const value = (PAGE_SIZE_OPTIONS as readonly number[]).includes(next) ? next : DEFAULT_PAGE_SIZE;
      setPageSizeState(value);
      void persist({ pageSize: value });
    },
    [persist]
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, pageSize, setTheme, setPageSize }),
    [theme, resolvedTheme, pageSize, setTheme, setPageSize]
  );

  return <AdminSettingsContext.Provider value={value}>{children}</AdminSettingsContext.Provider>;
}

export function useAdminSettings() {
  const value = useContext(AdminSettingsContext);
  if (!value) throw new Error('useAdminSettings 必须在 AdminSettingsProvider 内使用');
  return value;
}

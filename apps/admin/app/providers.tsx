'use client';

import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  AdminSettingsProvider,
  useAdminSettings,
  type ThemePreference
} from '../components/AdminSettingsProvider';
import { adminBrand } from '../lib/theme';

const themeToken = {
  colorPrimary: adminBrand.primary,
  fontSize: 14,
  borderRadius: 8,
  borderRadiusLG: 12,
  controlHeight: 32
};

/** 根级 antd 配置：登录等不走控制台主题的页面也保持紧凑规格与品牌主色 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm: antdTheme.compactAlgorithm, token: themeToken }}>
      {children}
    </ConfigProvider>
  );
}

/** 读取全局设置，把主题算法与紧凑模式交给 antd */
function ConsoleThemedApp({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useAdminSettings();

  return (
    <ConfigProvider
      theme={{
        algorithm:
          resolvedTheme === 'dark'
            ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
            : antdTheme.compactAlgorithm,
        token: {
          ...themeToken,
          colorPrimary: resolvedTheme === 'dark' ? adminBrand.primaryDark : adminBrand.primary
        }
      }}
    >
      {children}
    </ConfigProvider>
  );
}

/**
 * 控制台主题：首屏偏好、「最终明暗」与分页都由控制台布局在服务端解析后注入，
 * 首帧的 antd 算法与配色就是最终状态，不会先按浅色渲染再切深色。
 */
export function ConsoleProviders({
  initialTheme,
  initialPageSize,
  initialResolvedTheme,
  children
}: {
  initialTheme: ThemePreference;
  initialPageSize: number;
  initialResolvedTheme?: 'light' | 'dark';
  children: React.ReactNode;
}) {
  return (
    <AdminSettingsProvider
      initialTheme={initialTheme}
      initialPageSize={initialPageSize}
      initialResolvedTheme={initialResolvedTheme}
    >
      <ConsoleThemedApp>{children}</ConsoleThemedApp>
    </AdminSettingsProvider>
  );
}

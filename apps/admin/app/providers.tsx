'use client';

import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  AdminSettingsProvider,
  useAdminSettings,
  type ThemePreference
} from '../components/AdminSettingsProvider';
import { adminBrand } from '../lib/theme';
import type { DisplayDensity } from '../lib/display';

const themeToken = {
  colorPrimary: adminBrand.primary,
  fontSize: 14,
  borderRadius: 8,
  borderRadiusLG: 12,
  controlHeight: 32
};

/**
 * 三档展示效果对应的 antd 设计变量：
 * 紧凑 14px / 控件高 28，标准（默认）15px / 行高 1.5 / 控件高 32，
 * 宽松 16px / 行高 1.7 / 控件高 36；内边距与外边距同步收敛。
 * 字间距由 globals.css 在 html 上按 data-display 控制。
 * 档位 key 保持不变，已保存的旧偏好无需迁移即可继续使用。
 */
const densityTokens: Record<DisplayDensity, Record<string, number>> = {
  compact: {
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    lineHeight: 1.5,
    controlHeight: 28,
    padding: 12,
    paddingXS: 6,
    paddingSM: 8,
    paddingLG: 16,
    margin: 12,
    marginXS: 6,
    marginSM: 8,
    marginLG: 16
  },
  standard: {
    fontSize: 15,
    fontSizeSM: 13,
    fontSizeLG: 17,
    lineHeight: 1.5,
    controlHeight: 32,
    padding: 16,
    paddingXS: 8,
    paddingSM: 10,
    paddingLG: 20,
    margin: 16,
    marginXS: 8,
    marginSM: 10,
    marginLG: 20
  },
  relaxed: {
    fontSize: 16,
    fontSizeSM: 14,
    fontSizeLG: 18,
    lineHeight: 1.7,
    controlHeight: 36,
    padding: 20,
    paddingXS: 10,
    paddingSM: 12,
    paddingLG: 24,
    margin: 20,
    marginXS: 10,
    marginSM: 12,
    marginLG: 24
  }
};

/** 表格行高随展示密度同步收敛，覆盖默认、middle 与 small 三种尺寸。 */
const tableDensityTokens: Record<
  DisplayDensity,
  { cellPaddingBlock: number; cellPaddingBlockMD: number; cellPaddingBlockSM: number }
> = {
  compact: { cellPaddingBlock: 8, cellPaddingBlockMD: 6, cellPaddingBlockSM: 4 },
  standard: { cellPaddingBlock: 12, cellPaddingBlockMD: 8, cellPaddingBlockSM: 6 },
  relaxed: { cellPaddingBlock: 16, cellPaddingBlockMD: 10, cellPaddingBlockSM: 8 }
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
  const { resolvedTheme, displayDensity } = useAdminSettings();

  return (
    <ConfigProvider
      theme={{
        algorithm:
          resolvedTheme === 'dark'
            ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
            : antdTheme.compactAlgorithm,
        token: {
          ...themeToken,
          ...densityTokens[displayDensity],
          colorPrimary: resolvedTheme === 'dark' ? adminBrand.primaryDark : adminBrand.primary
        },
        components: {
          Table: tableDensityTokens[displayDensity]
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
  initialDisplayDensity,
  children
}: {
  initialTheme: ThemePreference;
  initialPageSize: number;
  initialResolvedTheme?: 'light' | 'dark';
  initialDisplayDensity: DisplayDensity;
  children: React.ReactNode;
}) {
  return (
    <AdminSettingsProvider
      initialTheme={initialTheme}
      initialPageSize={initialPageSize}
      initialResolvedTheme={initialResolvedTheme}
      initialDisplayDensity={initialDisplayDensity}
    >
      <ConsoleThemedApp>{children}</ConsoleThemedApp>
    </AdminSettingsProvider>
  );
}

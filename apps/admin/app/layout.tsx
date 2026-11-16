import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { adminBrandCss, isResolvedTheme, THEME_COOKIE } from '../lib/theme';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: '捎点啥 · 管理后台',
  description: '平台管理员与店长的运营后台'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 首帧就按上次解析出的明暗写死 data-theme：服务端渲染时直接落到 <html> 上，
  // 不需要在 React 树里插 <script>（React 19 会报「script 不会在客户端执行」）。
  // 账号偏好由控制台布局参与计算，客户端 Provider 挂载后会再校正一次。
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const htmlTheme = isResolvedTheme(cookieTheme) ? cookieTheme : 'light';

  return (
    <html lang="zh-CN" data-theme={htmlTheme} suppressHydrationWarning>
      <body style={{ margin: 0, background: 'var(--admin-page)', color: 'var(--admin-text)' }}>
        {/* 品牌 CSS 变量由 lib/theme.ts 的常量生成并内联，避免在 CSS 里重复写色值 */}
        <style dangerouslySetInnerHTML={{ __html: adminBrandCss() }} />
        {/* antd 6 样式运行时注入，用官方的 Next Registry 把 SSR 样式内联进 HTML，避免刷新时无样式闪一帧 */}
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { AdminSidebar } from '../../components/AdminSidebar';
import { adminColors, THEME_COOKIE, isResolvedTheme, type ResolvedTheme } from '../../lib/theme';
import { DEFAULT_DISPLAY_DENSITY, isDisplayDensity } from '../../lib/display';
import { requireAdmin } from '../../lib/session';
import { ConsoleProviders } from '../providers';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const theme = admin.preferences?.theme ?? 'system';
  const pageSize = admin.preferences?.pageSize ?? 20;
  const displayDensity = isDisplayDensity(admin.preferences?.displayDensity)
    ? admin.preferences.displayDensity
    : DEFAULT_DISPLAY_DENSITY;

  // 账号偏好优先；只有「跟随系统」才参考 cookie 里上次解析出的系统明暗
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (isResolvedTheme(cookieTheme) ? cookieTheme : 'light') : theme;

  return (
    <ConsoleProviders
      initialTheme={theme}
      initialResolvedTheme={resolvedTheme}
      initialPageSize={pageSize}
      initialDisplayDensity={displayDensity}
    >
      <div style={{ display: 'flex', minHeight: '100vh', background: adminColors.page }}>
        {/* html[data-theme] 由根布局按主题 cookie 在服务端写入，这里不再插 <script> */}
        <AdminSidebar displayName={admin.displayName} />
        <main className="admin-main" style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </ConsoleProviders>
  );
}

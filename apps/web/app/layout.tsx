import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import ThemeSync from '@/components/ThemeSync';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: '捎点啥 · 顾客端',
  description: '面向老年人的多店铺买菜与生鲜电商'
};

/**
 * 首帧脚本：在样式生效前读出主题 cookie。
 * 「跟随系统」时直接看 prefers-color-scheme，避免刷新时先亮后暗的跳变。
 */
const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const preference = parseTheme(store.get(THEME_COOKIE)?.value);
  // cookie 明确为深色时先由服务端给出 class；light/system 交给上面的脚本
  const serverDark = preference === 'dark';

  return (
    <html lang="zh-CN" className={serverDark ? 'dark' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-paper text-ink">
        {children}
        <ThemeSync />
      </body>
    </html>
  );
}

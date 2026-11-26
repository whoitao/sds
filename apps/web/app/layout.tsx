import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import LocaleProvider from '@/components/LocaleProvider';
import MaintenanceScreen from '@/components/MaintenanceScreen';
import ThemeSync from '@/components/ThemeSync';
import { LOCALE_COOKIE, htmlLangOf, parseLocale } from '@/lib/i18n/config';
import { messagesOf } from '@/lib/i18n/messages';
import {
  getSiteSettings,
  isProductionDeployment,
  normalizeSiteUrl,
  parseKeywords
} from '@/lib/site-settings';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

/**
 * 站点级 metadata：默认标题/描述/关键词与 siteUrl 来自 admin 的站点设置。
 * 页面自己的 metadata 优先，只有没写默认值的页面才会用到这里的兜底。
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const siteUrl = normalizeSiteUrl(settings.siteUrl);
  const keywords = parseKeywords(settings.defaultKeywords);

  return {
    title: settings.defaultTitle,
    description: settings.defaultDescription,
    ...(keywords.length > 0 ? { keywords } : {}),
    // siteUrl 作为 canonical 与 Open Graph 绝对地址的基础；非法或为空时不写，避免生成错误链接
    ...(siteUrl ? { metadataBase: siteUrl, alternates: { canonical: '/' } } : {}),
    openGraph: {
      type: 'website',
      locale: 'zh_CN',
      siteName: '捎点啥',
      ...(siteUrl ? { url: '/' } : {})
    }
  };
}

/**
 * 首帧脚本：在样式生效前读出主题 cookie。
 * 「跟随系统」时直接看 prefers-color-scheme，避免刷新时先亮后暗的跳变。
 */
const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 配置与主题/语言 cookie 互不依赖，一起取；维护开关只在正式环境生效
  const [store, settings] = await Promise.all([cookies(), getSiteSettings()]);
  const preference = parseTheme(store.get(THEME_COOKIE)?.value);
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value);
  // cookie 明确为深色时先由服务端给出 class；light/system 交给上面的脚本
  const serverDark = preference === 'dark';
  // 维护页替换整棵页面树：header/footer 不再渲染，/api/* 是 route handler，不经过 layout
  const maintenance = isProductionDeployment() && settings.maintenanceEnabled;

  return (
    <html
      lang={htmlLangOf(locale)}
      className={serverDark ? 'dark' : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-paper text-ink">
        <LocaleProvider locale={locale} messages={messagesOf(locale)}>
          {maintenance ? <MaintenanceScreen message={settings.maintenanceMessage} /> : children}
          <ThemeSync />
        </LocaleProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

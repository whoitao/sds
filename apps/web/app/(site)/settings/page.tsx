import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import AccountLayout from '@/components/AccountLayout';
import ThemeSettings from '@/components/ThemeSettings';
import { requireCustomer } from '@/lib/session';
import { getMessages } from '@/lib/i18n/server';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

export const metadata: Metadata = {
  title: '设置 · 捎点啥'
};

export default async function SettingsPage() {
  // 未登录会带着 next 参数跳到登录页
  await requireCustomer('/settings');

  const store = await cookies();
  const preference = parseTheme(store.get(THEME_COOKIE)?.value);
  const t = (await getMessages()).settings;

  return (
    <AccountLayout>
      <div className="flex w-full min-w-0 flex-col gap-4">
        <ThemeSettings initial={preference} />

        <section className="rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5">
          <h2 className="m-0 text-[19px] font-extrabold text-ink">{t.quickLinksTitle}</h2>
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href="/addresses"
              className="flex min-h-[54px] items-center justify-between gap-3 rounded-xl border border-line px-4 text-[16px] font-bold text-ink transition-colors hover:border-brand-200 hover:bg-brand-50/60"
            >
              {t.quickAddresses}
              <span aria-hidden className="text-[18px] text-ink-3">
                ›
              </span>
            </Link>
            <Link
              href="/"
              className="flex min-h-[54px] items-center justify-between gap-3 rounded-xl border border-line px-4 text-[16px] font-bold text-ink transition-colors hover:border-brand-200 hover:bg-brand-50/60"
            >
              {t.quickShops}
              <span aria-hidden className="text-[18px] text-ink-3">
                ›
              </span>
            </Link>
          </div>
        </section>
      </div>
    </AccountLayout>
  );
}

import Link from 'next/link';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { getMessages } from '@/lib/i18n/server';

const FOOTER_LINK = 'transition-colors hover:text-brand-700';

export default async function SiteFooter() {
  const m = await getMessages();
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-6 text-ink-2">
        <p className="m-0">{m.footer.brand}</p>
        <div className="flex shrink-0 items-center gap-5 whitespace-nowrap text-[15px] font-semibold text-ink-2">
          <Link href="/help" className={FOOTER_LINK}>
            {m.footer.help}
          </Link>
          <Link href="/about" className={FOOTER_LINK}>
            {m.footer.about}
          </Link>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  );
}

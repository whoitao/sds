'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMessages } from '@/components/LocaleProvider';

const TABS = [
  { href: '/profile', labelKey: 'menuProfile', icon: 'user' },
  { href: '/orders', labelKey: 'menuOrders', icon: 'list' },
  { href: '/addresses', labelKey: 'menuAddresses', icon: 'pin' },
  { href: '/settings', labelKey: 'menuSettings', icon: 'gear' }
] as const;

function Icon({ name, className = 'h-[22px] w-[22px]' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (name) {
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.8" />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case 'list':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    default:
      return null;
  }
}

/** 账户中心骨架：左侧页签 + 右侧内容，窄屏页签转为横向条 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const labels = useMessages().account;
  const activeHref = TABS.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))?.href;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pt-5 lg:h-full lg:flex-row lg:items-start lg:gap-6">
      <nav className="flex shrink-0 gap-1.5 overflow-x-auto rounded-[18px] border border-line bg-card p-2 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] transition-colors ${
                active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink hover:bg-card-soft'
              }`}
            >
              <Icon name={tab.icon} className="h-4 w-4 shrink-0" />
              {labels[tab.labelKey]}
            </Link>
          );
        })}
      </nav>

      <nav className="sticky top-[105px] hidden w-[190px] shrink-0 flex-col gap-1 rounded-[18px] border border-line bg-card p-3 lg:top-0 lg:flex">
        {TABS.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-[54px] items-center gap-2.5 rounded-xl px-3 text-[17px] transition-colors ${
                active
                  ? 'bg-brand-50 font-bold text-brand-700'
                  : 'text-ink hover:bg-card-soft'
              }`}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-brand-500"
                />
              ) : null}
              <Icon name={tab.icon} className="h-[22px] w-[22px] shrink-0" />
              {labels[tab.labelKey]}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">{children}</div>
    </div>
  );
}

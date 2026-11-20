'use client';

import { useState } from 'react';
import { applyTheme, writeThemeCookie, type ThemePreference } from '@/lib/theme';
import { useMessages } from '@/components/LocaleProvider';

type ThemeOption = { value: ThemePreference; titleKey: 'lightTitle' | 'darkTitle' | 'systemTitle'; descKey: 'lightDesc' | 'darkDesc' | 'systemDesc'; icon: 'sun' | 'moon' | 'auto' };

const OPTIONS: ThemeOption[] = [
  { value: 'light', titleKey: 'lightTitle', descKey: 'lightDesc', icon: 'sun' },
  { value: 'dark', titleKey: 'darkTitle', descKey: 'darkDesc', icon: 'moon' },
  { value: 'system', titleKey: 'systemTitle', descKey: 'systemDesc', icon: 'auto' }
];

function Icon({ name, className = 'h-6 w-6' }: { name: 'sun' | 'moon' | 'auto'; className?: string }) {
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
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
          <path d="M7 10a3 3 0 0 1 3-3" />
        </svg>
      );
  }
}

/**
 * 主题三档选择：写入 cookie 后立即切换根节点 class，
 * 刷新、跨页面、未登录访问设置页都由首帧脚本沿用同一 cookie。
 */
export default function ThemeSettings({ initial }: { initial: ThemePreference }) {
  const [preference, setPreference] = useState<ThemePreference>(initial);
  const t = useMessages().settings;

  function choose(value: ThemePreference) {
    setPreference(value);
    writeThemeCookie(value);
    applyTheme(value);
  }

  return (
    <section className="rounded-[20px] border border-line bg-card p-4 shadow-perk sm:p-5">
      <h2 className="m-0 text-[19px] font-extrabold text-ink">{t.themeTitle}</h2>
      <p className="m-0 mt-1 text-[14px] leading-[1.55] text-ink-3">{t.themeHint}</p>

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const active = option.value === preference;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              aria-pressed={active}
              className={`flex min-h-[76px] items-start gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50/70'
                  : 'border-line bg-card hover:border-brand-200'
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 self-center place-items-center rounded-[10px] ${
                  active ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'
                }`}
              >
                <Icon name={option.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="text-[16px] text-ink">{t[option.titleKey]}</b>
                  <span
                    className={`ml-auto grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${
                      active ? 'border-brand-600 bg-brand-600' : 'border-line bg-card'
                    }`}
                  >
                    {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                  </span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-[1.5] text-ink-3">
                  {t[option.descKey]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

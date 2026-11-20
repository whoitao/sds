'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useLocale, useMessages } from '@/components/LocaleProvider';
import { LOCALE_COOKIE, htmlLangOf, type Locale } from '@/lib/i18n/config';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' }
];

/**
 * 页脚语言切换：当前语言是静态文字，另一语言是按钮。
 * 选择后先写 cookie，再 router.refresh() 让服务端按新 cookie 重新渲染，
 * 刷新 / 跳转 / 再次访问都由服务端读同一个 cookie，不会先中文再闪成英文。
 */
export default function LocaleSwitcher() {
  const locale = useLocale();
  const messages = useMessages();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale || pending) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = htmlLangOf(next);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={messages.footer.languageAria}>
      {OPTIONS.map((option, index) => (
        <span key={option.value} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-line">
              /
            </span>
          ) : null}
          {option.value === locale ? (
            <span className="text-ink" aria-current="true">
              {option.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => choose(option.value)}
              disabled={pending}
              className="cursor-pointer transition-colors hover:text-brand-700 disabled:cursor-wait"
            >
              {option.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

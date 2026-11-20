'use client';

import { createContext, useContext } from 'react';
import type { Locale } from '@/lib/i18n/config';
import type { Messages } from '@/lib/i18n/messages';

type LocaleContextValue = {
  locale: Locale;
  messages: Messages;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** 语言字典由根布局按 cookie 取好，客户端组件通过 context 读取，避免逐层传 props */
export default function LocaleProvider({
  locale,
  messages,
  children
}: LocaleContextValue & { children: React.ReactNode }) {
  return (
    <LocaleContext.Provider value={{ locale, messages }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale 必须在 LocaleProvider 内使用');
  return value.locale;
}

export function useMessages(): Messages {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useMessages 必须在 LocaleProvider 内使用');
  return value.messages;
}

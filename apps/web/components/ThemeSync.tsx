'use client';

import { useEffect } from 'react';
import { readThemeCookie, shouldUseDark } from '@/lib/theme';

/**
 * 主题跟随：以 cookie 为准，「跟随系统」时实时响应 prefers-color-scheme。
 * 首帧由 layout 里的内联脚本先定好 class，这里只负责后续的系统切换与回到页面时校正。
 */
export default function ThemeSync() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function sync() {
      const dark = shouldUseDark(readThemeCookie());
      const root = document.documentElement;
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
    }

    sync();
    media.addEventListener('change', sync);
    window.addEventListener('focus', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return null;
}

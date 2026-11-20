/** 页脚与语言切换 */
const zh = {
  brand: '捎点啥 · 顾客端',
  help: '帮助',
  about: '关于',
  languageAria: '切换语言'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  brand: '捎点啥 · Customer',
  help: 'Help',
  about: 'About',
  languageAria: 'Switch language'
};

export const footer = { zh, en };

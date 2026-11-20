/** 设置页与主题外观文案 */
const zh = {
  themeTitle: '主题外观',
  themeHint: '选择后立即生效，并会记住你的选择。',
  lightTitle: '浅色模式',
  lightDesc: '明亮清爽，适合白天',
  darkTitle: '深色模式',
  darkDesc: '低亮度护眼，适合夜间',
  systemTitle: '跟随系统',
  systemDesc: '随设备的浅色 / 深色设置自动切换',
  quickLinksTitle: '常用入口',
  quickAddresses: '收货地址',
  quickShops: '去附近的店'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  themeTitle: 'Appearance',
  themeHint: 'Changes apply immediately and are remembered.',
  lightTitle: 'Light',
  lightDesc: 'Bright and clear, good for daytime',
  darkTitle: 'Dark',
  darkDesc: 'Lower brightness, easier on the eyes at night',
  systemTitle: 'System',
  systemDesc: 'Follows your device light / dark setting',
  quickLinksTitle: 'Quick links',
  quickAddresses: 'Addresses',
  quickShops: 'Browse nearby shops'
};

export const settings = { zh, en };

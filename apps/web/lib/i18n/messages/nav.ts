/** 页头导航文案 */
const zh = {
  searchPlaceholder: '搜菜',
  searchAria: '搜索菜品',
  cart: '购物车',
  cartAria: '购物车',
  cartCountAria: '购物车，{count} 件',
  chooseShop: '选一家店',
  currentShopTitle: '当前门店：{name}，点击换一家',
  pickShopTitle: '去附近的店挑一家',
  login: '登录',
  registerSuffix: ' / 注册',
  accountFallback: '我的账号'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  searchPlaceholder: 'Search',
  searchAria: 'Search products',
  cart: 'Cart',
  cartAria: 'Cart',
  cartCountAria: 'Cart, {count} items',
  chooseShop: 'Choose a shop',
  currentShopTitle: 'Current shop: {name}. Tap to change',
  pickShopTitle: 'Pick a nearby shop',
  login: 'Sign in',
  registerSuffix: ' / Sign up',
  accountFallback: 'My account'
};

export const nav = { zh, en };

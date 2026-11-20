/** 购物车文案：分组、勾选、商品行与购物车操作提示 */
const zh = {
  title: '购物车',
  emptyTitle: '购物车是空的',
  emptyNote: '先去店里挑点菜，再来结算。',
  goNearby: '去附近的店',
  backToShop: '回门店继续选菜',
  selectAllAria: '{shop}：全选可售商品',
  unselectAllAria: '{shop}：取消全选可售商品',
  selectedCount: '已选 {count} 样',
  nothingToCheckout: '暂无可结算',
  checkoutThisShop: '本次结这家',
  nextOrder: '下一单再结',
  offShelf: '已下架',
  soldOut: '已售罄',
  blockedAria: '{label}，无法选择：{name}',
  selectAria: '选择：{name}',
  blockedTitle: '{label}，无法选择',
  listSeparator: '、',
  otherShopHint: '不同店的菜不能合成一单，结完 {shop} 再来结这家。',
  singleShopHint: '不同店的菜不能合成一单，一单一店结算；同一家店的菜可以一起提交。',
  loginRequired: '请先登录再选菜',
  updateFailed: '购物车更新失败，请稍后再试'
} as const;

type Key = keyof typeof zh;

const en: Record<Key, string> = {
  title: 'Cart',
  emptyTitle: 'Your cart is empty',
  emptyNote: 'Pick something at a shop first, then come back to check out.',
  goNearby: 'Browse nearby shops',
  backToShop: 'Back to shop',
  selectAllAria: '{shop}: Select all available items',
  unselectAllAria: '{shop}: Deselect all available items',
  selectedCount: '{count} selected',
  nothingToCheckout: 'Nothing to check out',
  checkoutThisShop: 'Check out this shop',
  nextOrder: 'Next order',
  offShelf: 'No longer available',
  soldOut: 'Sold out',
  blockedAria: '{label}, cannot be selected: {name}',
  selectAria: 'Select: {name}',
  blockedTitle: '{label}, cannot be selected',
  listSeparator: ', ',
  otherShopHint:
    'Items from different shops cannot be combined. Finish checking out {shop} first, then come back to this shop.',
  singleShopHint:
    'Items from different shops cannot be combined; one order per shop. Items from the same shop can be submitted together.',
  loginRequired: 'Please sign in before ordering.',
  updateFailed: 'Failed to update your cart. Please try again later.'
};

export const cart = { zh, en };

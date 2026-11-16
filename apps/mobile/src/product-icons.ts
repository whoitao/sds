import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

export type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * 商品占位图标：首页与购物车共用同一套规则。
 * 有 imageUrl 时显示图片；无图时按商品名匹配，匹配不到用菜篮兜底。
 */
const PRODUCT_ICON: { pattern: RegExp; icon: MaterialIconName }[] = [
  { pattern: /肉|排|骨|里脊|腱|腩|羊|鸡|鸭|鹅/, icon: 'food-steak' },
  { pattern: /蛋/, icon: 'egg-outline' },
  { pattern: /奶/, icon: 'cup-water' },
  { pattern: /鱼|虾/, icon: 'fish' },
  { pattern: /菜|青|菠菜|土豆|萝卜|柿|瓜|菇|笋/, icon: 'leaf' },
  { pattern: /米|面|粮|小米|豆|粉/, icon: 'rice' },
  { pattern: /油|盐|酱|醋|椒/, icon: 'shaker-outline' }
];

export function productIcon(name: string): MaterialIconName {
  return PRODUCT_ICON.find((entry) => entry.pattern.test(name))?.icon ?? 'basket-outline';
}

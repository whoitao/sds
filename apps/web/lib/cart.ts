import 'server-only';
import { cache } from 'react';
import { apiRequest } from './api';
import type { CartPayload } from './cart-model';
import { getSessionToken } from './session';

// 类型与纯展示逻辑统一放在 cart-model，客户端组件从那里引用，避免把会话代码带进浏览器
export type {
  CartItem,
  CartGroup,
  CartPayload,
  CartItemAvailability
} from './cart-model';
export {
  cartBadgeCount,
  cartGroupOf,
  cartItemAvailability,
  isCartItemUnavailable
} from './cart-model';

/** 当前登录顾客的购物车；未登录或接口异常都返回 null，页面按空车降级 */
export const getCartPayload = cache(async (): Promise<CartPayload | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  const response = await apiRequest<CartPayload>('/api/mobile/cart', { token });
  return response.ok ? response.data : null;
});

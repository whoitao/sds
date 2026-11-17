import { cache } from 'react';
import { apiRequest } from './api';
import { getSessionToken } from './session';

/** 与 packages/api 的 GET /api/mobile/cart 返回结构一致 */
export type CartItem = {
  id: string;
  productId: string;
  skuId: string;
  specName: string | null;
  name: string;
  imageUrl: string | null;
  unit: string;
  unitPrice: string;
  quantity: number;
  quantityText: string;
  quantityMode: 'integer' | 'decimal_2';
  stockQuantity: number;
  soldOut: boolean;
  subtotal: string;
};

export type CartGroup = {
  id: string;
  shopId: string;
  shopName: string;
  remark: string;
  updatedAt: string;
  itemCount: number;
  totalAmount: string;
  items: CartItem[];
};

export type CartPayload = {
  carts: CartGroup[];
  itemCount: number;
  totalAmount: string;
};

/** 当前登录顾客的购物车；未登录或接口异常都返回 null，页面按空车降级 */
export const getCartPayload = cache(async (): Promise<CartPayload | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  const response = await apiRequest<CartPayload>('/api/mobile/cart', { token });
  return response.ok ? response.data : null;
});

export function cartGroupOf(payload: CartPayload | null, shopId: string): CartGroup | null {
  if (!payload) return null;
  return payload.carts.find((group) => group.shopId === shopId) ?? null;
}

/** 顶栏角标：数量可能是小数（按斤称重），统一向上取整成整数件 */
export function cartBadgeCount(payload: CartPayload | null): number {
  const count = payload?.itemCount ?? 0;
  return count > 0 ? Math.max(1, Math.ceil(count - 0.0001)) : 0;
}

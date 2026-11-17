'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { CartPayload } from './cart';
import { getSessionToken } from './session';

export type CartActionResult = { ok: true; cart: CartPayload } | { ok: false; error: string };

async function mutate(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<CartActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: '请先登录再选菜' };

  const response = await apiRequest<CartPayload>(path, { method, token, body });
  if (!response.ok || !response.data) {
    return { ok: false, error: response.message ?? '购物车更新失败，请稍后再试' };
  }

  // 顶栏购物车角标也在 Server Component 里读同一份数据，需要刷新整棵布局
  revalidatePath('/', 'layout');
  return { ok: true, cart: response.data };
}

export async function addCartItem(skuId: string, quantity: string): Promise<CartActionResult> {
  return mutate('/api/mobile/cart/items', 'POST', { skuId, quantity });
}

export async function setCartItemQuantity(
  itemId: string,
  quantity: string
): Promise<CartActionResult> {
  return mutate(`/api/mobile/cart/items/${encodeURIComponent(itemId)}`, 'PATCH', { quantity });
}

export async function removeCartItem(itemId: string): Promise<CartActionResult> {
  return mutate(`/api/mobile/cart/items/${encodeURIComponent(itemId)}`, 'DELETE');
}

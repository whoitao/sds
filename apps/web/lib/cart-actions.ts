'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { CartPayload } from './cart';
import { getMessages } from './i18n/server';
import { getSessionToken } from './session';

export type CartActionResult = { ok: true; cart: CartPayload } | { ok: false; error: string };

async function mutate(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<CartActionResult> {
  const token = await getSessionToken();
  if (!token) {
    const m = await getMessages();
    return { ok: false, error: m.cart.loginRequired };
  }

  const response = await apiRequest<CartPayload>(path, { method, token, body });
  if (!response.ok || !response.data) {
    const m = await getMessages();
    return { ok: false, error: response.message ?? m.cart.updateFailed };
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

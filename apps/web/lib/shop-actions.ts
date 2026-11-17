'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SHOP_COOKIE } from '@/lib/shop';

/** 记住当前门店，顶栏药丸与后续页面都读这个 cookie */
export async function selectShop(shopId: string, shopName: string) {
  const store = await cookies();
  const value = encodeURIComponent(JSON.stringify({ id: shopId, name: shopName }));
  store.set(SHOP_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
    sameSite: 'lax'
  });
  revalidatePath('/', 'layout');
}

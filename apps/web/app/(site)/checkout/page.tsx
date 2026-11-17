import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Checkout from '@/components/Checkout';
import { apiRequest, type AddressItem } from '@/lib/api';
import { getCartPayload, type CartPayload } from '@/lib/cart';
import type { ShopHomePayload } from '@/lib/menu';
import { getRegionTree } from '@/lib/regions';
import { getSelectedShop } from '@/lib/shop';
import { getSessionToken, requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '确认订单 · 捎点啥'
};

const EMPTY_CART: CartPayload = { carts: [], itemCount: 0, totalAmount: '0.00' };

export default async function CheckoutPage() {
  // 未登录会带着 next=/checkout 去登录页
  const customer = await requireCustomer('/checkout');

  const [token, cart, regionTree, selected] = await Promise.all([
    getSessionToken(),
    getCartPayload(),
    getRegionTree(),
    getSelectedShop()
  ]);

  const groups = cart?.carts ?? [];
  const [addressResponse, shopEntries] = await Promise.all([
    token
      ? apiRequest<{ items: AddressItem[] }>('/api/addresses', { token })
      : Promise.resolve(null),
    // 自提要展示门店地址与电话，按购物车里的门店逐个取（通常只有 1 家）
    Promise.all(
      groups.map(async (group) => {
        const home = await apiRequest<ShopHomePayload>(
          `/api/mobile/shops/${encodeURIComponent(group.shopId)}/home`
        );
        const shop = home.ok ? home.data?.shop : null;
        return [
          group.shopId,
          shop ? { address: shop.address, phone: shop.phone ?? '' } : null
        ] as const;
      })
    )
  ]);

  if (addressResponse?.status === 401) redirect('/login?next=%2Fcheckout');

  const addresses = addressResponse?.ok ? addressResponse.data?.items ?? [] : [];
  const shops: Record<string, { address: string; phone: string }> = {};
  for (const [shopId, info] of shopEntries) {
    if (info) shops[shopId] = info;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3">
      {addressResponse && !addressResponse.ok ? (
        <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {addressResponse.message ?? '地址加载失败，请刷新重试'}
        </p>
      ) : null}
      <Checkout
        cart={cart ?? EMPTY_CART}
        addresses={addresses}
        regionTree={regionTree}
        shops={shops}
        customerName={customer.nickname ?? customer.phone ?? ''}
        customerPhone={customer.phone ?? ''}
        backShop={selected ? { id: selected.id, name: selected.name } : null}
      />
    </div>
  );
}

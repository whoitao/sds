import type { Metadata } from 'next';
import Link from 'next/link';
import ShopMenu from '@/components/ShopMenu';
import ProgressSteps from '@/components/ProgressSteps';
import { apiRequest } from '@/lib/api';
import { getCartPayload, type CartPayload } from '@/lib/cart';
import type { Messages } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/server';
import type { MenuProductPage, ShopHomePayload } from '@/lib/menu';
import { getCurrentCustomer } from '@/lib/session';
import { getSelectedShop } from '@/lib/shop';

export const metadata: Metadata = {
  title: '去买菜 · 捎点啥'
};

const EMPTY_CART: CartPayload = { carts: [], itemCount: 0, totalAmount: '0.00' };

function NotFound({ m }: { m: Messages }) {
  return (
    <section className="my-8 flex w-full min-w-0 flex-col items-start gap-3 rounded-[20px] bg-card px-6 py-10 shadow-perk">
      <h1 className="m-0 text-[26px] font-extrabold text-ink">{m.shops.notFoundTitle}</h1>
      <p className="m-0 text-[17px] leading-[1.6] text-ink-2">{m.shops.notFoundNote}</p>
      <Link
        href="/"
        className="mt-2 flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        {m.shops.backToShops}
      </Link>
    </section>
  );
}

export default async function ShopMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shopId = encodeURIComponent(id);
  const m = await getMessages();

  const [home, productPage, cart, customer, selected] = await Promise.all([
    apiRequest<ShopHomePayload>(`/api/mobile/shops/${shopId}/home`),
    apiRequest<MenuProductPage>(`/api/mobile/shops/${shopId}/products?pageSize=100`),
    getCartPayload(),
    getCurrentCustomer(),
    getSelectedShop()
  ]);

  // 门店 ID 不合法 / 不存在 / 未营业，接口分别返回 400 / 404，统一按「进不去」处理
  if (!home.ok || !home.data) {
    if (home.status === 400 || home.status === 404) return <NotFound m={m} />;
    return (
      <section className="my-8 flex w-full min-w-0 flex-col items-start gap-3 rounded-[20px] bg-card px-6 py-10 shadow-perk">
        <h1 className="m-0 text-[26px] font-extrabold text-ink">{m.shops.menuLoadFailedTitle}</h1>
        <p className="m-0 text-[17px] leading-[1.6] text-ink-2">
          {home.message ?? m.shops.menuLoadFailedNote}
        </p>
        <Link
          href="/"
          className="mt-2 flex h-12 items-center rounded-xl border-[1.5px] border-brand-200 px-6 text-[17px] font-bold text-brand-700 transition-colors hover:bg-brand-50"
        >
          {m.shops.backToShops}
        </Link>
      </section>
    );
  }

  const products = productPage.ok ? productPage.data?.items ?? [] : [];
  const total = productPage.data?.total ?? products.length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3 xl:min-h-0 xl:flex-1">
      <ProgressSteps
        current={2}
        steps={[m.common.stepShop, m.common.stepPick, m.common.stepCheckout, m.common.stepOrder]}
      />
      {!productPage.ok ? (
        <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {productPage.message ?? m.shops.productsLoadFailed}
        </p>
      ) : null}
      <ShopMenu
        shop={home.data.shop}
        categories={home.data.categories}
        products={products}
        total={total}
        initialCart={cart ?? EMPTY_CART}
        loggedIn={Boolean(customer)}
        selectedShopId={selected?.id ?? null}
      />
    </div>
  );
}

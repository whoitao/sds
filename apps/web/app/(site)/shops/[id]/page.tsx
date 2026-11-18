import type { Metadata } from 'next';
import Link from 'next/link';
import ShopMenu from '@/components/ShopMenu';
import ProgressSteps from '@/components/ProgressSteps';
import { apiRequest } from '@/lib/api';
import { getCartPayload, type CartPayload } from '@/lib/cart';
import type { MenuProductPage, ShopHomePayload } from '@/lib/menu';
import { getCurrentCustomer } from '@/lib/session';
import { getSelectedShop } from '@/lib/shop';

export const metadata: Metadata = {
  title: '去买菜 · 捎点啥'
};

const EMPTY_CART: CartPayload = { carts: [], itemCount: 0, totalAmount: '0.00' };

function NotFound() {
  return (
    <section className="my-8 flex w-full min-w-0 flex-col items-start gap-3 rounded-[20px] bg-card px-6 py-10 shadow-perk">
      <h1 className="m-0 text-[26px] font-extrabold text-ink">这家店现在进不去</h1>
      <p className="m-0 text-[17px] leading-[1.6] text-ink-2">
        门店不存在、还没开始接单，或者已经暂停营业。换一家近的看看吧。
      </p>
      <Link
        href="/"
        className="mt-2 flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        回附近的店
      </Link>
    </section>
  );
}

export default async function ShopMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shopId = encodeURIComponent(id);

  const [home, productPage, cart, customer, selected] = await Promise.all([
    apiRequest<ShopHomePayload>(`/api/mobile/shops/${shopId}/home`),
    apiRequest<MenuProductPage>(`/api/mobile/shops/${shopId}/products?pageSize=100`),
    getCartPayload(),
    getCurrentCustomer(),
    getSelectedShop()
  ]);

  // 门店 ID 不合法 / 不存在 / 未营业，接口分别返回 400 / 404，统一按「进不去」处理
  if (!home.ok || !home.data) {
    if (home.status === 400 || home.status === 404) return <NotFound />;
    return (
      <section className="my-8 flex w-full min-w-0 flex-col items-start gap-3 rounded-[20px] bg-card px-6 py-10 shadow-perk">
        <h1 className="m-0 text-[26px] font-extrabold text-ink">菜单加载失败</h1>
        <p className="m-0 text-[17px] leading-[1.6] text-ink-2">
          {home.message ?? '网络异常，请稍后刷新重试'}
        </p>
        <Link
          href="/"
          className="mt-2 flex h-12 items-center rounded-xl border-[1.5px] border-brand-200 px-6 text-[17px] font-bold text-brand-700 transition-colors hover:bg-brand-50"
        >
          回附近的店
        </Link>
      </section>
    );
  }

  const products = productPage.ok ? productPage.data?.items ?? [] : [];
  const total = productPage.data?.total ?? products.length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 pt-3 xl:min-h-0 xl:flex-1">
      <ProgressSteps current={2} />
      {!productPage.ok ? (
        <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {productPage.message ?? '菜品加载失败，请刷新重试'}
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

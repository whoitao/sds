'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Price } from '@sds/ui';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { addCartItem, removeCartItem, setCartItemQuantity, type CartActionResult } from '@/lib/cart-actions';
import type { CartGroup, CartPayload } from '@/lib/cart';
import { selectShop } from '@/lib/shop-actions';
import {
  defaultSkuOf,
  priceOf,
  quantityText,
  specTextOf,
  stepOf,
  type MenuCategory,
  type MenuProduct,
  type MenuShop
} from '@/lib/menu';

function Thumb({ name, imageUrl, size }: { name: string; imageUrl: string | null; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-[52px] w-[52px] text-[20px] sm:h-16 sm:w-16 sm:text-[22px]' : 'h-11 w-11 text-[18px]';
  return (
    <span
      className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-[14px] bg-gradient-to-br from-thumb-from to-thumb-to font-extrabold text-brand-700`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={160}
          height={160}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}

function Stepper({
  quantity,
  unit,
  disabled,
  onMinus,
  onPlus
}: {
  quantity: string;
  unit: string;
  disabled: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <span className="flex h-8 items-center rounded-full bg-brand-50 sm:h-9">
      <button
        type="button"
        aria-label={`减少一${unit}`}
        disabled={disabled}
        onClick={onMinus}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-brand-100 bg-card text-[17px] text-brand-700 disabled:opacity-50 sm:h-9 sm:w-9 sm:text-[18px]"
      >
        −
      </button>
      <b className="min-w-[2.75rem] shrink-0 whitespace-nowrap px-1 text-center text-[15px] tabular-nums text-ink sm:min-w-[3rem] sm:text-[16px]">
        {quantity}
      </b>
      <button
        type="button"
        aria-label={`增加一${unit}`}
        disabled={disabled}
        onClick={onPlus}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[17px] text-white disabled:opacity-50 sm:h-9 sm:w-9 sm:text-[18px]"
      >
        +
      </button>
    </span>
  );
}

export default function ShopMenu({
  shop,
  categories,
  products,
  total,
  initialCart,
  loggedIn,
  selectedShopId
}: {
  shop: MenuShop;
  categories: MenuCategory[];
  products: MenuProduct[];
  total: number;
  initialCart: CartPayload;
  loggedIn: boolean;
  selectedShopId: string | null;
}) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeChild, setActiveChild] = useState<string | null>(null);
  const [cart, setCart] = useState<CartPayload>(initialCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  const group: CartGroup | null = cart.carts.find((row) => row.shopId === shop.id) ?? null;
  const otherGroups = cart.carts.filter((row) => row.shopId !== shop.id && row.items.length > 0);
  const cartItems = group?.items ?? [];
  // 售罄商品留在购物车里展示，但不参与合计，也不能结算
  const availableItems = cartItems.filter((item) => !item.soldOut);
  const payableTotal =
    availableItems.reduce((sum, item) => sum + Math.round(Number(item.subtotal) * 100), 0) / 100;
  const allSoldOut = cartItems.length > 0 && availableItems.length === 0;
  const itemsBySku = useMemo(
    () => new Map((group?.items ?? []).map((item) => [item.skuId, item])),
    [group]
  );

  const activeCategoryRow = categories.find((row) => row.id === activeCategory) ?? null;
  const children = activeCategoryRow?.children ?? [];

  const scope = useMemo(() => {
    if (activeChild) return new Set([activeChild]);
    if (activeCategory === 'all') return null;
    const category = categories.find((row) => row.id === activeCategory);
    return new Set([activeCategory, ...(category?.children ?? []).map((row) => row.id)]);
  }, [activeCategory, activeChild, categories]);

  function isProductSoldOut(product: MenuProduct) {
    const sku = defaultSkuOf(product);
    return product.soldOut || !sku || Boolean(itemsBySku.get(sku.skuId)?.soldOut);
  }

  // 保持各组内的原始顺序，只把可购买商品排在售罄商品前面
  const visible = products
    .filter((product) => !scope || (product.categoryId && scope.has(product.categoryId)))
    .sort((a, b) => Number(isProductSoldOut(a)) - Number(isProductSoldOut(b)));

  const busy = pendingKey !== null;
  const loginHref = `/login?next=${encodeURIComponent(`/shops/${shop.id}`)}`;

  // 直接打开某个店的菜单时，把顶栏门店药丸同步成这家店
  useEffect(() => {
    if (selectedShopId === shop.id) return;
    void selectShop(shop.id, shop.name).then(() => router.refresh());
  }, [selectedShopId, shop.id, shop.name, router]);

  function requireLogin() {
    router.push(loginHref);
  }

  function run(key: string, task: () => Promise<CartActionResult>) {
    if (busy) return;
    setPendingKey(key);
    setError('');
    startTransition(async () => {
      const result = await task();
      if (result.ok) {
        setCart(result.cart);
        // 顶栏购物车角标同为服务端数据，刷新一次让它同步
        router.refresh();
      } else {
        setError(result.error);
      }
      setPendingKey(null);
    });
  }

  function addToCart(skuId: string) {
    if (!loggedIn) return requireLogin();
    const sku = products.flatMap((product) => product.skus).find((row) => row.skuId === skuId);
    const step = stepOf(sku?.quantityMode ?? 'integer');
    run(skuId, () => addCartItem(skuId, step.toFixed(2)));
  }

  function changeItem(itemId: string, nextQuantity: number, mode: 'integer' | 'decimal_2') {
    if (!loggedIn) return requireLogin();
    if (nextQuantity <= 0) {
      run(itemId, () => removeCartItem(itemId));
      return;
    }
    run(itemId, () => setCartItemQuantity(itemId, nextQuantity.toFixed(2)));
  }

  function categoryButton(
    category: { id: string; name: string; iconUrl?: string | null; productCount: number },
    active: boolean,
    mobile: boolean
  ) {
    const classes = mobile
      ? `relative flex h-[54px] shrink-0 items-center gap-2 rounded-xl px-3 text-[16px] transition-colors ${
          active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink'
        }`
      : `relative flex h-[62px] w-full shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-[17px] transition-colors ${
          active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink hover:bg-card-soft'
        }`;
    return (
      <button
        key={category.id}
        type="button"
        onClick={() => {
          setActiveCategory(category.id);
          setActiveChild(null);
        }}
        className={classes}
      >
        {active ? (
          <span
            aria-hidden
            className={`absolute top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-brand-500 ${
              mobile ? '-left-1' : '-left-3.5 rounded-r-full'
            }`}
          />
        ) : null}
        <i
          className={`grid shrink-0 place-items-center overflow-hidden rounded-[13px] font-extrabold not-italic ${
            mobile ? 'h-10 w-10 text-[17px]' : 'h-[42px] w-[42px] text-[18px]'
          } ${active ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'}`}
        >
          {category.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={category.iconUrl}
              alt=""
              width={42}
              height={42}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-contain"
            />
          ) : (
            category.name.slice(0, 1)
          )}
        </i>
        <span className="whitespace-nowrap">{category.name}</span>
        {category.productCount > 0 ? (
          <em
            className={`text-[13px] font-normal not-italic text-ink-3 ${
              mobile ? 'ml-1' : 'ml-auto'
            }`}
          >
            {category.productCount}
          </em>
        ) : null}
      </button>
    );
  }

  const allCategory = { id: 'all', name: '全部', productCount: total };

  return (
    <div className="flex w-full min-w-0 flex-col rounded-[20px] bg-card shadow-perk xl:flex-1 xl:min-h-[406px] xl:flex-row xl:overflow-hidden">
      <LoadingOverlay show={busy} text="正在更新购物车…" />
      <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5 [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden">
        {categoryButton(allCategory, activeCategory === 'all', true)}
        {categories.map((category) => categoryButton(category, activeCategory === category.id, true))}
      </nav>

      <nav className="hidden w-[176px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3.5 xl:flex">
        {categoryButton(allCategory, activeCategory === 'all', false)}
        {categories.map((category) => categoryButton(category, activeCategory === category.id, false))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line px-4 py-3 sm:px-5 xl:mt-3.5 xl:h-[62px] xl:py-0">
          <h1 className="m-0 text-[19px] font-extrabold text-ink sm:text-[20px]">{shop.name}</h1>
          <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-brand-50 px-2 text-[13px] font-bold text-brand-700">
            营业中
          </span>
          <span className="text-[14px] text-ink-2">{total} 样菜</span>
          <span className="ml-auto hidden text-[14px] text-ink-3 sm:block">{shop.address}</span>
        </div>

        {children.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-4 py-2 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
            {[{ id: null, name: '全部', productCount: activeCategoryRow?.productCount ?? 0 }, ...children].map(
              (child) => {
                const active = activeChild === child.id;
                return (
                  <button
                    key={child.id ?? 'all'}
                    type="button"
                    onClick={() => setActiveChild(child.id)}
                    className={`flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[14px] transition-colors ${
                      active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink-2 hover:bg-card-soft'
                    }`}
                  >
                    {child.name}
                    <em className="text-[12px] font-normal not-italic text-ink-3">{child.productCount}</em>
                  </button>
                );
              }
            )}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="m-0 px-5 py-12 text-center text-[16px] text-ink-2">这个分类暂时没有可卖的菜</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {visible.map((product) => {
                const sku = defaultSkuOf(product);
                const item = sku ? itemsBySku.get(sku.skuId) : undefined;
                // 商品列表数据可能滞后，购物车里的售罄标记更及时，两边都按售罄处理
                const soldOut = isProductSoldOut(product);
                const mode = sku?.quantityMode ?? 'integer';
                const step = stepOf(mode);
                const stock = Number(sku?.stockQuantity ?? 0);
                const reachedStock = Boolean(item) && sku?.stockType === 'tracked' && item!.quantity + step > stock;
                return (
                  <li
                    key={product.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0 sm:gap-4 sm:px-5"
                  >
                    <Thumb name={product.name} imageUrl={product.imageUrl} size="lg" />
                    <div className="min-w-0 flex-1">
                      <h2
                        className={`m-0 truncate text-[17px] font-bold sm:text-[18px] ${
                          soldOut ? 'text-ink-3' : 'text-ink'
                        }`}
                      >
                        {product.name}
                      </h2>
                      <p className="m-0 mt-0.5 flex items-baseline gap-1.5 truncate text-[13px] text-ink-3">
                        <span className="truncate">{soldOut ? '今天卖完了' : specTextOf(product)}</span>
                        {soldOut ? null : (
                          <span className="shrink-0 font-bold text-ink sm:hidden">
                            <Price
                              value={priceOf(product)}
                              color="ink"
                              size={13}
                              weight={700}
                              symbolSize={11}
                            />
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <Price
                        value={priceOf(product)}
                        color="ink"
                        size={20}
                        weight={800}
                        symbolSize={13}
                        symbolWeight={700}
                      />
                      <span className="block text-[12px] text-ink-3">/{sku?.unit || product.unit}</span>
                    </div>
                    <div className="flex w-[108px] shrink-0 items-center justify-end sm:w-[120px]">
                      {soldOut ? (
                        <span className="inline-flex h-9 items-center rounded-md bg-segment px-2.5 text-[13px] font-bold text-ink-3">
                          卖完了
                        </span>
                      ) : item ? (
                        <Stepper
                          quantity={quantityText(item.quantity, mode)}
                          unit={sku?.unit ?? '份'}
                          disabled={busy}
                          onMinus={() => changeItem(item.id, item.quantity - step, mode)}
                          onPlus={() =>
                            reachedStock
                              ? setError(`「${product.name}」只剩 ${stock}${sku?.unit ?? ''}`)
                              : changeItem(item.id, item.quantity + step, mode)
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => sku && addToCart(sku.skuId)}
                          aria-label={`把${product.name}加入购物车`}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500 text-[20px] leading-none text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                        >
                          +
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <aside className="sticky bottom-0 z-20 shrink-0 border-t border-line bg-card shadow-[0_-6px_18px_rgba(30,42,34,0.08)] xl:static xl:flex xl:w-[300px] xl:flex-col xl:border-l xl:border-t-0 xl:shadow-none">
        <div
          className={`${cartOpen ? 'flex' : 'hidden'} max-h-[68dvh] min-h-0 flex-col gap-2.5 overflow-hidden border-b border-line p-4 xl:max-h-none xl:flex xl:flex-1 xl:border-b-0 xl:p-3.5`}
        >
          <h2 className="m-0 flex shrink-0 items-baseline justify-between text-[19px] font-extrabold text-ink xl:h-[62px] xl:items-center">
            {shop.name}的菜
            <small className="text-[14px] font-normal text-ink-3">{group?.items.length ?? 0} 样</small>
          </h2>

          {!loggedIn ? (
            <p className="m-0 rounded-xl bg-info-soft px-3 py-2 text-[14px] text-ink-2">
              登录后才能把菜放进购物车。
              <Link href={loginHref} className="ml-1 font-bold text-brand-700 underline">
                去登录
              </Link>
            </p>
          ) : null}

          <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0">
            {(group?.items ?? []).map((item) => (
              <li
                key={item.id}
                className={`flex flex-col gap-1 border-b border-dashed border-line pb-2 ${
                  item.soldOut ? 'text-ink-3' : ''
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`shrink-0 ${item.soldOut ? 'opacity-60' : ''}`}>
                    <Thumb name={item.name} imageUrl={item.imageUrl} size="sm" />
                  </span>
                  <p
                    className={`m-0 min-w-0 flex-1 truncate text-[15px] font-semibold ${
                      item.soldOut ? 'text-ink-3' : 'text-ink'
                    }`}
                  >
                    {item.name}
                  </p>
                  {item.soldOut ? (
                    <span className="shrink-0 whitespace-nowrap rounded bg-segment px-1.5 py-0.5 text-[11px] font-bold text-ink-3">
                      已售罄
                    </span>
                  ) : null}
                  <Price
                    className="shrink-0"
                    value={item.subtotal}
                    color={item.soldOut ? 'ink-3' : 'ink'}
                    size={15}
                    weight={700}
                    symbolSize="1em"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 pl-[54px]">
                  <span className="text-[12px] text-ink-3">
                    <Price
                      value={item.unitPrice}
                      color="ink-3"
                      size={12}
                      weight={400}
                      symbolSize="1em"
                    />{' '}
                    / {item.unit}
                  </span>
                  <Stepper
                    quantity={quantityText(item.quantity, item.quantityMode)}
                    unit={item.unit}
                    disabled={busy || item.soldOut}
                    onMinus={() =>
                      changeItem(item.id, item.quantity - stepOf(item.quantityMode), item.quantityMode)
                    }
                    onPlus={() => {
                      const step = stepOf(item.quantityMode);
                      if (item.soldOut || item.quantity + step > item.stockQuantity) {
                        setError(`「${item.name}」只剩 ${item.stockQuantity}${item.unit}`);
                        return;
                      }
                      changeItem(item.id, item.quantity + step, item.quantityMode);
                    }}
                  />
                </div>
              </li>
            ))}
            {!group || group.items.length === 0 ? (
              <li className="py-6 text-center text-[15px] text-ink-3">还没选菜，点右侧的 + 加进来</li>
            ) : null}
          </ul>

          {error ? (
            <p className="m-0 shrink-0 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>
          ) : null}

          {otherGroups.length > 0 ? (
            <p className="m-0 shrink-0 rounded-xl border border-line bg-card-soft px-3 py-2 text-[13px] leading-[1.55] text-ink-2">
              购物车里还有
              {otherGroups.map((row) => `${row.shopName} 的 ${row.items.length} 样菜`).join('、')}
              ，结算时分开下单。
            </p>
          ) : null}

          {allSoldOut ? (
            <p className="m-0 shrink-0 rounded-xl bg-segment px-3 py-2 text-[13px] text-ink-2">
              购物车里的菜都卖完了，暂时没法结算。
            </p>
          ) : null}

          <div className="mt-auto flex shrink-0 items-baseline justify-between">
            <span className="text-[15px] text-ink-2">这家店合计</span>
            <Price as="b" value={payableTotal} color="ink" size={26} weight={800} symbolSize="1em" />
          </div>
          {availableItems.length > 0 ? (
            <Link
              href="/checkout"
              className="flex h-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-[19px] font-bold text-white transition-colors hover:bg-primary-hover"
            >
              去结算
            </Link>
          ) : (
            <div
              aria-disabled="true"
              className="flex h-[52px] shrink-0 items-center justify-center rounded-full bg-segment text-[19px] font-bold text-ink-3"
            >
              去结算
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCartOpen((value) => !value)}
          aria-expanded={cartOpen}
          className="flex w-full items-center gap-2 px-4 py-3 text-left xl:hidden"
        >
          <span className="text-[17px] font-extrabold text-ink">购物车</span>
          <span className="text-[14px] text-ink-2">
            {group?.items.length ?? 0} 样 ·{' '}
            <Price value={payableTotal} color="ink-2" size={14} weight={400} symbolSize="1em" />
          </span>
          <span className="ml-auto text-[13px] font-bold text-brand-700">{cartOpen ? '收起' : '展开'}</span>
        </button>
      </aside>
    </div>
  );
}

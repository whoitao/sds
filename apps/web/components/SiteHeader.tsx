import Link from 'next/link';
import UserMenu from '@/components/UserMenu';
import { cartBadgeCount, getCartPayload } from '@/lib/cart';
import { formatMessage } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/server';
import { getSelectedShop } from '@/lib/shop';
import { getCurrentCustomer } from '@/lib/session';

/** 顶栏展示用：有姓名用姓名，否则用打码手机号 */
function displayName(nickname: string | null, phone: string | null, fallback: string) {
  if (nickname && nickname.trim()) return nickname.trim();
  if (phone && /^\d{11}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  return phone ?? fallback;
}

function Icon({ name, className = 'h-[22px] w-[22px]' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (name) {
    case 'shop':
      return (
        <svg {...common}>
          <path d="M4 9l1.5-5h13L20 9" />
          <path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z" />
          <path d="M5 13v7h14v-7" />
        </svg>
      );
    case 'down':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case 'cart':
      return (
        <svg {...common}>
          <circle cx="9" cy="20" r="1" />
          <circle cx="19" cy="20" r="1" />
          <path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 2-1.6L22 7H6" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    default:
      return null;
  }
}

export default async function SiteHeader() {
  // 顶栏只渲染顾客身份、门店药丸与购物车角标；下拉里的计数在菜单展开时由客户端再取
  const [customer, shop, cart, m] = await Promise.all([
    getCurrentCustomer(),
    getSelectedShop(),
    getCartPayload(),
    getMessages()
  ]);
  const nav = m.nav;

  // 药丸展示完整门店名，过长时由 truncate 省略，完整名仍在 title 里
  const shopName = shop?.name ?? null;
  const cartCount = cartBadgeCount(cart);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-6 py-[15px] sm:gap-4 xl:gap-[18px]">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[26px] font-extrabold tracking-[1px] text-brand-700">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-500 text-[22px] font-bold text-white">
            捎
          </span>
          <span className="hidden sm:inline">捎点啥</span>
        </Link>

        <Link
          href="/"
          title={
            shop
              ? formatMessage(nav.currentShopTitle, { name: shop.name })
              : nav.pickShopTitle
          }
          className={`flex h-10 min-w-0 max-w-[310px] shrink items-center gap-1.5 rounded-full border-[1.5px] pl-1.5 pr-2.5 text-[14px] font-bold whitespace-nowrap transition-colors sm:h-[52px] sm:gap-2 sm:pl-2 sm:pr-3.5 sm:text-[16px] lg:text-[18px] lg:pr-[18px] ${
            shop
              ? 'border-brand-100 bg-brand-50 text-brand-700 hover:border-brand-300'
              : 'border-line bg-card-soft text-ink-2 hover:border-brand-300'
          }`}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card sm:h-7 sm:w-7 lg:h-9 lg:w-9">
            <Icon name="shop" className="h-4 w-4 sm:h-[18px] sm:w-[18px] lg:h-[22px] lg:w-[22px]" />
          </span>
          <span className="min-w-0 truncate">{shopName ?? nav.chooseShop}</span>
          <Icon name="down" className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px] lg:h-[20px] lg:w-[20px]" />
        </Link>

        <div className="hidden h-[54px] min-w-0 items-center gap-3 rounded-full border-[1.5px] border-line bg-card-soft pl-[18px] pr-[18px] xl:flex xl:w-[124px]">
          <Icon name="search" className="h-[22px] w-[22px] shrink-0 text-ink-3" />
          <input
            aria-label={nav.searchAria}
            placeholder={nav.searchPlaceholder}
            className="h-full min-w-0 flex-1 bg-transparent text-[18px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Link
            href="/checkout"
            aria-label={
              cartCount > 0
                ? formatMessage(nav.cartCountAria, { count: cartCount })
                : nav.cartAria
            }
            className="flex h-[52px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-2 text-[18px] font-semibold text-ink transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <Icon name="cart" />
            <span className="hidden sm:inline">{nav.cart}</span>
            {cartCount > 0 ? (
              <b className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[12px] font-bold tabular-nums text-white">
                {cartCount > 99 ? '99+' : cartCount}
              </b>
            ) : null}
          </Link>
        </div>

        {customer ? (
          <div className="shrink-0">
            <UserMenu
              name={displayName(customer.nickname, customer.phone, nav.accountFallback)}
              phone={customer.phone}
            />
          </div>
        ) : (
          <Link
            href="/login"
            className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[16px] font-bold text-white transition-colors hover:bg-primary-hover sm:h-[54px] sm:px-[22px] sm:text-[19px]"
          >
            <Icon name="user" className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
            <span className="whitespace-nowrap">
              {nav.login}
              <span className="hidden sm:inline">{nav.registerSuffix}</span>
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}

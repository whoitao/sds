import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Price } from '@sds/ui';
import AccountLayout from '@/components/AccountLayout';
import { formatMessage } from '@/lib/i18n/config';
import { getLocale, getMessages } from '@/lib/i18n/server';
import {
  formatDateTime,
  getOrders,
  itemSummary,
  orderTabOf,
  statusLabelOf,
  statusTone,
  type OrderMessages,
  type OrderTab
} from '@/lib/orders';
import { requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '我的订单 · 捎点啥'
};

const TAB_KEYS: OrderTab[] = ['all', 'ongoing', 'done', 'closed'];

function EmptyState({ tab, m }: { tab: OrderTab; m: OrderMessages }) {
  const copy =
    tab === 'ongoing'
      ? m.emptyOngoing
      : tab === 'done'
        ? m.emptyDone
        : tab === 'closed'
          ? m.emptyClosed
          : m.emptyAll;
  return (
    <section className="flex flex-col items-center gap-3 rounded-[20px] border border-line bg-card px-6 py-14 text-center shadow-perk">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-[26px] font-extrabold text-brand-700">
        {m.emptyBadge}
      </span>
      <h2 className="m-0 text-[21px] font-extrabold text-ink">{m.emptyTitle}</h2>
      <p className="m-0 max-w-[380px] text-[16px] leading-[1.6] text-ink-2">{copy}</p>
      <Link
        href="/"
        className="mt-2 flex h-12 items-center rounded-full bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        {m.goNearby}
      </Link>
    </section>
  );
}

export default async function OrdersPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // 未登录会带着 next 参数跳到登录页
  await requireCustomer('/orders');

  const [{ tab: rawTab }, m] = await Promise.all([searchParams, getMessages()]);
  const locale = await getLocale();
  const t = m.orders;
  const tab: OrderTab = TAB_KEYS.some((key) => key === rawTab) ? (rawTab as OrderTab) : 'all';

  const result = await getOrders();
  // 会话在服务端被吊销：同样回登录页
  if (result.status === 401) redirect('/login?next=%2Forders');

  const orders = result.items;
  const counts: Record<OrderTab, number> = {
    all: orders.length,
    ongoing: orders.filter((order) => orderTabOf(order.status) === 'ongoing').length,
    done: orders.filter((order) => orderTabOf(order.status) === 'done').length,
    closed: orders.filter((order) => orderTabOf(order.status) === 'closed').length
  };
  const visible = tab === 'all' ? orders : orders.filter((order) => orderTabOf(order.status) === tab);
  const tabLabels: Record<OrderTab, string> = {
    all: t.tabAll,
    ongoing: t.tabOngoing,
    done: t.tabDone,
    closed: t.tabClosed
  };

  return (
    <AccountLayout>
      <div className="flex w-full min-w-0 flex-col gap-5 lg:h-full lg:min-h-0">
        {!result.ok ? (
          <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
            {result.message ?? t.loadFailed}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <nav
            aria-label={t.tabsAria}
            className="flex gap-1.5 overflow-x-auto rounded-[18px] border border-line bg-card p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-0 sm:flex-1"
          >
            {TAB_KEYS.map((key) => {
              const active = key === tab;
              return (
                <Link
                  key={key}
                  href={key === 'all' ? '/orders' : `/orders?tab=${key}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] transition-colors ${
                    active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink hover:bg-card-soft'
                  }`}
                >
                  {tabLabels[key]}
                  <span className={`text-[13px] font-normal ${active ? 'text-brand-700' : 'text-ink-3'}`}>
                    {counts[key]}
                  </span>
                </Link>
              );
            })}
          </nav>
          <Link
            href="/"
            className="flex h-10 shrink-0 items-center self-end rounded-full border-[1.5px] border-brand-200 px-4 text-[15px] font-bold text-brand-700 transition-colors hover:bg-brand-50 sm:self-auto"
          >
            {t.continueShopping}
          </Link>
        </div>

        {visible.length === 0 ? (
          <EmptyState tab={tab} m={t} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0 lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:px-1">
            {visible.map((order) => (
              <li key={order.id} className="min-w-0">
                <Link
                  href={`/orders/${order.id}`}
                  className="flex w-full min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-card p-4 shadow-perk transition-colors hover:border-brand-300 sm:p-5"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="shrink-0 whitespace-nowrap text-[15px] font-bold text-ink">
                      <span className="sr-only sm:hidden">{t.orderNo}</span>
                      <span className="mr-1 hidden text-[12px] font-normal text-ink-3 sm:inline">
                        {t.orderNo}
                      </span>
                      {order.orderNo}
                    </span>
                    <span
                      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-bold ${statusTone(order.status)}`}
                    >
                      {statusLabelOf(order.status, order.statusLabel, t)}
                    </span>
                    <span className="min-w-0 break-words text-[17px] font-bold text-ink">
                      {order.shopName}
                    </span>
                    <span className="ml-auto shrink-0 text-[13px] text-ink-3">
                      {formatDateTime(order.createdAt, locale)}
                    </span>
                  </div>

                  <p className="m-0 line-clamp-2 break-words text-[15px] leading-[1.5] text-ink-2">
                    {itemSummary(order, t)}
                  </p>

                  <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
                    <span className="text-[13px] text-ink-3">
                      {order.fulfillmentType === 'delivery' ? t.delivery : t.pickup} ·{' '}
                      {formatMessage(t.itemCount, { count: order.itemCount })}
                    </span>
                    <span className="text-[14px] text-ink-2">
                      {t.total}{' '}
                      <Price
                        as="b"
                        value={order.totalAmount}
                        color="ink"
                        size={18}
                        weight={800}
                        symbolSize="1em"
                      />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="m-0 text-[13px] leading-[1.6] text-ink-3">{t.listNote}</p>
      </div>
    </AccountLayout>
  );
}

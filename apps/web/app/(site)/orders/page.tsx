import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Price } from '@sds/ui';
import AccountLayout from '@/components/AccountLayout';
import { formatDateTime, getOrders, itemSummary, orderTabOf, statusTone, type OrderTab } from '@/lib/orders';
import { requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '我的订单 · 捎点啥'
};

const TABS: { key: OrderTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ongoing', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'closed', label: '已取消' }
];

function EmptyState({ tab }: { tab: OrderTab }) {
  const copy =
    tab === 'ongoing'
      ? '现在没有进行中的订单。'
      : tab === 'done'
        ? '还没有已完成的订单。'
        : tab === 'closed'
          ? '没有已取消或已退款的订单。'
          : '你还没有下过单，去附近的店挑点菜吧。';
  return (
    <section className="flex flex-col items-center gap-3 rounded-[20px] border border-line bg-card px-6 py-14 text-center shadow-perk">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-[26px] font-extrabold text-brand-700">
        单
      </span>
      <h2 className="m-0 text-[21px] font-extrabold text-ink">还没有订单</h2>
      <p className="m-0 max-w-[380px] text-[16px] leading-[1.6] text-ink-2">{copy}</p>
      <Link
        href="/"
        className="mt-2 flex h-12 items-center rounded-full bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        去附近的店
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

  const { tab: rawTab } = await searchParams;
  const tab: OrderTab = TABS.some((item) => item.key === rawTab) ? (rawTab as OrderTab) : 'all';

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

  return (
    <AccountLayout>
      <div className="flex w-full min-w-0 flex-col gap-5 lg:h-full lg:min-h-0">
        {!result.ok ? (
          <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
            {result.message ?? '订单加载失败，请稍后刷新重试'}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <nav
            aria-label="订单状态筛选"
            className="flex gap-1.5 overflow-x-auto rounded-[18px] border border-line bg-card p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-0 sm:flex-1"
          >
            {TABS.map((item) => {
              const active = item.key === tab;
              return (
                <Link
                  key={item.key}
                  href={item.key === 'all' ? '/orders' : `/orders?tab=${item.key}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] transition-colors ${
                    active ? 'bg-brand-50 font-bold text-brand-700' : 'text-ink hover:bg-card-soft'
                  }`}
                >
                  {item.label}
                  <span className={`text-[13px] font-normal ${active ? 'text-brand-700' : 'text-ink-3'}`}>
                    {counts[item.key]}
                  </span>
                </Link>
              );
            })}
          </nav>
          <Link
            href="/"
            className="flex h-10 shrink-0 items-center self-end rounded-full border-[1.5px] border-brand-200 px-4 text-[15px] font-bold text-brand-700 transition-colors hover:bg-brand-50 sm:self-auto"
          >
            继续买菜
          </Link>
        </div>

        {visible.length === 0 ? (
          <EmptyState tab={tab} />
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
                      <span className="sr-only sm:hidden">订单号</span>
                      <span className="mr-1 hidden text-[12px] font-normal text-ink-3 sm:inline">
                        订单号
                      </span>
                      {order.orderNo}
                    </span>
                    <span
                      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-bold ${statusTone(order.status)}`}
                    >
                      {order.statusLabel}
                    </span>
                    <span className="min-w-0 break-words text-[17px] font-bold text-ink">
                      {order.shopName}
                    </span>
                    <span className="ml-auto shrink-0 text-[13px] text-ink-3">
                      {formatDateTime(order.createdAt)}
                    </span>
                  </div>

                  <p className="m-0 line-clamp-2 break-words text-[15px] leading-[1.5] text-ink-2">
                    {itemSummary(order)}
                  </p>

                  <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
                    <span className="text-[13px] text-ink-3">
                      {order.fulfillmentType === 'delivery' ? '送货到家' : '到店自提'} · 共{' '}
                      {order.itemCount} 件
                    </span>
                    <span className="text-[14px] text-ink-2">
                      合计{' '}
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

        <p className="m-0 text-[13px] leading-[1.6] text-ink-3">
          订单列表展示最近 50 笔订单；更早的订单如需查询，请联系门店。
        </p>
      </div>
    </AccountLayout>
  );
}

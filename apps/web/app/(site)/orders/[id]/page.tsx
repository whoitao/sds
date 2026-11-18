import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Price } from '@sds/ui';
import AccountLayout from '@/components/AccountLayout';
import { apiRequest } from '@/lib/api';
import {
  formatDateTime,
  formatQuantity,
  getOrders,
  statusTone,
  type CustomerOrder
} from '@/lib/orders';
import { requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '订单详情 · 捎点啥'
};

function paymentNote(order: CustomerOrder) {
  if (order.paidAt) return `已支付 · ${formatDateTime(order.paidAt)}`;
  if (order.paymentMethod === 'cash') return '货到付款，收货或取货时付给门店';
  if (order.status === 'pending_payment') return '待支付';
  return '未支付';
}

function Thumb({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-gradient-to-br from-thumb-from to-thumb-to text-[18px] font-extrabold text-brand-700 sm:h-12 sm:w-12">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={96}
          height={96}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[15px] leading-[1.6]">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

function NotFound() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-card px-6 py-12 shadow-perk">
      <h1 className="m-0 text-[24px] font-extrabold text-ink">没有找到这笔订单</h1>
      <p className="m-0 text-[16px] leading-[1.6] text-ink-2">
        订单可能已被删除，或者超出了最近 50 笔订单的查询范围。
      </p>
      <Link
        href="/orders"
        className="mt-2 flex h-12 items-center rounded-full bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        回我的订单
      </Link>
    </section>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = `/orders/${id}`;
  await requireCustomer(path);

  const result = await getOrders();
  if (result.status === 401) redirect(`/login?next=${encodeURIComponent(path)}`);

  const order = result.items.find((item) => item.id === id) ?? null;

  const home =
    order && order.fulfillmentType === 'pickup'
      ? await apiRequest<{ shop: { address: string; phone: string | null } }>(
          `/api/mobile/shops/${order.shopId}/home`
        )
      : null;
  const shopAddress = home?.ok ? home.data?.shop.address ?? null : null;

  return (
    <AccountLayout>
      <div className="flex w-full min-w-0 flex-col gap-4">
        {!order ? (
          <NotFound />
        ) : (
          <>
            <section className="flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span
                  className={`inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 text-[14px] font-bold ${statusTone(order.status)}`}
                >
                  {order.statusLabel}
                </span>
                <span className="order-3 w-full min-w-0 break-words text-[20px] font-extrabold text-ink sm:order-none sm:w-auto">
                  {order.shopName}
                </span>
                <span className="order-2 ml-auto shrink-0 whitespace-nowrap text-[13px] leading-[28px] text-ink-3 sm:order-none">
                  下单时间 {formatDateTime(order.createdAt)}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-[14px] text-ink-2">
                <span className="break-all">订单号 {order.orderNo}</span>
                {order.completedAt ? <span>完成时间 {formatDateTime(order.completedAt)}</span> : null}
              </div>
            </section>

            <section className="flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">商品明细</h2>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {order.items.map((item) => (
                  <li key={item.id} className="flex min-w-0 items-start gap-3">
                    <Thumb name={item.name} imageUrl={item.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 break-words text-[15px] font-bold leading-[1.4] text-ink">
                        {item.name}
                      </p>
                      <p className="m-0 mt-1 text-[13px] leading-[1.4] text-ink-3">
                        {item.specName ? `${item.specName} · ` : ''}
                        <Price
                          value={item.unitPrice}
                          color="ink-3"
                          size={13}
                          weight={400}
                          symbolSize="1em"
                        />
                        /{item.unit}
                      </p>
                      <p className="m-0 mt-1 text-[14px] text-ink-2">
                        × {formatQuantity(item)}
                      </p>
                    </div>
                    <Price
                      className="shrink-0"
                      value={item.subtotal}
                      color="ink"
                      size={15}
                      weight={700}
                      symbolSize="1em"
                    />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-line pt-3">
                <span className="text-[14px] text-ink-3">共 {order.itemCount} 件</span>
                <span className="text-[15px] text-ink-2">
                  合计{' '}
                  <Price
                    as="b"
                    value={order.totalAmount}
                    color="ink"
                    size={22}
                    weight={800}
                    symbolSize="1em"
                  />
                </span>
              </div>
            </section>

            <section className="flex w-full min-w-0 flex-col gap-2.5 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">
                {order.fulfillmentType === 'delivery' ? '送货到家' : '到店自提'}
              </h2>
              <Field label="联系人">
                {order.contactName ?? '未留联系人'}
                {order.contactPhone ? ` · ${order.contactPhone}` : ''}
              </Field>
              {order.fulfillmentType === 'delivery' ? (
                <Field label="收货地址">{order.addressText ?? '未记录地址'}</Field>
              ) : (
                <>
                  <Field label="自提门店">{order.shopName}</Field>
                  <Field label="门店地址">{shopAddress ?? '门店地址请咨询门店'}</Field>
                </>
              )}
            </section>

            <section className="flex w-full min-w-0 flex-col gap-2.5 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">支付信息</h2>
              <Field label="支付方式">{order.paymentMethodLabel ?? '未记录'}</Field>
              <Field label="支付状态">{paymentNote(order)}</Field>
              {order.paymentMethod === 'wechat' && !order.paidAt ? (
                <p className="m-0 mt-1 rounded-xl bg-amber-soft px-3 py-2 text-[13px] leading-[1.5] text-amber-ink">
                  线上支付暂未开通，本单没有扣款；请保留订单号并联系门店完成支付。
                </p>
              ) : null}
              {order.refundAmount ? (
                <div className="mt-1 flex flex-col gap-1 rounded-xl bg-card-soft px-3 py-2 text-[13px] leading-[1.5] text-ink-2">
                  <span>
                    退款金额{' '}
                    <Price
                      value={order.refundAmount}
                      color="ink-2"
                      weight={400}
                      symbolSize="1em"
                    />
                    {order.refundedAt ? ` · ${formatDateTime(order.refundedAt)}` : ''}
                  </span>
                  {order.refundReason ? <span>退款原因：{order.refundReason}</span> : null}
                  {order.refundRejectedReason ? (
                    <span>退款被拒原因：{order.refundRejectedReason}</span>
                  ) : null}
                </div>
              ) : null}
              {order.status === 'cancelled' && order.cancelledReason ? (
                <p className="m-0 mt-1 text-[13px] text-ink-3">取消原因：{order.cancelledReason}</p>
              ) : null}
            </section>

            {order.remark ? (
              <section className="flex w-full min-w-0 flex-col gap-2 rounded-[20px] border border-line bg-card p-5 shadow-perk">
                <h2 className="m-0 text-[18px] font-extrabold text-ink">备注</h2>
                <p className="m-0 break-words text-[15px] leading-[1.6] text-ink-2">{order.remark}</p>
              </section>
            ) : null}

            <p className="m-0 text-[13px] leading-[1.6] text-ink-3">
              订单信息以门店确认为准，有疑问请直接联系门店或客服。
            </p>
          </>
        )}
      </div>
    </AccountLayout>
  );
}

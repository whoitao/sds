import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Price } from '@sds/ui';
import AccountLayout from '@/components/AccountLayout';
import { apiRequest } from '@/lib/api';
import { formatMessage, type Locale } from '@/lib/i18n/config';
import { getLocale, getMessages } from '@/lib/i18n/server';
import {
  formatDateTime,
  formatQuantity,
  getOrders,
  paymentLabelOf,
  statusLabelOf,
  statusTone,
  type CustomerOrder,
  type OrderMessages
} from '@/lib/orders';
import { requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '订单详情 · 捎点啥'
};

function paymentNote(order: CustomerOrder, m: OrderMessages, locale: Locale) {
  if (order.paidAt) {
    return formatMessage(m.paidAt, { time: formatDateTime(order.paidAt, locale) });
  }
  if (order.paymentMethod === 'cash') return m.cashNote;
  if (order.status === 'pending_payment') return m.pendingPayment;
  return m.unpaid;
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

function NotFound({ m }: { m: OrderMessages }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-card px-6 py-12 shadow-perk">
      <h1 className="m-0 text-[24px] font-extrabold text-ink">{m.detailNotFoundTitle}</h1>
      <p className="m-0 text-[16px] leading-[1.6] text-ink-2">{m.detailNotFoundNote}</p>
      <Link
        href="/orders"
        className="mt-2 flex h-12 items-center rounded-full bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
      >
        {m.backToOrders}
      </Link>
    </section>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = `/orders/${id}`;
  await requireCustomer(path);

  const m = (await getMessages()).orders;
  const locale = await getLocale();

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
          <NotFound m={m} />
        ) : (
          <>
            <section className="flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span
                  className={`inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 text-[14px] font-bold ${statusTone(order.status)}`}
                >
                  {statusLabelOf(order.status, order.statusLabel, m)}
                </span>
                <span className="order-3 w-full min-w-0 break-words text-[20px] font-extrabold text-ink sm:order-none sm:w-auto">
                  {order.shopName}
                </span>
                <span className="order-2 ml-auto shrink-0 whitespace-nowrap text-[13px] leading-[28px] text-ink-3 sm:order-none">
                  {formatMessage(m.createdAt, { time: formatDateTime(order.createdAt, locale) })}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-[14px] text-ink-2">
                <span className="break-all">
                  {formatMessage(m.orderNoValue, { no: order.orderNo })}
                </span>
                {order.completedAt ? (
                  <span>
                    {formatMessage(m.completedAt, {
                      time: formatDateTime(order.completedAt, locale)
                    })}
                  </span>
                ) : null}
              </div>
            </section>

            <section className="flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">{m.itemsTitle}</h2>
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
                <span className="text-[14px] text-ink-3">
                  {formatMessage(m.itemCount, { count: order.itemCount })}
                </span>
                <span className="text-[15px] text-ink-2">
                  {m.total}{' '}
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
                {order.fulfillmentType === 'delivery' ? m.delivery : m.pickup}
              </h2>
              <Field label={m.contact}>
                {order.contactName ?? m.contactEmpty}
                {order.contactPhone ? ` · ${order.contactPhone}` : ''}
              </Field>
              {order.fulfillmentType === 'delivery' ? (
                <Field label={m.address}>{order.addressText ?? m.addressEmpty}</Field>
              ) : (
                <>
                  <Field label={m.pickupShop}>{order.shopName}</Field>
                  <Field label={m.shopAddress}>{shopAddress ?? m.shopAddressEmpty}</Field>
                </>
              )}
            </section>

            <section className="flex w-full min-w-0 flex-col gap-2.5 rounded-[20px] border border-line bg-card p-5 shadow-perk">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">{m.paymentTitle}</h2>
              <Field label={m.paymentMethod}>
                {paymentLabelOf(order.paymentMethod, order.paymentMethodLabel, m) ??
                  m.paymentEmpty}
              </Field>
              <Field label={m.paymentStatus}>{paymentNote(order, m, locale)}</Field>
              {order.paymentMethod === 'wechat' && !order.paidAt ? (
                <p className="m-0 mt-1 rounded-xl bg-amber-soft px-3 py-2 text-[13px] leading-[1.5] text-amber-ink">
                  {m.wechatNotice}
                </p>
              ) : null}
              {order.refundAmount ? (
                <div className="mt-1 flex flex-col gap-1 rounded-xl bg-card-soft px-3 py-2 text-[13px] leading-[1.5] text-ink-2">
                  <span>
                    {m.refundAmount}{' '}
                    <Price
                      value={order.refundAmount}
                      color="ink-2"
                      weight={400}
                      symbolSize="1em"
                    />
                    {order.refundedAt
                      ? ` · ${formatDateTime(order.refundedAt, locale)}`
                      : ''}
                  </span>
                  {order.refundReason ? (
                    <span>{formatMessage(m.refundReason, { reason: order.refundReason })}</span>
                  ) : null}
                  {order.refundRejectedReason ? (
                    <span>
                      {formatMessage(m.refundRejectedReason, {
                        reason: order.refundRejectedReason
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {order.status === 'cancelled' && order.cancelledReason ? (
                <p className="m-0 mt-1 text-[13px] text-ink-3">
                  {formatMessage(m.cancelReason, { reason: order.cancelledReason })}
                </p>
              ) : null}
            </section>

            {order.remark ? (
              <section className="flex w-full min-w-0 flex-col gap-2 rounded-[20px] border border-line bg-card p-5 shadow-perk">
                <h2 className="m-0 text-[18px] font-extrabold text-ink">{m.remarkTitle}</h2>
                <p className="m-0 break-words text-[15px] leading-[1.6] text-ink-2">
                  {order.remark}
                </p>
              </section>
            ) : null}

            <p className="m-0 text-[13px] leading-[1.6] text-ink-3">{m.footerNote}</p>
          </>
        )}
      </div>
    </AccountLayout>
  );
}

import 'server-only';
import { apiRequest } from './api';
import { dateLocaleOf, formatMessage, type Locale } from './i18n/config';
import type { Messages } from './i18n/messages';
import { getSessionToken } from './session';

/** GET /api/mobile/orders 的返回结构（顾客端最近 50 单，含商品明细） */

export type CustomerOrderItem = {
  id: string;
  productId: string;
  skuId: string;
  name: string;
  specName: string | null;
  imageUrl: string | null;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  unitPrice: string;
  quantity: number;
  subtotal: string;
};

export type CustomerOrder = {
  id: string;
  orderNo: string;
  shopId: string;
  shopName: string;
  status: string;
  statusLabel: string;
  fulfillmentType: 'delivery' | 'pickup';
  itemCount: number;
  totalAmount: string;
  remark: string | null;
  contactName: string | null;
  contactPhone: string | null;
  addressText: string | null;
  cancelledReason: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  refundAmount: string | null;
  refundReason: string | null;
  refundRejectedReason: string | null;
  createdAt: string;
  completedAt: string | null;
  canPay: boolean;
  canCancel: boolean;
  cancelNeedsRefund: boolean;
  items: CustomerOrderItem[];
};

export type OrderTab = 'all' | 'ongoing' | 'done' | 'closed';

/** orders 字典的类型，供状态/支付方式映射与列表摘要使用 */
export type OrderMessages = Messages['orders'];

/** 仍在推进中的状态（退款中算进行中，等门店处理） */
const ONGOING_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'refund_pending'
];

const CLOSED_STATUSES = ['cancelled', 'refunded'];

export function orderTabOf(status: string): Exclude<OrderTab, 'all'> {
  if (ONGOING_STATUSES.includes(status)) return 'ongoing';
  if (CLOSED_STATUSES.includes(status)) return 'closed';
  return 'done';
}

/** 状态标签的配色：待支付用琥珀、进行中用品牌绿、完成/关闭用中性色 */
export function statusTone(status: string) {
  if (status === 'pending_payment') return 'bg-amber-soft text-amber-ink';
  if (orderTabOf(status) === 'ongoing') return 'bg-brand-50 text-brand-700';
  if (status === 'completed') return 'bg-card-soft text-ink-2';
  return 'bg-segment text-ink-3';
}

const DATE_TIME_FORMATTERS: Partial<Record<Locale, Intl.DateTimeFormat>> = {};

function dateTimeFormatter(locale: Locale) {
  const cached = DATE_TIME_FORMATTERS[locale];
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(dateLocaleOf(locale), {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  DATE_TIME_FORMATTERS[locale] = formatter;
  return formatter;
}

export function formatDateTime(value: string | null | undefined, locale: Locale = 'zh') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const text = dateTimeFormatter(locale).format(date);
  return locale === 'zh' ? text.replace(/\//g, '-') : text;
}

export function formatQuantity(item: CustomerOrderItem) {
  if (item.quantityMode === 'integer') return String(Math.round(item.quantity));
  return String(Number(item.quantity));
}

/** 状态码 → 字典 key：API 的 statusLabel 是中文，优先用本地映射，未知状态回落到 API 文案 */
const STATUS_LABEL_KEYS: Record<string, keyof OrderMessages> = {
  pending_payment: 'statusPendingPayment',
  paid: 'statusPaid',
  preparing: 'statusPreparing',
  delivering: 'statusDelivering',
  pickup_ready: 'statusPickupReady',
  refund_pending: 'statusRefundPending',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
  refunded: 'statusRefunded'
};

export function statusLabelOf(
  status: string,
  fallback: string,
  messages: OrderMessages
): string {
  const key = STATUS_LABEL_KEYS[status];
  return key ? messages[key] : fallback || status;
}

/** 支付方式 code → 字典 key；未知 code 回落到 API 的 paymentMethodLabel */
const PAYMENT_LABEL_KEYS: Record<string, keyof OrderMessages> = {
  wechat: 'paymentWechat',
  cash: 'paymentCash',
  balance: 'paymentBalance'
};

export function paymentLabelOf(
  method: string | null,
  fallback: string | null,
  messages: OrderMessages
): string | null {
  const key = method ? PAYMENT_LABEL_KEYS[method] : undefined;
  return (key && messages[key]) || fallback;
}

/** 商品摘要：前两个名字，超出时按语言补「等 N 种」/「and N more」 */
export function itemSummary(order: CustomerOrder, messages: OrderMessages) {
  const names = order.items.map((item) => item.name);
  if (names.length === 0) return messages.summaryEmpty;
  if (names.length <= 2) return names.join(messages.listSeparator);
  return formatMessage(messages.summaryMore, {
    names: names.slice(0, 2).join(messages.listSeparator),
    count: names.length
  });
}

export async function getOrders() {
  const token = await getSessionToken();
  const response = await apiRequest<{ items: CustomerOrder[] }>('/api/mobile/orders', { token });
  return {
    status: response.status,
    ok: response.ok,
    message: response.message,
    items: response.ok ? response.data?.items ?? [] : []
  };
}

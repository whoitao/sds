import 'server-only';
import { apiRequest } from './api';
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

const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_TIME.format(date).replace(/\//g, '-');
}

export function formatQuantity(item: CustomerOrderItem) {
  if (item.quantityMode === 'integer') return String(Math.round(item.quantity));
  return String(Number(item.quantity));
}

/** 商品摘要：前两个名字，超出时补「等 N 种」 */
export function itemSummary(order: CustomerOrder) {
  const names = order.items.map((item) => item.name);
  if (names.length === 0) return '暂无商品明细';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 种`;
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

import type { OrderPayload, QuantityMode } from './api';
import { colors } from './theme';

/** 订单状态配色，列表与详情共用 */
export const orderStatusTone: Record<string, { background: string; color: string }> = {
  pending_payment: { background: colors.amberSoft, color: colors.amber },
  paid: { background: colors.blueSoft, color: colors.blueInk },
  preparing: { background: colors.amberSoft, color: colors.amber },
  delivering: { background: colors.blueSoft, color: colors.blueInk },
  pickup_ready: { background: colors.blueSoft, color: colors.blueInk },
  completed: { background: colors.greenSoft, color: colors.greenDeep },
  refund_pending: { background: colors.amberSoft, color: colors.amber },
  refunded: { background: colors.line, color: colors.ink2 },
  cancelled: { background: colors.line, color: colors.ink2 }
};

export function formatQuantity(value: number, mode: QuantityMode) {
  if (mode === 'integer') return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

/** 列表用的短时间：11-19 14:30 */
export function formatOrderTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** 详情用的完整时间：2026-11-19 14:30 */
export function formatFullTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** 付钱这件事对老人最容易含糊，订单上直接说清楚 */
export function paymentNote(order: OrderPayload) {
  if (order.status === 'pending_payment') return '还没付钱';
  if (order.status === 'refunded') return '钱已经退回';
  if (order.paymentMethod === 'cash') return '收到菜再付钱';
  return order.paidAt ? '已经付过钱' : '';
}

/** 件数展示：称重商品可能是小数 */
export function itemCountLabel(order: OrderPayload) {
  const count = order.itemCount % 1 === 0 ? String(order.itemCount) : order.itemCount.toFixed(2);
  return `${count} 件`;
}

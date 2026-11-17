import { cache } from 'react';
import { apiRequest } from './api';
import { getSessionToken } from './session';

/**
 * 顶栏下拉菜单用的轻量统计，直接复用既有接口，不新增后端。
 * 未登录或接口异常时返回 null，由组件决定不展示对应数字。
 */

/** 仍在进行中的订单状态（完成 / 取消 / 已退款 之外都算） */
const ONGOING_STATUSES = new Set([
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'refund_pending'
]);

export const getAddressCount = cache(async (): Promise<number | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const response = await apiRequest<{ items: unknown[] }>('/api/addresses', { token });
  if (!response.ok || !Array.isArray(response.data?.items)) return null;
  return response.data.items.length;
});

export const getOngoingOrderCount = cache(async (): Promise<number | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  // 顾客订单列表最多返回 50 条，足够支撑顶栏的「进行中」计数
  const response = await apiRequest<{ items: { status: string }[] }>('/api/mobile/orders', { token });
  if (!response.ok || !Array.isArray(response.data?.items)) return null;
  return response.data.items.filter((order) => ONGOING_STATUSES.has(order.status)).length;
});

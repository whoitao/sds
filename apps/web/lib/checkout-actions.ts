'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest } from './api';
import { getSessionToken } from './session';

/**
 * 结算页下单：直接复用既有 POST /api/mobile/orders。
 * 目前 web 端只提供「货到付款」（到店/收货时付款），线上支付未接入，
 * 因此提交后订单状态由接口决定，前端不展示任何支付成功文案。
 */
export type CheckoutOrder = {
  id: string;
  orderNo: string;
  shopId: string;
  shopName: string;
  status: string;
  statusLabel: string;
  totalAmount: string;
  itemCount: number;
  fulfillmentType: 'delivery' | 'pickup';
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
};

export type PlaceOrderInput = {
  fulfillmentType: 'delivery' | 'pickup';
  /** cash = 货到付款；wechat = 线上支付（尚未开通，接口会生成待支付订单） */
  paymentMethod: 'cash' | 'wechat';
  addressId?: string | null;
  remark?: string;
  groups: { shopId: string; itemIds: string[] }[];
};

export type PlaceOrderResult =
  | { ok: true; orders: CheckoutOrder[] }
  | { ok: false; error: string; code?: string };

const CHECKOUT_PATH = '/checkout';

export async function placeOrderAction(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const token = await getSessionToken();
  if (!token) redirect(`/login?next=${encodeURIComponent(CHECKOUT_PATH)}`);

  const response = await apiRequest<{ orders: CheckoutOrder[] }>('/api/mobile/orders', {
    method: 'POST',
    token,
    body: {
      fulfillmentType: input.fulfillmentType,
      paymentMethod: input.paymentMethod,
      addressId:
        input.fulfillmentType === 'delivery' ? input.addressId ?? undefined : undefined,
      remark: input.remark?.trim() || undefined,
      groups: input.groups
    }
  });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(CHECKOUT_PATH)}`);
  if (!response.ok || !response.data?.orders) {
    return {
      ok: false,
      error: response.message ?? '下单失败，请稍后再试',
      code: response.code
    };
  }

  // 下单成功后购物车条目已被接口清空：刷新布局，让顶栏角标与店内购物车同步
  revalidatePath('/', 'layout');
  return { ok: true, orders: response.data.orders };
}

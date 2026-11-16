/** 付款方式（对应 orders.payment_method 与 order_payments.method） */
export const PAYMENT_METHODS = ['wechat', 'cash', 'balance'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wechat: '微信支付',
  cash: '货到付款',
  balance: '余额支付'
};

/** 下单时顾客可选的付款方式；余额支付尚未开放 */
export const CHECKOUT_PAYMENT_METHODS: PaymentMethod[] = ['wechat', 'cash'];

/** 是否需要线上收款：线上单取消/退款要走退款流程，线下单直接取消 */
export function isOnlinePayment(method: PaymentMethod | null | undefined) {
  return method === 'wechat' || method === 'balance';
}

/** 支付流水状态（对应 order_payments.status） */
export const PAYMENT_RECORD_STATUS_LABELS: Record<string, string> = {
  created: '待支付',
  paid: '已支付',
  offline: '线下收款',
  refunded: '已退款',
  cancelled: '已作废'
};

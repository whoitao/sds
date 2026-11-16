/**
 * 支付通道适配层。
 * 微信商户号还没接入，这里用沙箱通道：服务端直接记账，不做真实扣款；
 * 真实通道接入时只替换这两个函数的实现，订单侧的状态机与流水口径不变。
 */
export const PAYMENT_PROVIDER = 'sandbox';

function externalNo(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${Date.now().toString(36).toUpperCase()}${random}`.slice(0, 64);
}

export function chargePayment(amount: string) {
  return {
    provider: PAYMENT_PROVIDER,
    externalNo: externalNo('PAY'),
    paidAt: new Date(),
    amount
  };
}

export function refundPayment(amount: string) {
  return {
    provider: PAYMENT_PROVIDER,
    externalNo: externalNo('REFUND'),
    refundedAt: new Date(),
    amount
  };
}

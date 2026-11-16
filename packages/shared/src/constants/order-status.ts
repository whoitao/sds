/** 订单状态机（对应 PRD 第 6 章订单流程） */
export const ORDER_STATUS = [
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'completed',
  'cancelled',
  'refunded'
] as const;

export type OrderStatus = (typeof ORDER_STATUS)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  paid: '待接单',
  preparing: '备货中',
  delivering: '配送中',
  pickup_ready: '待自提',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款'
};

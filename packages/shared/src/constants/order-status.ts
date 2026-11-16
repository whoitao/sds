/** 订单状态机（对应 PRD 第 6 章订单流程） */
export const ORDER_STATUS = [
  'pending_payment',
  'paid',
  'preparing',
  'delivering',
  'pickup_ready',
  'completed',
  'refund_pending',
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
  refund_pending: '退款中',
  cancelled: '已取消',
  refunded: '已退款'
};

/** 正向流转（后台推进）；取消与退款走各自专用接口，不在此表 */
export const ORDER_NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['delivering', 'pickup_ready', 'cancelled'],
  delivering: ['completed'],
  pickup_ready: ['completed', 'cancelled'],
  completed: [],
  refund_pending: [],
  cancelled: [],
  refunded: []
};

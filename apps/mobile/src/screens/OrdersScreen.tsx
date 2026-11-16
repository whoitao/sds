import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  cancelOrder,
  fetchOrders,
  payOrders,
  type OrderPayload,
  type QuantityMode
} from '../api';
import { cardShadow, colors, fontSize, radius, spacing } from '../theme';
import ScreenHeader from '../components/ScreenHeader';
import TabBar from '../components/TabBar';
import { DangerButton, GhostButton, PrimaryButton } from '../components/Button';

const statusStyles: Record<string, { background: string; color: string }> = {
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

function formatQuantity(value: number, mode: QuantityMode) {
  if (mode === 'integer') return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** 付钱这件事对老人最容易含糊，订单卡上直接说清楚 */
function paymentNote(order: OrderPayload) {
  if (order.status === 'pending_payment') return '还没付钱';
  if (order.status === 'refunded') return '钱已经退回';
  if (order.paymentMethod === 'cash') return '收到菜再付钱';
  return order.paidAt ? '已经付过钱' : '';
}

/**
 * 我的订单：按门店一单一卡，展示进度、商品与金额。
 * 待支付的单可以直接付钱，备货前可以说「不要了」；
 * 已线上付款的取消会转成退款申请，由门店在后台确认。
 */
export default function OrdersScreen({
  token,
  onGoHome,
  onOpenCart,
  onOpenProfile
}: {
  token: string;
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenProfile: () => void;
}) {
  const [orders, setOrders] = useState<OrderPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await fetchOrders(token);
      setOrders(payload.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(order: OrderPayload, action: () => Promise<unknown>) {
    setActingId(order.id);
    try {
      await action();
      await load();
    } catch (err) {
      Alert.alert('没有办成', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setActingId('');
    }
  }

  function askPay(order: OrderPayload) {
    Alert.alert(
      `现在付钱 ¥${order.totalAmount}`,
      `${order.shopName} 的菜。\n现在用的是演示付款通道，不会真的从您卡里扣钱。`,
      [
        { text: '先不付', style: 'cancel' },
        { text: '确认付款', onPress: () => void run(order, () => payOrders(token, [order.id])) }
      ]
    );
  }

  function askCancel(order: OrderPayload) {
    Alert.alert(
      '不要这些菜了？',
      order.cancelNeedsRefund
        ? `钱已经付了，取消后要等店长确认，确认后 ¥${order.totalAmount} 会退回。`
        : '取消后菜会还给店里，钱不会扣。',
      [
        { text: '再想想', style: 'cancel' },
        {
          text: '不要了',
          style: 'destructive',
          onPress: () =>
            void run(order, async () => {
              const result = await cancelOrder(token, order.id, '顾客取消订单');
              if (result.refundPending) Alert.alert('已经交给店长了', result.message);
            })
        }
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader
        left="bell"
        onLeftPress={() => Alert.alert('暂无新消息', '订单进度变化时会显示在这里。')}
        title="我的订单"
        onHelpPress={() =>
          Alert.alert('需要帮忙？', '可以到「我的」里联系客服，或者直接拨打门店电话。')
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
          <Text style={styles.centerText}>正在看看订单…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.centerText}>{error}</Text>
              <GhostButton label="重新加载" compact onPress={() => void load()} />
            </View>
          ) : orders.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="receipt-outline" size={48} color={colors.ink3} />
              <Text style={styles.emptyTitle}>还没有订单</Text>
              <Text style={styles.centerText}>买了菜之后，订单会显示在这里。</Text>
              <PrimaryButton label="去首页买菜" onPress={onGoHome} />
            </View>
          ) : (
            orders.map((order) => {
              const tone = statusStyles[order.status] ?? statusStyles.paid;
              const countLabel =
                order.itemCount % 1 === 0 ? String(order.itemCount) : order.itemCount.toFixed(2);
              return (
                <View key={order.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Ionicons name="storefront-outline" size={18} color={colors.greenDeep} />
                    <Text style={styles.shopName} numberOfLines={1}>
                      {order.shopName}
                    </Text>
                    <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
                      <Text style={[styles.statusText, { color: tone.color }]}>
                        {order.statusLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <Text style={styles.meta}>
                      {formatTime(order.createdAt)} ·{' '}
                      {order.fulfillmentType === 'pickup' ? '到店自取' : '送货上门'}
                      {paymentNote(order) ? ` · ${paymentNote(order)}` : ''}
                    </Text>

                    <View style={styles.items}>
                      {order.items.map((item) => (
                        <View key={item.id} style={styles.itemRow}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            {item.name}
                            <Text style={styles.itemSpec}>
                              {item.specName ? ` ${item.specName}` : ''}
                            </Text>
                          </Text>
                          <Text style={styles.itemQty}>
                            ×{formatQuantity(item.quantity, item.quantityMode)}
                          </Text>
                          <Text style={styles.itemSubtotal}>¥{item.subtotal}</Text>
                        </View>
                      ))}
                    </View>

                    {order.addressText ? (
                      <Text style={styles.address} numberOfLines={2}>
                        送到：{order.addressText}
                      </Text>
                    ) : null}
                    {order.remark ? (
                      <Text style={styles.remark} numberOfLines={2}>
                        备注：{order.remark}
                      </Text>
                    ) : null}
                    {order.cancelledReason ? (
                      <Text style={styles.cancelled}>取消原因：{order.cancelledReason}</Text>
                    ) : null}
                    {order.status === 'refund_pending' ? (
                      <Text style={styles.refundNote}>
                        退款申请已经交给店长，确认后会退回 ¥{order.totalAmount}。
                      </Text>
                    ) : null}
                    {order.status === 'refunded' && order.refundAmount ? (
                      <Text style={styles.refundNote}>
                        已退款 ¥{order.refundAmount}，钱会回到您付款的账户。
                      </Text>
                    ) : null}
                    {order.refundRejectedReason && order.status !== 'refunded' ? (
                      <Text style={styles.cancelled}>
                        店长没有同意退款：{order.refundRejectedReason}
                      </Text>
                    ) : null}

                    <View style={styles.cardFooter}>
                      <Text style={styles.orderNo} numberOfLines={1}>
                        单号 {order.orderNo}
                      </Text>
                      <Text style={styles.total}>
                        共 {countLabel} 件 · ¥{order.totalAmount}
                      </Text>
                    </View>

                    {order.canPay || order.canCancel ? (
                      <View style={styles.actions}>
                        {order.canPay ? (
                          <PrimaryButton
                            compact
                            label={`现在付钱 ¥${order.totalAmount}`}
                            icon="wallet-outline"
                            loading={actingId === order.id}
                            disabled={actingId !== '' && actingId !== order.id}
                            onPress={() => askPay(order)}
                          />
                        ) : null}
                        {order.canCancel ? (
                          <DangerButton
                            compact
                            label="不要了，取消订单"
                            disabled={actingId !== ''}
                            onPress={() => askCancel(order)}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <TabBar
        active="orders"
        onHome={onGoHome}
        onCart={onOpenCart}
        onOrders={() => undefined}
        onProfile={onOpenProfile}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper
  },
  body: {
    flex: 1
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg
  },
  emptyTitle: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  centerText: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2,
    textAlign: 'center'
  },
  errorCard: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...cardShadow
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.greenSoft,
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1
  },
  shopName: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusText: {
    fontSize: fontSize.mini,
    fontWeight: '700'
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.xs
  },
  meta: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  items: {
    paddingVertical: spacing.xs
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3
  },
  itemName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.body,
    color: colors.ink
  },
  itemSpec: {
    fontSize: fontSize.mini,
    color: colors.ink3
  },
  itemQty: {
    minWidth: 48,
    textAlign: 'center',
    fontSize: fontSize.body,
    color: colors.ink2,
    fontVariant: ['tabular-nums']
  },
  itemSubtotal: {
    minWidth: 76,
    textAlign: 'right',
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  address: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2
  },
  remark: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2
  },
  cancelled: {
    fontSize: fontSize.body,
    color: colors.danger
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    marginTop: spacing.xs
  },
  orderNo: {
    flexShrink: 1,
    fontSize: fontSize.mini,
    color: colors.ink2
  },
  total: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink
  },
  refundNote: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.amber
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm
  }
});

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrder, cancelOrder, type OrderItemPayload, type OrderPayload } from '../api';
import {
  formatFullTime,
  formatQuantity,
  itemCountLabel,
  orderStatusTone,
  paymentNote
} from '../order-format';
import { cardShadow, colors, fontSize, radius, spacing } from '../theme';
import ScreenHeader from '../components/ScreenHeader';
import { GhostButton, DangerButton } from '../components/Button';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ItemRow({ item }: { item: OrderItemPayload }) {
  return (
    <View style={styles.itemRow}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Ionicons name="leaf-outline" size={22} color={colors.ink3} />
        </View>
      )}
      <View style={styles.itemMain}>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.name}
          {item.specName ? <Text style={styles.itemSpec}> {item.specName}</Text> : null}
        </Text>
        <Text style={styles.itemMeta}>
          ¥{item.unitPrice} / {item.unit} × {formatQuantity(item.quantity, item.quantityMode)}
        </Text>
      </View>
      <Text style={styles.itemSubtotal}>¥{item.subtotal}</Text>
    </View>
  );
}

/**
 * 订单详情：列表只给摘要，这里把明细、金额、履约信息、时间线与退款信息给全。
 * 数据来自 GET /api/mobile/orders/:id，与列表条目同结构；进入时刷新一次，
 * 列表已有数据时先展示旧数据，避免白屏。
 */
export default function OrderDetailScreen({
  token,
  orderId,
  initial,
  onBack
}: {
  token: string;
  orderId: string;
  initial?: OrderPayload;
  onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderPayload | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await fetchOrder(token, orderId);
      if (payload.order) {
        setOrder(payload.order);
      } else {
        setError('订单不存在或已被删除');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 取消订单只放在详情页：行为与列表原来的取消完全一致 */
  function askCancel() {
    if (!order) return;
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
          onPress: () => void doCancel()
        }
      ]
    );
  }

  async function doCancel() {
    if (!order) return;
    setCancelling(true);
    try {
      const result = await cancelOrder(token, order.id, '顾客取消订单');
      if (result.refundPending) Alert.alert('已经交给店长了', result.message);
      await load();
    } catch (err) {
      Alert.alert('没有办成', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setCancelling(false);
    }
  }

  const tone = order ? orderStatusTone[order.status] ?? orderStatusTone.paid : orderStatusTone.paid;

  // 时间线只写有数据支撑的节点，当前状态单独收尾，避免编造中间节点时间
  const timeline: { label: string; time: string | null; current?: boolean }[] = [];
  if (order) {
    timeline.push({ label: '提交订单', time: formatFullTime(order.createdAt) });
    if (order.paidAt) timeline.push({ label: '支付成功', time: formatFullTime(order.paidAt) });
    if (order.refundedAt) timeline.push({ label: '退款完成', time: formatFullTime(order.refundedAt) });
    if (order.completedAt) timeline.push({ label: '订单完成', time: formatFullTime(order.completedAt) });
    const hasTerminal =
      (order.status === 'completed' && Boolean(order.completedAt)) ||
      (order.status === 'refunded' && Boolean(order.refundedAt));
    if (!hasTerminal) timeline.push({ label: order.statusLabel, time: null, current: true });
  }

  const goodsTotal = order
    ? order.items.reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2)
    : '0.00';
  const showGoodsTotal = Boolean(order) && Math.abs(Number(goodsTotal) - Number(order!.totalAmount)) >= 0.005;
  const hasRefundInfo = Boolean(
    order &&
      (order.refundAmount ||
        order.refundReason ||
        order.refundedAt ||
        order.refundRejectedReason ||
        order.cancelledReason)
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader
        left="back"
        onLeftPress={onBack}
        title="订单详情"
      />

      {loading && !order ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
          <Text style={styles.centerText}>正在打开订单…</Text>
        </View>
      ) : !order ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={46} color={colors.ink3} />
          <Text style={styles.centerText}>{error || '订单不存在'}</Text>
          <GhostButton label="重新加载" onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
                <Text style={[styles.statusText, { color: tone.color }]}>{order.statusLabel}</Text>
              </View>
              <Text style={styles.heroAmount}>¥{order.totalAmount}</Text>
            </View>
            <Text style={styles.heroNote}>
              {paymentNote(order) || '订单正在处理，请留意状态变化'}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1} ellipsizeMode="middle">
              订单号 {order.orderNo}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              下单时间 {formatFullTime(order.createdAt)}
            </Text>
          </View>

          <Section title="状态时间线">
            {timeline.map((node, index) => (
              <View key={`${node.label}-${index}`} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.dot, node.current ? styles.dotCurrent : null]} />
                  {index < timeline.length - 1 ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.timelineMain}>
                  <Text style={[styles.timelineLabel, node.current ? styles.timelineCurrent : null]}>
                    {node.label}
                  </Text>
                  <Text style={styles.timelineTime}>{node.time ?? '当前状态'}</Text>
                </View>
              </View>
            ))}
          </Section>

          <Section title={`商品明细 · ${itemCountLabel(order)}`}>
            {order.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </Section>

          <Section title="金额">
            {showGoodsTotal ? (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>商品合计</Text>
                <Text style={styles.kvValue}>¥{goodsTotal}</Text>
              </View>
            ) : null}
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>{order.paymentMethod === 'cash' ? '应付金额' : '实付金额'}</Text>
              <Text style={styles.amountValue}>¥{order.totalAmount}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>支付方式</Text>
              <Text style={styles.kvValue}>
                {order.paymentMethodLabel ?? (order.paymentMethod === 'cash' ? '货到付款' : '未支付')}
              </Text>
            </View>
            {order.paidAt ? (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>支付时间</Text>
                <Text style={styles.kvValue}>{formatFullTime(order.paidAt)}</Text>
              </View>
            ) : null}
          </Section>

          <Section title="取货信息">
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>取货方式</Text>
              <Text style={styles.kvValue}>
                {order.fulfillmentType === 'pickup' ? '到店自取' : '送货上门'}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvLabel}>门店</Text>
              <Text style={styles.kvValue}>{order.shopName}</Text>
            </View>
            {order.addressText ? (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>送餐地址</Text>
                <Text style={styles.kvValue}>{order.addressText}</Text>
              </View>
            ) : null}
            {order.contactName || order.contactPhone ? (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>联系人</Text>
                <Text style={styles.kvValue}>
                  {[order.contactName, order.contactPhone].filter(Boolean).join(' ')}
                </Text>
              </View>
            ) : null}
            {order.remark ? (
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>备注</Text>
                <Text style={styles.kvValue}>{order.remark}</Text>
              </View>
            ) : null}
          </Section>

          {hasRefundInfo ? (
            <Section title="退款与售后">
              {order.refundAmount ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>退款金额</Text>
                  <Text style={styles.kvValue}>¥{order.refundAmount}</Text>
                </View>
              ) : null}
              {order.refundedAt ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>退款时间</Text>
                  <Text style={styles.kvValue}>{formatFullTime(order.refundedAt)}</Text>
                </View>
              ) : null}
              {order.refundReason ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>退款原因</Text>
                  <Text style={styles.kvValue}>{order.refundReason}</Text>
                </View>
              ) : null}
              {order.refundRejectedReason ? (
                <View style={styles.kvRow}>
                  <Text style={[styles.kvLabel, styles.dangerText]}>未同意原因</Text>
                  <Text style={[styles.kvValue, styles.dangerText]}>
                    {order.refundRejectedReason}
                  </Text>
                </View>
              ) : null}
              {order.cancelledReason ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>取消原因</Text>
                  <Text style={styles.kvValue}>{order.cancelledReason}</Text>
                </View>
              ) : null}
              {order.status === 'refund_pending' ? (
                <Text style={styles.refundNote}>
                  退款申请已经交给店长，确认后会退回 ¥{order.totalAmount}。
                </Text>
              ) : null}
            </Section>
          ) : null}

          {error ? <Text style={styles.errorHint}>{error}</Text> : null}

          {order.canCancel ? (
            <DangerButton
              label="不要了，取消订单"
              loading={cancelling}
              disabled={cancelling}
              onPress={askCancel}
            />
          ) : null}
        </ScrollView>
      )}
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
  centerText: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2,
    textAlign: 'center'
  },
  hero: {
    backgroundColor: colors.greenSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.green,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  heroAmount: {
    fontSize: fontSize.money,
    fontWeight: '800',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  heroNote: {
    fontSize: fontSize.body,
    color: colors.ink
  },
  heroMeta: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
    ...cardShadow
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  timelineRail: {
    width: 12,
    alignItems: 'center'
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: colors.green
  },
  dotCurrent: {
    backgroundColor: colors.greenDeep,
    transform: [{ scale: 1.2 }]
  },
  rail: {
    flex: 1,
    width: 2,
    marginTop: 3,
    backgroundColor: colors.line
  },
  timelineMain: {
    flex: 1,
    paddingBottom: spacing.sm
  },
  timelineLabel: {
    fontSize: fontSize.body,
    color: colors.ink
  },
  timelineCurrent: {
    fontWeight: '700',
    color: colors.greenDeep
  },
  timelineTime: {
    marginTop: 1,
    fontSize: fontSize.mini,
    color: colors.ink3
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.cardSoft
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  itemName: {
    fontSize: fontSize.body,
    color: colors.ink
  },
  itemSpec: {
    fontSize: fontSize.mini,
    color: colors.ink3
  },
  itemMeta: {
    fontSize: fontSize.mini,
    color: colors.ink2
  },
  itemSubtotal: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 2
  },
  kvLabel: {
    flexShrink: 0,
    fontSize: fontSize.body,
    color: colors.ink2
  },
  kvValue: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.ink,
    textAlign: 'right'
  },
  amountValue: {
    flex: 1,
    fontSize: fontSize.name,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'right',
    fontVariant: ['tabular-nums']
  },
  dangerText: {
    color: colors.danger
  },
  refundNote: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.amber
  },
  errorHint: {
    fontSize: fontSize.mini,
    color: colors.ink3,
    textAlign: 'center'
  }
});

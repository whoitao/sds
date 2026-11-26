import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrders, payOrders, type OrderPayload } from '../api';
import {
  formatOrderTime,
  itemCountLabel,
  orderStatusTone,
  paymentNote
} from '../order-format';
import { fontSize, radius, spacing, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';
import ScreenHeader from '../components/ScreenHeader';
import TabBar from '../components/TabBar';
import { GhostButton, PrimaryButton } from '../components/Button';

type OrderTabKey =
  | 'all'
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'delivering'
  | 'completed'
  | 'after_sale';

/**
 * 状态页签按现有订单状态枚举分组：
 * - 备货/自提：preparing + pickup_ready（都是等店里备好/等顾客来拿）
 * - 退款/售后：refund_pending + refunded + cancelled（售后与取消都在这里收口）
 */
const TABS: { key: OrderTabKey; label: string; statuses: string[] | null }[] = [
  { key: 'all', label: '全部', statuses: null },
  { key: 'pending_payment', label: '待付款', statuses: ['pending_payment'] },
  { key: 'paid', label: '待接单', statuses: ['paid'] },
  { key: 'preparing', label: '备货/自提', statuses: ['preparing', 'pickup_ready'] },
  { key: 'delivering', label: '配送中', statuses: ['delivering'] },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'after_sale', label: '退款/售后', statuses: ['refund_pending', 'refunded', 'cancelled'] }
];

/** 列表摘要：最多列两个商品，其余收成件数，避免一屏铺满明细 */
function summaryOf(order: OrderPayload) {
  const names = order.items.slice(0, 2).map((item) => {
    if (!item.specName) return item.name;
    return `${item.name}（${item.specName}）`;
  });
  const more = order.items.length > 2 ? ` 等 ${itemCountLabel(order)}` : ` 共 ${itemCountLabel(order)}`;
  return `${names.join('、')}${more}`;
}

/**
 * 我的订单：状态页签 + 精简订单卡。
 * 明细、地址、退款详情收进订单详情页，列表只保留门店、状态、时间、摘要、金额与操作。
 */
export default function OrdersScreen({
  token,
  cartCount,
  onGoHome,
  onOpenCart,
  onOpenProfile,
  onOpenOrder
}: {
  token: string;
  cartCount: number | null;
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenProfile: () => void;
  onOpenOrder: (order: OrderPayload) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const { colors } = theme;
  const [orders, setOrders] = useState<OrderPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState('');
  const [activeTab, setActiveTab] = useState<OrderTabKey>('all');

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

  const visible = useMemo(() => {
    const tab = TABS.find((item) => item.key === activeTab);
    if (!tab?.statuses) return orders;
    return orders.filter((order) => tab.statuses!.includes(order.status));
  }, [activeTab, orders]);

  const activeLabel = TABS.find((item) => item.key === activeTab)?.label ?? '全部';

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <ScreenHeader
        left="bell"
        onLeftPress={() => Alert.alert('暂无新消息', '订单进度变化时会显示在这里。')}
        title="我的订单"
      />

      <View style={styles.tabWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabContent}
        >
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
          ) : visible.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="receipt-outline" size={48} color={colors.ink3} />
              <Text style={styles.emptyTitle}>
                {activeTab === 'all' ? '还没有订单' : `没有「${activeLabel}」的订单`}
              </Text>
              <Text style={styles.centerText}>
                {activeTab === 'all'
                  ? '买了菜之后，订单会显示在这里。'
                  : '可以切到「全部」看看其它订单。'}
              </Text>
              {activeTab === 'all' ? (
                <PrimaryButton label="去首页买菜" onPress={onGoHome} />
              ) : (
                <GhostButton label="看看全部订单" onPress={() => setActiveTab('all')} />
              )}
            </View>
          ) : (
            visible.map((order) => {
              const toneMap = orderStatusTone(colors);
              const tone = toneMap[order.status] ?? toneMap.paid;
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
                      {formatOrderTime(order.createdAt)} ·{' '}
                      {order.fulfillmentType === 'pickup' ? '到店自取' : '送货上门'}
                      {paymentNote(order) ? ` · ${paymentNote(order)}` : ''}
                    </Text>

                    <Text style={styles.summary} numberOfLines={2}>
                      {summaryOf(order)}
                    </Text>

                    <View style={styles.cardFooter}>
                      <Text style={styles.total}>¥{order.totalAmount}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`查看 ${order.shopName} 的订单详情`}
                        hitSlop={8}
                        onPress={() => onOpenOrder(order)}
                        style={styles.detailLink}
                      >
                        <Text style={styles.detailText}>查看详情</Text>
                        <Ionicons name="chevron-forward" size={18} color={colors.greenDeep} />
                      </Pressable>
                    </View>

                    {order.canPay ? (
                      <View style={styles.actions}>
                        <PrimaryButton
                          compact
                          label={`现在付钱 ¥${order.totalAmount}`}
                          icon="wallet-outline"
                          loading={actingId === order.id}
                          disabled={actingId !== '' && actingId !== order.id}
                          onPress={() => askPay(order)}
                        />
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
        cartCount={cartCount ?? 0}
        onHome={onGoHome}
        onCart={onOpenCart}
        onOrders={() => undefined}
        onProfile={onOpenProfile}
      />
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper
  },
  tabWrap: {
    paddingBottom: spacing.sm
  },
  tabContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  tab: {
    minHeight: tap.min,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card
  },
  tabActive: {
    backgroundColor: colors.greenDeep,
    borderColor: colors.greenDeep
  },
  tabText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2
  },
  tabTextActive: {
    color: colors.white,
    fontWeight: '700'
  },
  body: {
    flex: 1
  },
  content: {
    padding: spacing.md,
    paddingTop: 0,
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
    ...shadow
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
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  statusText: {
    fontSize: fontSize.mini,
    fontWeight: '700'
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.sm
  },
  meta: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  summary: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm
  },
  total: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  detailLink: {
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: spacing.sm
  },
  detailText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.greenDeep
  },
  actions: {
    gap: spacing.sm
  }
});

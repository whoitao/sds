import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  clearCart,
  fetchCart,
  removeCartItem,
  saveCartRemark,
  updateCartItem,
  type CartGroup,
  type CartItem,
  type CartPayload
} from '../api';
import { colors, fontSize, radius, spacing, tap } from '../theme';
import { productIcon } from '../product-icons';

/**
 * 移动端购物车 T1（对应设计稿 elder-order-flow.html）：
 * - 按门店分组，组内 + / − 改数量、删除条目、清空、写备注；
 * - 底部合计「已买 N 样 / 金额 / 下一步」，下一步暂不接下单；
 * - 数据全部走服务端 /api/mobile/cart，与 admin 购物车管理同一份。
 */
export default function CartScreen({
  token,
  onGoHome,
  onOpenProfile
}: {
  token: string;
  onGoHome: () => void;
  onOpenProfile: () => void;
}) {
  const [payload, setPayload] = useState<CartPayload | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: CartPayload) => {
    setPayload(next);
    setRemarks((prev) => {
      const merged: Record<string, string> = {};
      for (const group of next.carts) {
        merged[group.id] = prev[group.id] ?? group.remark;
      }
      return merged;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      apply(await fetchCart(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : '购物车加载失败');
    } finally {
      setLoading(false);
    }
  }, [apply, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<CartPayload>) {
    if (busy) return;
    setBusy(true);
    try {
      apply(await action());
    } catch (err) {
      Alert.alert('操作没有成功', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  function changeQuantity(item: CartItem, nextQuantity: number) {
    if (nextQuantity < 1) return;
    void run(() => updateCartItem(token, item.id, nextQuantity));
  }

  function confirmRemove(item: CartItem) {
    Alert.alert('去掉这样菜？', `「${item.name}」会从购物车里删除。`, [
      { text: '留着', style: 'cancel' },
      {
        text: '去掉',
        style: 'destructive',
        onPress: () => void run(() => removeCartItem(token, item.id))
      }
    ]);
  }

  function confirmClear(group: CartGroup) {
    Alert.alert('清空这家店的购物车？', `${group.shopName} 里的 ${group.itemCount} 样菜都会删掉。`, [
      { text: '不清空', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => void run(() => clearCart(token, group.shopId))
      }
    ]);
  }

  async function saveRemark(group: CartGroup) {
    if (busy) return;
    setBusy(true);
    try {
      apply(await saveCartRemark(token, group.shopId, remarks[group.id] ?? ''));
      Alert.alert('备注已保存', '门店会看到您的要求。');
    } catch (err) {
      Alert.alert('备注没有保存', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  const itemCount = payload?.itemCount ?? 0;
  const totalAmount = Number(payload?.totalAmount ?? 0).toFixed(2);
  const carts = payload?.carts ?? [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.pageTitle}>购物车</Text>
        {itemCount > 0 ? (
          <Text style={styles.pageSubtitle}>
            共 {itemCount} 样 · ¥{totalAmount}
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
          <Text style={styles.centerText}>正在看看篮子里的菜…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新加载购物车"
            style={styles.primaryButton}
            onPress={() => void load()}
          >
            <Text style={styles.primaryButtonText}>重新加载</Text>
          </Pressable>
        </View>
      ) : carts.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="basket-outline" size={48} color={colors.ink3} />
          <Text style={styles.centerText}>篮子里还没有菜</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="去首页买菜"
            style={styles.primaryButton}
            onPress={onGoHome}
          >
            <Text style={styles.primaryButtonText}>去首页买菜</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {carts.map((group) => (
            <View key={group.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.shopName} numberOfLines={1}>
                  {group.shopName}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`清空 ${group.shopName} 的购物车`}
                  style={styles.clearButton}
                  disabled={busy}
                  onPress={() => confirmClear(group)}
                >
                  <Text style={styles.clearButtonText}>清空</Text>
                </Pressable>
              </View>

              {group.items.map((item) => (
                <View key={item.id} style={styles.item}>
                  <View style={styles.itemMain}>
                    {item.imageUrl ? (
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={styles.itemImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.itemPic}>
                        <MaterialCommunityIcons
                          name={productIcon(item.name)}
                          size={24}
                          color={colors.greenDeep}
                        />
                      </View>
                    )}
                    <View style={styles.itemInfo}>
                      <View style={styles.itemTop}>
                        <Text style={styles.itemName} numberOfLines={2}>
                          {item.name}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`删除 ${item.name}`}
                          style={styles.deleteButton}
                          disabled={busy}
                          onPress={() => confirmRemove(item)}
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        </Pressable>
                      </View>
                      <View style={styles.itemBottom}>
                        <View style={styles.itemPrices}>
                          <Text style={styles.unitPrice}>
                            ¥{item.unitPrice} / {item.unit}
                          </Text>
                          <Text style={styles.subtotal}>小计 ¥{item.subtotal}</Text>
                        </View>
                        <View style={styles.stepper}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`减少 ${item.name}`}
                            style={styles.stepperHit}
                            disabled={busy || item.quantity <= 1}
                            onPress={() => changeQuantity(item, item.quantity - 1)}
                          >
                            <View
                              style={[
                                styles.stepperButton,
                                (busy || item.quantity <= 1) && styles.stepperDisabled
                              ]}
                            >
                              <Ionicons
                                name="remove"
                                size={22}
                                color={item.quantity <= 1 ? colors.ink3 : colors.greenDeep}
                              />
                            </View>
                          </Pressable>
                          <Text style={styles.quantity} accessibilityLabel={`数量 ${item.quantity}`}>
                            {item.quantity}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`增加 ${item.name}`}
                            style={styles.stepperHit}
                            disabled={busy}
                            onPress={() => changeQuantity(item, item.quantity + 1)}
                          >
                            <View style={[styles.stepperButton, styles.stepperButtonPlus]}>
                              <Ionicons name="add" size={22} color={colors.white} />
                            </View>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              ))}

              <View style={styles.remarkRow}>
                <Text style={styles.remarkLabel}>备注</Text>
                <TextInput
                  value={remarks[group.id] ?? ''}
                  onChangeText={(value) =>
                    setRemarks((prev) => ({ ...prev, [group.id]: value.slice(0, 200) }))
                  }
                  placeholder="例如：菜挑嫩一点"
                  placeholderTextColor={colors.ink3}
                  maxLength={200}
                  style={styles.remarkInput}
                  accessibilityLabel="购物车备注"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="保存备注"
                  style={styles.remarkSave}
                  disabled={busy}
                  onPress={() => void saveRemark(group)}
                >
                  <Text style={styles.remarkSaveText}>保存</Text>
                </Pressable>
              </View>

              <Text style={styles.groupTotal}>
                本店合计 ¥{group.totalAmount}（{group.itemCount} 样）
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.dock}>
        <View style={styles.dockInfo}>
          <Text style={styles.dockCount}>
            {itemCount > 0 ? `已买 ${itemCount} 样` : '还没挑菜'}
          </Text>
          <Text style={styles.dockTotal}>¥{totalAmount}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="下一步"
          style={[styles.nextButton, itemCount === 0 && styles.nextDisabled]}
          disabled={itemCount === 0}
          onPress={() =>
            Alert.alert(
              '下一步：确认下单',
              '清点、取菜方式和付款还没接上，这一步先停在这里。您可以继续修改购物车。'
            )
          }
        >
          <Text style={styles.nextButtonText}>下一步</Text>
          <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.tabbar}>
        <Pressable
          style={styles.tab}
          accessibilityRole="button"
          accessibilityLabel="首页"
          onPress={onGoHome}
        >
          <Ionicons name="home-outline" size={22} color={colors.ink2} />
          <Text style={styles.tabText}>首页</Text>
        </Pressable>
        <Pressable
          style={styles.tab}
          accessibilityRole="button"
          accessibilityLabel="购物车，当前页"
        >
          <Ionicons name="cart" size={22} color={colors.greenDeep} />
          <Text style={[styles.tabText, styles.tabTextActive]}>购物车</Text>
          {itemCount > 0 ? (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{itemCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          style={styles.tab}
          accessibilityRole="button"
          accessibilityLabel="订单"
          onPress={() => Alert.alert('订单本轮未接入', '下单后可以在这里查看取菜进度。')}
        >
          <Ionicons name="receipt-outline" size={22} color={colors.ink2} />
          <Text style={styles.tabText}>订单</Text>
        </Pressable>
        <Pressable
          style={styles.tab}
          accessibilityRole="button"
          accessibilityLabel="我的"
          onPress={onOpenProfile}
        >
          <Ionicons name="person-outline" size={22} color={colors.ink2} />
          <Text style={styles.tabText}>我的</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  pageTitle: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.ink
  },
  pageSubtitle: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  body: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl
  },
  centerText: {
    fontSize: fontSize.name,
    color: colors.ink2,
    textAlign: 'center',
    lineHeight: 26
  },
  primaryButton: {
    minHeight: tap.primary,
    minWidth: 200,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonText: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: '#FFFFFF'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  shopName: {
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink
  },
  clearButton: {
    minHeight: tap.min,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  clearButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.danger
  },
  item: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    gap: spacing.xs
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm
  },
  itemInfo: {
    flex: 1,
    gap: spacing.xs
  },
  itemImage: {
    width: 48,
    height: 48,
    borderRadius: 11
  },
  itemPic: {
    width: 48,
    height: 48,
    borderRadius: 11,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  itemName: {
    flex: 1,
    fontSize: fontSize.name,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 26
  },
  deleteButton: {
    width: tap.min,
    height: tap.min,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  itemPrices: {
    gap: 2
  },
  unitPrice: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  subtotal: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  stepperHit: {
    width: tap.min,
    height: tap.min,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: '#BFE0CB',
    borderRadius: 12
  },
  stepperButtonPlus: {
    backgroundColor: colors.green,
    borderColor: colors.green
  },
  stepperDisabled: {
    backgroundColor: colors.paper,
    borderColor: colors.line
  },
  quantity: {
    width: 26,
    textAlign: 'center',
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink
  },
  remarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm
  },
  remarkLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2
  },
  remarkInput: {
    flex: 1,
    minHeight: tap.min,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    fontSize: fontSize.body,
    color: colors.ink,
    backgroundColor: colors.paper
  },
  remarkSave: {
    minHeight: tap.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  remarkSaveText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.greenDeep
  },
  groupTotal: {
    textAlign: 'right',
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  dockInfo: {
    flex: 1,
    gap: 2
  },
  dockCount: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  dockTotal: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.danger
  },
  nextButton: {
    minHeight: tap.primary,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.green
  },
  nextDisabled: {
    backgroundColor: colors.ink3
  },
  nextButtonText: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: '#FFFFFF'
  },
  tabbar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 6,
    paddingBottom: 8
  },
  tab: {
    flex: 1,
    minHeight: tap.min,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2
  },
  tabText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2
  },
  tabTextActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  },
  cartBadge: {
    position: 'absolute',
    top: 2,
    right: '28%',
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cartBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF'
  }
});

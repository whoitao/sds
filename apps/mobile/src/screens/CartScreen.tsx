import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  clearCart,
  fetchCart,
  removeCartItem,
  saveCartRemark,
  updateCartItem,
  type CartGroup,
  type CartItem,
  type CartPayload,
  type CheckoutGroup,
  type QuantityMode
} from '../api';
import { fontSize, radius, spacing, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';
import { productIcon } from '../product-icons';
import ScreenHeader from '../components/ScreenHeader';
import TabBar from '../components/TabBar';
import BottomDock from '../components/BottomDock';

/** 整数规格不带小数尾巴，称重规格最多两位且去掉多余的 0 */
function formatQuantity(value: number, mode: QuantityMode) {
  if (mode === 'integer') return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function isAtStockLimit(item: CartItem) {
  return item.stockQuantity > 0 && item.quantity >= item.stockQuantity;
}

function canChoose(item: CartItem) {
  return !item.soldOut && !(item.stockQuantity > 0 && item.quantity > item.stockQuantity);
}

/**
 * 移动端购物车 T1（对应设计稿 elder-order-flow.html）：
 * - 按门店分组，组内 + / − 改数量、删除条目、清空、写备注；
 * - 底部合计「已买 N 样 / 金额 / 下一步」，下一步暂不接下单；
 * - 数据全部走服务端 /api/mobile/cart，与 admin 购物车管理同一份。
 */
export default function CartScreen({
  token,
  shopName,
  cartCount,
  onCartCountChange,
  onGoHome,
  onOpenProfile,
  onOpenOrders,
  onOpenShops,
  onCheckout
}: {
  token: string;
  shopName: string;
  cartCount: number | null;
  onCartCountChange: (count: number) => void;
  onGoHome: () => void;
  onOpenProfile: () => void;
  onOpenOrders: () => void;
  onOpenShops: () => void;
  onCheckout: (groups: CheckoutGroup[]) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const { colors } = theme;
  const [payload, setPayload] = useState<CartPayload | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: CartPayload) => {
    setPayload(next);
    onCartCountChange(next.itemCount);
    setRemarks((prev) => {
      const merged: Record<string, string> = {};
      for (const group of next.carts) {
        merged[group.id] = prev[group.id] ?? group.remark;
      }
      return merged;
    });
  }, [onCartCountChange]);

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

  function itemSelected(item: CartItem) {
    return canChoose(item) && !unselected.has(item.id);
  }

  function toggleSelected(item: CartItem) {
    if (busy || !canChoose(item)) return;
    setUnselected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
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

  function startCheckout() {
    const groups: CheckoutGroup[] = carts
      .map((group) => ({
        shopId: group.shopId,
        shopName: group.shopName,
        remark: remarks[group.id] ?? group.remark,
        items: group.items.filter(itemSelected)
      }))
      .filter((group) => group.items.length > 0);
    if (groups.length > 0) onCheckout(groups);
  }

  const itemCount = payload?.itemCount ?? 0;
  const carts = payload?.carts ?? [];
  const selectedItems = carts.flatMap((group) => group.items).filter(itemSelected);
  const selectedCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const selectedTotal = selectedItems
    .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
    .toFixed(2);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />

      <ScreenHeader
        left="bell"
        onLeftPress={() => Alert.alert('暂无新消息', '订单进度变化时会显示在这里。')}
        shopName={shopName || '选择门店'}
        onShopPress={onOpenShops}
      />

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
          {carts.map((group) => {
            const groupSelected = group.items.filter(itemSelected);
            const groupSelectedCount = groupSelected.reduce((sum, item) => sum + item.quantity, 0);
            const groupSelectedTotal = groupSelected
              .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
              .toFixed(2);
            return (
            <View key={group.id} style={styles.card}>
              <View style={styles.groupHeader}>
                <Ionicons name="storefront-outline" size={18} color={colors.greenDeep} />
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

              <View style={styles.groupBody}>
              {group.items.map((item) => {
                const quantityLabel = formatQuantity(item.quantity, item.quantityMode);
                const stockRemaining = formatQuantity(item.stockQuantity, item.quantityMode);
                const atStockLimit = isAtStockLimit(item);
                const stockBlocked = item.soldOut || atStockLimit;
                const choosable = canChoose(item);
                const selected = itemSelected(item);
                return (
                  <View key={item.id} style={styles.item}>
                  <View style={styles.itemMain}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={`选择 ${item.name}`}
                      accessibilityState={{ checked: selected, disabled: !choosable }}
                      style={[styles.selectHit, !choosable ? styles.selectDisabled : null]}
                      hitSlop={8}
                      disabled={busy || !choosable}
                      onPress={() => toggleSelected(item)}
                    >
                      <Ionicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={28}
                        color={selected ? colors.green : colors.ink3}
                      />
                    </Pressable>
                    <View style={styles.itemDetails}>
                      <View style={styles.itemOverview}>
                        <View style={[styles.itemPic, item.soldOut ? styles.soldOutPic : null]}>
                          {item.imageUrl ? (
                            <Image
                              source={{ uri: item.imageUrl }}
                              style={styles.itemImage}
                              resizeMode="contain"
                              accessibilityLabel={item.name}
                            />
                          ) : (
                            <MaterialCommunityIcons
                              name={productIcon(item.name)}
                              size={36}
                              color={colors.greenDeep}
                            />
                          )}
                        </View>
                        <View style={styles.itemInfo}>
                          <View style={styles.itemTop}>
                            <Text style={styles.itemName} numberOfLines={2}>
                              {item.name}
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`删除 ${item.name}`}
                              style={styles.deleteButton}
                              hitSlop={8}
                              disabled={busy}
                              onPress={() => confirmRemove(item)}
                            >
                              <Ionicons name="trash-outline" size={18} color={colors.ink3} />
                            </Pressable>
                          </View>
                          {item.specName ? (
                            <Text style={styles.itemSpec} numberOfLines={1}>
                              {item.specName}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {item.soldOut ? (
                        <Text style={[styles.stockHint, styles.stockError]}>
                          已售罄，请删除这样菜
                        </Text>
                      ) : item.stockQuantity > 0 && item.quantity > item.stockQuantity ? (
                        <Text style={[styles.stockHint, styles.stockError]}>
                          库存仅剩 {stockRemaining} {item.unit}，请减少数量
                        </Text>
                      ) : atStockLimit ? (
                        <Text style={[styles.stockHint, styles.stockLimit]}>
                          已达库存上限（{stockRemaining} {item.unit}）
                        </Text>
                      ) : null}
                      <View style={styles.itemBottom}>
                        <View style={styles.priceInfo}>
                          <Text style={styles.unitPrice}>
                            ¥{item.unitPrice}
                            <Text style={styles.priceUnit}> / {item.unit}</Text>
                          </Text>
                          <Text style={styles.subtotal}>
                            {choosable ? `小计 ¥${item.subtotal}` : '不计入合计'}
                          </Text>
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
                          <Text
                            style={styles.quantity}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                            accessibilityLabel={`数量 ${quantityLabel}`}
                          >
                            {quantityLabel}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`增加 ${item.name}`}
                            accessibilityState={{ disabled: busy || stockBlocked }}
                            style={styles.stepperHit}
                            disabled={busy || stockBlocked}
                            onPress={() => changeQuantity(item, item.quantity + 1)}
                          >
                            <View
                              style={[
                                styles.stepperButton,
                                styles.stepperButtonPlus,
                                stockBlocked ? styles.stepperButtonPlusDisabled : null
                              ]}
                            >
                              <Ionicons
                                name="add"
                                size={22}
                                color={stockBlocked ? colors.ink3 : colors.white}
                              />
                            </View>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                  </View>
                );
              })}

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
                本店合计 ¥{groupSelectedTotal}（{groupSelectedCount} 样）
              </Text>
              </View>
            </View>
            );
          })}
        </ScrollView>
      )}

      <BottomDock
        label={selectedCount > 0 ? `合计 · 已选 ${selectedCount} 样` : '合计 · 还没选菜'}
        total={selectedTotal}
        actionLabel="下一步"
        onAction={startCheckout}
        disabled={selectedCount === 0 || busy}
      />

      <TabBar
        active="cart"
        cartCount={cartCount ?? itemCount}
        onHome={onGoHome}
        onCart={() => undefined}
        onOrders={onOpenOrders}
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
  body: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
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
    borderRadius: tap.primary / 2,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonText: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.white
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    backgroundColor: colors.greenTint,
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1
  },
  groupBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md
  },
  shopName: {
    flex: 1,
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  clearButton: {
    minHeight: tap.min,
    minWidth: 56,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  clearButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2
  },
  item: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: spacing.md
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm
  },
  selectHit: {
    width: 32,
    height: 32,
    marginTop: 22,
    alignItems: 'center',
    justifyContent: 'center'
  },
  selectDisabled: {
    opacity: 0.4
  },
  itemDetails: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm
  },
  itemOverview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs
  },
  itemImage: {
    width: 72,
    height: 72
  },
  itemPic: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center'
  },
  soldOutPic: {
    opacity: 0.55
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs
  },
  itemName: {
    flex: 1,
    paddingTop: 3,
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 26
  },
  itemSpec: {
    fontSize: fontSize.mini,
    lineHeight: 20,
    color: colors.ink2
  },
  stockHint: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 6,
    fontSize: fontSize.mini,
    lineHeight: 20
  },
  stockError: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft
  },
  stockLimit: {
    color: colors.amber,
    backgroundColor: colors.amberSoft
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  priceInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  unitPrice: {
    fontSize: fontSize.name,
    fontWeight: '700',
    lineHeight: 24,
    color: colors.ink
  },
  priceUnit: {
    fontSize: fontSize.mini,
    fontWeight: '400',
    color: colors.ink2
  },
  subtotal: {
    fontSize: fontSize.mini,
    lineHeight: 20,
    color: colors.ink2
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: colors.greenTint,
    borderRadius: radius.md
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
    borderWidth: 1,
    borderColor: colors.edgeGreen,
    borderRadius: radius.sm
  },
  stepperButtonPlus: {
    backgroundColor: colors.greenDeep,
    borderColor: colors.greenDeep
  },
  stepperButtonPlusDisabled: {
    backgroundColor: colors.line,
    borderColor: colors.line
  },
  stepperDisabled: {
    backgroundColor: colors.paper,
    borderColor: colors.line
  },
  quantity: {
    width: 36,
    textAlign: 'center',
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums']
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
    borderRadius: tap.min / 2,
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
    color: colors.ink2,
    paddingTop: spacing.xs
  }
});

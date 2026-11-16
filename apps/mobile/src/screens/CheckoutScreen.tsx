import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
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
  createOrders,
  fetchAddresses,
  payOrders,
  type AddressItem,
  type CheckoutGroup,
  type OrderPayload,
  type QuantityMode
} from '../api';
import { cardShadow, colors, fontSize, radius, spacing, tap } from '../theme';
import ScreenHeader from '../components/ScreenHeader';
import BottomDock from '../components/BottomDock';
import { DangerButton, GhostButton, PrimaryButton } from '../components/Button';

function formatQuantity(value: number, mode: QuantityMode) {
  if (mode === 'integer') return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function addressLine(address: AddressItem) {
  return `${address.province ?? ''}${address.city ?? ''}${address.district ?? ''}${address.detail}`;
}

function clockTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 确认订单（设计稿 S3 / S4 / S5）：怎么拿、送到哪、付多少钱各占一块，
 * 每块只做一个决定；下单后展示取菜进度和订单号。
 */
export default function CheckoutScreen({
  token,
  groups,
  onBack,
  onOrders,
  onGoHome,
  onManageAddresses
}: {
  token: string;
  groups: CheckoutGroup[];
  onBack: () => void;
  onOrders: () => void;
  onGoHome: () => void;
  onManageAddresses: () => void;
}) {
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [addressId, setAddressId] = useState<string | undefined>();
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [paymentMethod, setPaymentMethod] = useState<'wechat' | 'cash'>('cash');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const [submitted, setSubmitted] = useState<OrderPayload[] | null>(null);

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await fetchAddresses(token);
      setAddresses(payload.items);
      setAddressId((current) => {
        if (current && payload.items.some((item) => item.id === current)) return current;
        return payload.items.find((item) => item.isDefault)?.id ?? payload.items[0]?.id;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '地址加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const totalAmount = groups
    .flatMap((group) => group.items)
    .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
    .toFixed(2);
  const totalCount = groups
    .flatMap((group) => group.items)
    .reduce((sum, item) => sum + item.quantity, 0);
  const countLabel = totalCount % 1 === 0 ? String(totalCount) : totalCount.toFixed(2);

  const selectedAddress = addresses.find((address) => address.id === addressId);

  function showHelp() {
    Alert.alert('需要帮忙？', '可以到「我的」里联系客服，或者直接拨打门店电话。');
  }

  async function submit() {
    if (busy) return;
    if (fulfillmentType === 'delivery' && !addressId) {
      Alert.alert('还差收货地址', '请先选择或添加一个收货地址。');
      return;
    }
    setBusy(true);
    try {
      const payload = await createOrders(token, {
        fulfillmentType,
        paymentMethod,
        addressId: fulfillmentType === 'delivery' ? addressId : undefined,
        groups: groups.map((group) => ({
          shopId: group.shopId,
          itemIds: group.items.map((item) => item.id),
          remark: group.remark.trim() || undefined
        }))
      });
      setSubmitted(payload.orders);
      if (paymentMethod === 'wechat') setPaySheetOpen(true);
    } catch (err) {
      Alert.alert('没有下单成功', err instanceof Error ? err.message : '请稍后再试');
      void loadAddresses();
    } finally {
      setBusy(false);
    }
  }

  const pendingOrders = (submitted ?? []).filter((order) => order.status === 'pending_payment');
  const pendingAmount = pendingOrders
    .reduce((sum, order) => sum + Number(order.totalAmount), 0)
    .toFixed(2);

  async function pay() {
    if (paying || pendingOrders.length === 0) return;
    setPaying(true);
    try {
      const payload = await payOrders(
        token,
        pendingOrders.map((order) => order.id)
      );
      setSubmitted(payload.orders);
      setPaySheetOpen(false);
    } catch (err) {
      Alert.alert('没有付成功', err instanceof Error ? err.message : '请稍后再试，也可以在订单里再付');
    } finally {
      setPaying(false);
    }
  }

  function cancelPending() {
    if (pendingOrders.length === 0) return;
    Alert.alert(
      '不要这些菜了？',
      pendingOrders.length > 1
        ? `会一起取消 ${pendingOrders.length} 张订单，菜会还给店里，钱不会扣。`
        : '取消后菜会还给店里，钱不会扣。',
      [
        { text: '再想想', style: 'cancel' },
        {
          text: '不要了',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const order of pendingOrders) {
                await cancelOrder(token, order.id, '顾客下单后取消');
              }
              onOrders();
            } catch (err) {
              Alert.alert('没有取消成功', err instanceof Error ? err.message : '请稍后再试');
            }
          }
        }
      ]
    );
  }

  if (submitted) {
    const first = submitted[0];
    const pickup = first?.fulfillmentType === 'pickup';
    const awaitingPayment = pendingOrders.length > 0;
    const steps = awaitingPayment
      ? [
          { title: '下单好了', hint: clockTime(first?.createdAt ?? ''), state: 'done' as const },
          { title: '付钱', hint: `要付 ¥${pendingAmount}`, state: 'now' as const },
          {
            title: pickup ? '到店取菜' : '送到家',
            hint: '付完店里开始备菜',
            state: 'pending' as const
          }
        ]
      : [
          { title: '下单好了', hint: clockTime(first?.createdAt ?? ''), state: 'done' as const },
          { title: '店里备菜', hint: '接单后开始', state: 'now' as const },
          {
            title: pickup ? '到店取菜' : '送到家',
            hint: pickup ? '备好后打电话' : '备好后送上门',
            state: 'pending' as const
          }
        ];

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScreenHeader
          shopName={submitted.length === 1 ? first.shopName : '下单好了'}
          shopLocked
          onHelpPress={showHelp}
        />

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.successContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.okHead}>
            <View style={[styles.okMark, awaitingPayment ? styles.okMarkWait : null]}>
              <Ionicons
                name={awaitingPayment ? 'wallet-outline' : 'checkmark'}
                size={38}
                color={colors.white}
              />
            </View>
            <Text style={styles.okTitle}>{awaitingPayment ? '还差一步：付钱' : '已经告诉店里了'}</Text>
            <Text style={styles.okHint}>
              {awaitingPayment
                ? `${pendingOrders.length > 1 ? `${pendingOrders.length} 张订单` : first.shopName}一共要付 ¥${pendingAmount}，付完店里就开始备菜。`
                : submitted.length > 1
                  ? `已按门店分成 ${submitted.length} 张订单，门店接单后开始备货。`
                  : pickup
                    ? `${first.shopName} · 门店备好菜会给您打电话`
                    : `${first.shopName} · 备好菜后送货上门`}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.progress}>
              <View style={[styles.rail, styles.railFirst]} />
              <View style={[styles.rail, styles.railSecond]} />
              {steps.map((step) => (
                <View key={step.title} style={styles.step}>
                  <View
                    style={[
                      styles.dot,
                      step.state === 'done'
                        ? styles.dotDone
                        : step.state === 'now'
                          ? styles.dotNow
                          : null
                    ]}
                  />
                  <Text style={[styles.stepTitle, step.state === 'pending' && styles.stepTitlePend]}>
                    {step.title}
                  </Text>
                  <Text style={styles.stepHint}>{step.hint}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.codeCard}>
            <Text style={styles.codeK}>订单号</Text>
            {submitted.map((order) => (
              <View key={order.id} style={submitted.length > 1 ? styles.codeRow : undefined}>
                {submitted.length > 1 ? (
                  <Text style={styles.codeShop}>{order.shopName}</Text>
                ) : null}
                <Text
                  style={submitted.length > 1 ? styles.codeVSmall : styles.codeV}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {order.orderNo}
                </Text>
              </View>
            ))}
            <Text style={styles.codeD}>
              {awaitingPayment
                ? '付完钱，把这个号给店员或送货的人看'
                : pickup
                  ? '到店后报这个号给店员就行'
                  : '送货来了，把这个号给他看就行'}
            </Text>
          </View>

          <View style={styles.successActions}>
            {awaitingPayment ? (
              <>
                <PrimaryButton
                  label={`现在付钱 ¥${pendingAmount}`}
                  icon="wallet-outline"
                  onPress={() => setPaySheetOpen(true)}
                />
                <GhostButton label="稍后再付，先看订单" icon="receipt-outline" onPress={onOrders} />
                <DangerButton label="不要了，取消订单" onPress={cancelPending} />
              </>
            ) : (
              <>
                <PrimaryButton label="查看订单" icon="receipt-outline" onPress={onOrders} />
                <GhostButton label="回到首页" icon="home-outline" onPress={onGoHome} />
              </>
            )}
          </View>
        </ScrollView>

        <Modal
          visible={paySheetOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setPaySheetOpen(false)}
        >
          <View style={styles.sheetBackdrop}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>确认付钱</Text>
              <Text style={styles.sheetAmount}>
                <Text style={styles.sheetCurrency}>¥</Text>
                {pendingAmount}
              </Text>
              <Text style={styles.sheetCount}>
                {pendingOrders.length > 1 ? `${pendingOrders.length} 张订单一起付` : first?.shopName}
              </Text>
              <View style={styles.sheetNote}>
                <Ionicons name="information-circle-outline" size={20} color={colors.blueInk} />
                <Text style={styles.sheetNoteText}>
                  现在用的是演示付款通道，不会真的从您卡里扣钱。
                </Text>
              </View>
              <View style={styles.sheetActions}>
                <PrimaryButton
                  label={paying ? '正在付…' : '确认付款'}
                  onPress={() => void pay()}
                  loading={paying}
                />
                <GhostButton label="先不付" onPress={() => setPaySheetOpen(false)} disabled={paying} />
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader
        left="back"
        onLeftPress={onBack}
        shopName={groups.length === 1 ? groups[0].shopName : undefined}
        title={groups.length === 1 ? undefined : '确认订单'}
        shopLocked
        onHelpPress={showHelp}
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新加载地址"
              style={styles.retryButton}
              onPress={() => void loadAddresses()}
            >
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.optList}>
          {(
            [
              {
                value: 'delivery',
                label: '送货到家',
                icon: 'bicycle-outline',
                desc: '备好菜后送到家\n到家前会先打电话'
              },
              {
                value: 'pickup',
                label: '我去店里拿',
                icon: 'storefront-outline',
                desc: '备好菜后给您打电话\n在营业时间内到店取'
              }
            ] as const
          ).map((option) => {
            const active = fulfillmentType === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.label}
                style={[styles.opt, active ? styles.optActive : null]}
                onPress={() => setFulfillmentType(option.value)}
              >
                <View style={[styles.optIcon, active ? styles.optIconActive : null]}>
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={active ? colors.greenDeep : colors.ink2}
                  />
                </View>
                <View style={styles.optText}>
                  <Text style={styles.optTitle}>{option.label}</Text>
                  <Text style={styles.optDesc}>{option.desc}</Text>
                </View>
                <View style={[styles.radio, active ? styles.radioActive : null]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {fulfillmentType === 'delivery' ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>送到哪儿</Text>
              {addresses.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={addressPickerOpen ? '收起地址列表' : '换个地址'}
                  style={styles.linkHit}
                  onPress={() => setAddressPickerOpen((open) => !open)}
                >
                  <Text style={styles.linkText}>{addressPickerOpen ? '收起' : '换个地址'}</Text>
                  <Ionicons
                    name={addressPickerOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.greenDeep}
                  />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="添加地址"
                  style={styles.linkHit}
                  onPress={onManageAddresses}
                >
                  <Text style={styles.linkText}>添加地址</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.greenDeep} />
                </Pressable>
              )}
            </View>

            {loading ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator color={colors.green} />
                <Text style={styles.mutedText}>正在读取地址…</Text>
              </View>
            ) : addresses.length === 0 ? (
              <View style={styles.emptyAddress}>
                <Text style={styles.mutedText}>还没有收货地址，先加一个吧。</Text>
                <GhostButton label="去添加地址" onPress={onManageAddresses} />
              </View>
            ) : selectedAddress ? (
              <>
                <View style={styles.addressCurrent}>
                  <Text style={styles.addressName}>
                    {selectedAddress.contactName}
                    <Text style={styles.addressPhone}>　{selectedAddress.contactPhone}</Text>
                  </Text>
                  <Text style={styles.addressDetail}>{addressLine(selectedAddress)}</Text>
                </View>
                {addressPickerOpen ? (
                  <View style={styles.addressList}>
                    {addresses.map((address) => {
                      const active = address.id === addressId;
                      return (
                        <Pressable
                          key={address.id}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${address.contactName} ${addressLine(address)}`}
                          style={[styles.addressItem, active ? styles.addressItemActive : null]}
                          onPress={() => {
                            setAddressId(address.id);
                            setAddressPickerOpen(false);
                          }}
                        >
                          <View style={[styles.radio, active ? styles.radioActive : null]}>
                            {active ? <View style={styles.radioDot} /> : null}
                          </View>
                          <View style={styles.addressInfo}>
                            <Text style={styles.addressName}>
                              {address.contactName}
                              <Text style={styles.addressPhone}>
                                　{address.contactPhone}
                              </Text>
                              {address.isDefault ? (
                                <Text style={styles.defaultTag}>　默认</Text>
                              ) : null}
                            </Text>
                            <Text style={styles.addressDetail}>{addressLine(address)}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    <GhostButton label="管理收货地址" compact onPress={onManageAddresses} />
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>到店自取</Text>
            <Text style={styles.mutedText}>
              门店备好菜后会给您电话，请在营业时间内到店取菜。
            </Text>
          </View>
        )}

        <View style={styles.totalCard}>
          <Text style={styles.totalK}>
            一共 {countLabel} 样，要付
          </Text>
          <Text style={styles.totalV}>
            <Text style={styles.totalCurrency}>¥</Text>
            {totalAmount}
          </Text>
        </View>

        <View style={styles.optList}>
          {(
            [
              {
                value: 'wechat',
                label: '现在微信付',
                icon: 'logo-wechat',
                desc: '付完店里马上备菜\n不用备现金'
              },
              {
                value: 'cash',
                label: '收到菜再付钱',
                icon: 'cash-outline',
                desc: '送到家或到店取时再付\n现金、当面扫码都行'
              }
            ] as const
          ).map((option) => {
            const active = paymentMethod === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.label}
                style={[styles.opt, active ? styles.optActive : null]}
                onPress={() => setPaymentMethod(option.value)}
              >
                <View style={[styles.optIcon, active ? styles.optIconActive : null]}>
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={active ? colors.greenDeep : colors.ink2}
                  />
                </View>
                <View style={styles.optText}>
                  <Text style={styles.optTitle}>{option.label}</Text>
                  <Text style={styles.optDesc}>{option.desc}</Text>
                </View>
                <View style={[styles.radio, active ? styles.radioActive : null]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {groups.map((group) => {
          const groupCount = group.items.reduce((sum, item) => sum + item.quantity, 0);
          const groupSubtotal = group.items
            .reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)
            .toFixed(2);
          return (
            <View key={group.shopId} style={styles.groupCard}>
              <View style={styles.groupHeader}>
                <Ionicons name="storefront-outline" size={18} color={colors.greenDeep} />
                <Text style={styles.groupName} numberOfLines={1}>
                  {group.shopName}
                </Text>
                <Text style={styles.groupCount}>
                  {groupCount % 1 === 0 ? groupCount : groupCount.toFixed(2)} 样
                </Text>
              </View>
              <View style={styles.groupBody}>
                {group.items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.itemSpec}>
                        {item.specName ? `${item.specName} · ` : ''}¥{item.unitPrice}/{item.unit}
                      </Text>
                    </View>
                    <Text style={styles.itemQty}>
                      ×{formatQuantity(item.quantity, item.quantityMode)}
                    </Text>
                    <Text style={styles.itemSubtotal}>¥{item.subtotal}</Text>
                  </View>
                ))}
                {group.remark ? (
                  <Text style={styles.groupRemark}>备注：{group.remark}</Text>
                ) : null}
                <Text style={styles.groupSubtotal}>本店合计 ¥{groupSubtotal}</Text>
              </View>
            </View>
          );
        })}

        <View style={styles.tip}>
          <Ionicons name="call-outline" size={20} color={colors.blueInk} />
          <Text style={styles.tipText}>
            头一次送，店里会<Text style={styles.tipStrong}>先打电话</Text>再上门，不会直接敲门。
          </Text>
        </View>
      </ScrollView>

      <BottomDock
        label={
          fulfillmentType === 'delivery' && selectedAddress
            ? `送到 ${selectedAddress.contactName} 家`
            : `共 ${groups.length} 家店`
        }
        total={totalAmount}
        actionLabel={paymentMethod === 'wechat' ? '下单并付钱' : '确认下单'}
        onAction={() => void submit()}
        disabled={busy || (fulfillmentType === 'delivery' && !addressId)}
        loading={busy}
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
    gap: spacing.md,
    paddingBottom: spacing.xl
  },
  errorCard: {
    backgroundColor: colors.amberSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm
  },
  errorText: {
    fontSize: fontSize.body,
    color: colors.ink
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    minHeight: tap.min,
    justifyContent: 'center'
  },
  retryText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.greenDeep
  },
  optList: {
    gap: spacing.md
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 15,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    ...cardShadow
  },
  optActive: {
    borderColor: colors.green,
    backgroundColor: '#F4FBF6'
  },
  optIcon: {
    width: 46,
    height: 46,
    flexShrink: 0,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.line
  },
  optIconActive: {
    backgroundColor: colors.greenSoft,
    borderColor: '#BFE0CB'
  },
  optText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  optTitle: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  optDesc: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.ink2
  },
  radio: {
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center'
  },
  radioActive: {
    borderColor: colors.green
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.green
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  cardLabel: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  linkHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: tap.min,
    paddingLeft: spacing.sm
  },
  linkText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.greenDeep
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  mutedText: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2
  },
  emptyAddress: {
    gap: spacing.sm,
    alignItems: 'flex-start'
  },
  addressList: {
    gap: spacing.sm
  },
  addressCurrent: {
    gap: 4,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.line
  },
  addressItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardSoft
  },
  addressItemActive: {
    borderColor: colors.green,
    backgroundColor: colors.greenSoft
  },
  addressInfo: {
    flex: 1,
    gap: 2
  },
  addressName: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  addressPhone: {
    fontWeight: '400',
    color: colors.ink2
  },
  defaultTag: {
    fontSize: fontSize.mini,
    fontWeight: '700',
    color: colors.greenDeep
  },
  addressDetail: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.ink2
  },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    ...cardShadow
  },
  totalK: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  totalV: {
    fontSize: fontSize.money,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  totalCurrency: {
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  groupCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    ...cardShadow
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.greenSoft,
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1
  },
  groupName: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink
  },
  groupCount: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  groupBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  itemName: {
    fontSize: fontSize.body,
    fontWeight: '600',
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
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums']
  },
  groupRemark: {
    fontSize: fontSize.body,
    color: colors.ink2,
    paddingTop: spacing.sm
  },
  groupSubtotal: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2,
    textAlign: 'right',
    paddingTop: spacing.sm
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft,
    borderWidth: 1,
    borderColor: '#C9DBEE'
  },
  tipText: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.blueInk
  },
  tipStrong: {
    fontWeight: '700',
    color: '#1E3F63'
  },
  successContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md
  },
  okHead: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    gap: 6
  },
  okMark: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  okMarkWait: {
    backgroundColor: colors.amber
  },
  okTitle: {
    fontSize: fontSize.ok,
    fontWeight: '700',
    color: colors.ink
  },
  okHint: {
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2,
    textAlign: 'center'
  },
  progress: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    position: 'relative'
  },
  rail: {
    position: 'absolute',
    top: spacing.md + 10,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.line
  },
  railFirst: {
    left: '16.7%',
    right: '50%',
    backgroundColor: colors.green
  },
  railSecond: {
    left: '50%',
    right: '16.7%'
  },
  step: {
    flex: 1,
    alignItems: 'center'
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    marginBottom: 8
  },
  dotDone: {
    borderColor: colors.green,
    backgroundColor: colors.green
  },
  dotNow: {
    borderColor: colors.green,
    backgroundColor: colors.card
  },
  stepTitle: {
    fontSize: fontSize.mini,
    fontWeight: '700',
    color: colors.ink
  },
  stepTitlePend: {
    fontWeight: '600',
    color: colors.ink2
  },
  stepHint: {
    fontSize: fontSize.mini,
    color: colors.ink2,
    marginTop: 2
  },
  codeCard: {
    alignItems: 'center',
    gap: 2,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#F4FBF6',
    ...cardShadow
  },
  codeK: {
    fontSize: fontSize.body,
    letterSpacing: 2,
    color: colors.ink2
  },
  codeV: {
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 4,
    color: colors.greenDeep,
    fontVariant: ['tabular-nums']
  },
  codeRow: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs
  },
  codeShop: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  codeVSmall: {
    fontSize: fontSize.title,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.greenDeep,
    fontVariant: ['tabular-nums']
  },
  codeD: {
    fontSize: fontSize.body,
    color: colors.ink2,
    marginTop: 4,
    textAlign: 'center'
  },
  successActions: {
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(30, 42, 34, 0.45)'
  },
  sheet: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg
  },
  sheetTitle: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  sheetAmount: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.greenDeep,
    fontVariant: ['tabular-nums']
  },
  sheetCurrency: {
    fontSize: fontSize.title,
    fontWeight: '700'
  },
  sheetCount: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  sheetNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.blueSoft
  },
  sheetNoteText: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.blueInk
  },
  sheetActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingTop: spacing.sm
  }
});

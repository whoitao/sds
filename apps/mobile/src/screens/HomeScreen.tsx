import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import {
  addCartItem,
  fetchCart,
  fetchHome,
  fetchProducts,
  type CartPayload,
  type CategoryChild,
  type CategoryNode,
  type CustomerProfile,
  type ProductItem,
  type ProductSkuItem,
  type ShopInfo
} from '../api';
import { cardShadow, colors, fontSize, radius, spacing, tap } from '../theme';
import { productIcon, type MaterialIconName } from '../product-icons';
import ScreenHeader from '../components/ScreenHeader';
import TabBar from '../components/TabBar';
import BottomDock from '../components/BottomDock';

const CATEGORY_ICON: Record<string, MaterialIconName> = {
  肉: 'food-steak',
  蛋: 'egg-outline',
  奶: 'cup-water',
  菜: 'leaf',
  粮: 'rice',
  料: 'shaker-outline'
};

function categoryIcon(name: string): MaterialIconName {
  return CATEGORY_ICON[name] ?? 'basket-outline';
}

function formatToday() {
  const now = new Date();
  const weeks = ['日', '一', '二', '三', '四', '五', '六'];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${weeks[now.getDay()]}`;
}

function formatPrice(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : value;
}

/** 顾客称呼：优先昵称，其次手机号尾号，避免首页出现空问候 */
function customerName(customer: CustomerProfile) {
  const nickname = customer.nickname?.trim();
  if (nickname) return nickname;
  return `尾号 ${customer.phone.slice(-4)} 的顾客`;
}

export default function HomeScreen({
  customer,
  token,
  onOpenProfile,
  onOpenCart,
  onOpenOrders,
  onOpenShops,
  shopId,
  shopNotice,
  onShopNameChange
}: {
  customer: CustomerProfile;
  token: string;
  onOpenProfile: () => void;
  onOpenCart: () => void;
  onOpenOrders: () => void;
  onOpenShops: () => void;
  shopId: string;
  shopNotice: string;
  onShopNameChange: (name: string) => void;
}) {
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [rootId, setRootId] = useState<string | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartSummary, setCartSummary] = useState({
    itemCount: 0,
    buyableCount: 0,
    buyableTotal: '0.00'
  });
  const [cartBusy, setCartBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [goodsLoading, setGoodsLoading] = useState(false);
  const [error, setError] = useState('');
  const [goodsError, setGoodsError] = useState('');

  const loadProducts = useCallback(async (shopId: string, categoryId: string | null) => {
    setGoodsLoading(true);
    setGoodsError('');
    try {
      const payload = await fetchProducts(shopId, categoryId ?? undefined, 100);
      setProducts(payload.items);
    } catch (err) {
      setProducts([]);
      setGoodsError(err instanceof Error ? err.message : '商品加载失败');
    } finally {
      setGoodsLoading(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProducts([]);
      const home = await fetchHome(shopId);
      setShop(home.shop);
      onShopNameChange(home.shop.name);
      setCategories(home.categories);
      const firstRoot = home.categories[0]?.id ?? null;
      setRootId(firstRoot);
      setChildId(null);
      await loadProducts(shopId, firstRoot);
    } catch (err) {
      setError(err instanceof Error ? err.message : '页面加载失败');
    } finally {
      setLoading(false);
    }
  }, [loadProducts, shopId, onShopNameChange]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const applyCart = useCallback((payload: CartPayload) => {
    const quantityByProduct: Record<string, number> = {};
    let buyableCount = 0;
    let buyableTotal = 0;
    for (const group of payload.carts) {
      for (const line of group.items) {
        quantityByProduct[line.productId] = (quantityByProduct[line.productId] ?? 0) + line.quantity;
        // 售罄或超过库存的行在购物车里选不中，首页也不能算进「已经买了」
        if (line.soldOut || (line.stockQuantity > 0 && line.quantity > line.stockQuantity)) continue;
        buyableCount += line.quantity;
        buyableTotal += Number(line.unitPrice) * line.quantity;
      }
    }
    setCart(quantityByProduct);
    setCartSummary({
      itemCount: payload.itemCount,
      buyableCount,
      buyableTotal: buyableTotal.toFixed(2)
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCart(token)
      .then((payload) => {
        if (!cancelled) applyCart(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applyCart, token]);

  const activeRoot = useMemo(
    () => categories.find((item) => item.id === rootId) ?? null,
    [categories, rootId]
  );

  const cartBadge = cartSummary.itemCount;
  const buyableCount = cartSummary.buyableCount;
  const buyableTotal = Number(cartSummary.buyableTotal);

  function selectRoot(category: CategoryNode) {
    if (category.id === rootId) return;
    setRootId(category.id);
    setChildId(null);
    if (shop) void loadProducts(shop.id, category.id);
  }

  function selectChild(child: CategoryChild | null) {
    if (!shop) return;
    const nextId = child?.id ?? null;
    if (nextId === childId) return;
    setChildId(nextId);
    void loadProducts(shop.id, nextId ?? rootId);
  }

  async function addSkuToCart(sku: ProductSkuItem) {
    if (cartBusy) return;
    if (sku.soldOut) {
      Alert.alert('这个规格暂时售罄', '可以换一个规格，或稍后再看看。');
      return;
    }
    setCartBusy(true);
    try {
      applyCart(await addCartItem(token, sku.skuId));
    } catch (err) {
      Alert.alert('没能放进篮子', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setCartBusy(false);
    }
  }

  function addToCart(item: ProductItem) {
    const available = item.skus.filter((sku) => !sku.soldOut);
    if (available.length === 0) {
      Alert.alert('这个菜今天卖完了', '明天再来看看吧。');
      return;
    }
    if (available.length === 1) {
      void addSkuToCart(available[0]);
      return;
    }
    Alert.alert(
      '选一个规格',
      undefined,
      available.map((sku) => ({
        text: `${sku.specName} ¥${formatPrice(sku.price)}`,
        onPress: () => void addSkuToCart(sku)
      }))
    );
  }

  function callShop() {
    if (!shop?.phone) {
      Alert.alert('门店电话暂未公布', '可以到店咨询店员。');
      return;
    }
    void Linking.openURL(`tel:${shop.phone}`).catch(() => {
      Alert.alert('拨号失败', `请手动拨打 ${shop.phone}`);
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
          <Text style={styles.centerText}>正在为您准备今天的菜…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !shop) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.center}>
          <Text style={styles.centerText}>{error || '门店信息加载失败'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新加载"
            style={styles.retryButton}
            onPress={() => void bootstrap()}
          >
            <Text style={styles.retryText}>再试一次</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.retryButton} onPress={onOpenShops}>
            <Text style={styles.retryText}>找别家店</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <ScreenHeader
        left="bell"
        onLeftPress={() => Alert.alert('暂无新消息', '有优惠或取菜通知时会显示在这里。')}
        shopName={shop.name}
        onShopPress={onOpenShops}
        onHelpPress={callShop}
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {shopNotice ? <Text accessibilityRole="alert" style={styles.shopNotice}>{shopNotice}</Text> : null}
        <View style={styles.greetingRow}>
          <Text style={styles.greeting} numberOfLines={1}>
            {customerName(customer)}，您好
          </Text>
          <Text style={styles.date}>{formatToday()}</Text>
        </View>

        <View style={styles.shopCard}>
          <View style={styles.shopCover}>
            {shop.coverUrl ? (
              <Image source={{ uri: shop.coverUrl }} style={styles.shopCoverImage} resizeMode="cover" />
            ) : (
              <View style={styles.shopCoverIcons}>
                <MaterialCommunityIcons name="leaf" size={22} color="#6FA985" />
                <MaterialCommunityIcons name="food-steak" size={22} color="#6FA985" />
                <MaterialCommunityIcons name="egg-outline" size={22} color="#6FA985" />
                <MaterialCommunityIcons name="rice" size={22} color="#6FA985" />
              </View>
            )}
          </View>
          <View style={styles.shopMeta}>
            <Text style={styles.shopName} numberOfLines={1}>
              {shop.name}
            </Text>
            <Text style={styles.shopStatus}>营业中</Text>
          </View>
          <Text style={styles.shopAddress} numberOfLines={1}>
            {shop.address}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.level1List}
        >
          {categories.map((category) => {
            const active = category.id === rootId;
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${category.name}，${category.productCount} 种`}
                style={[styles.level1Item, active ? styles.level1ItemActive : null]}
                onPress={() => selectRoot(category)}
              >
                <MaterialCommunityIcons
                  name={categoryIcon(category.name)}
                  size={22}
                  color={active ? colors.greenDeep : colors.ink2}
                />
                <Text
                  style={[styles.level1Text, active ? styles.level1TextActive : null]}
                  numberOfLines={1}
                >
                  {category.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.split}>
          <View style={styles.level2}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: childId === null }}
              accessibilityLabel={`全部，${activeRoot?.productCount ?? 0} 种`}
              style={[styles.level2Item, childId === null ? styles.level2ItemActive : null]}
              onPress={() => selectChild(null)}
            >
              <Text style={[styles.level2Text, childId === null ? styles.level2TextActive : null]}>
                全部
              </Text>
              <Text style={[styles.level2Count, childId === null ? styles.level2TextActive : null]}>
                {activeRoot?.productCount ?? 0}
              </Text>
            </Pressable>
            {(activeRoot?.children ?? []).map((child) => {
              const active = child.id === childId;
              return (
                <Pressable
                  key={child.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${child.name}，${child.productCount} 种`}
                  style={[styles.level2Item, active ? styles.level2ItemActive : null]}
                  onPress={() => selectChild(child)}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.level2Text, active ? styles.level2TextActive : null]}
                  >
                    {child.name}
                  </Text>
                  <Text style={[styles.level2Count, active ? styles.level2TextActive : null]}>
                    {child.productCount}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.goods}>
            {goodsLoading ? (
              <View style={styles.goodsState}>
                <ActivityIndicator color={colors.green} />
              </View>
            ) : goodsError ? (
              <View style={styles.goodsState}>
                <Text style={styles.goodsStateText}>{goodsError}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新加载商品"
                  style={styles.retrySmall}
                  onPress={() => void loadProducts(shop.id, childId ?? rootId)}
                >
                  <Text style={styles.retryText}>再试一次</Text>
                </Pressable>
              </View>
            ) : products.length === 0 ? (
              <View style={styles.goodsState}>
                <Text style={styles.goodsStateText}>这个分类今天还没有菜</Text>
              </View>
            ) : (
              products.map((item) => {
                const qty = cart[item.id] ?? 0;
                const hasRange = Number(item.priceTo) > Number(item.priceFrom);
                const specHint = item.skus.length > 1 ? ` · ${item.skus.length} 规格` : '';
                return (
                  <View key={item.id} style={styles.goodsRow}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.goodsImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.goodsPic}>
                        <MaterialCommunityIcons
                          name={productIcon(item.name)}
                          size={24}
                          color={colors.greenDeep}
                        />
                      </View>
                    )}
                    <View style={styles.goodsText}>
                      <Text
                        style={[styles.goodsName, item.soldOut ? styles.goodsNameSoldOut : null]}
                        numberOfLines={1}
                      >
                        {item.name}
                        {qty > 0 ? <Text style={styles.boughtTag}> 已买 {qty}</Text> : null}
                      </Text>
                      <Text style={styles.goodsPrice}>
                        ¥{formatPrice(item.priceFrom)}
                        {hasRange ? `~${formatPrice(item.priceTo)}` : ''} {item.unit}
                        {specHint}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        item.soldOut ? `${item.name} 已售罄` : `增加 ${item.name}`
                      }
                      accessibilityState={{ disabled: item.soldOut }}
                      style={[styles.plusButton, item.soldOut ? styles.plusButtonDisabled : null]}
                      disabled={cartBusy || item.soldOut}
                      onPress={() => addToCart(item)}
                    >
                      {item.soldOut ? (
                        <Text style={styles.plusSoldOutText}>售罄</Text>
                      ) : (
                        <Ionicons name="add" size={28} color={colors.white} />
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.tip}>
          <Ionicons name="call-outline" size={20} color={colors.blueInk} />
          <Text style={styles.tipText}>
            不会点？右上角<Text style={styles.tipStrong}>「帮助」</Text>直接接通店里。
          </Text>
        </View>
      </ScrollView>

      <BottomDock
        label={
          buyableCount > 0
            ? `已经买了 ${buyableCount} 样`
            : cartBadge > 0
              ? '篮子里没有能买的菜'
              : '还没挑菜'
        }
        total={buyableTotal.toFixed(2)}
        actionLabel="下一步"
        onAction={onOpenCart}
        disabled={buyableCount === 0}
      />

      <TabBar
        active="home"
        cartCount={cartBadge}
        onHome={() => undefined}
        onCart={onOpenCart}
        onOrders={onOpenOrders}
        onProfile={onOpenProfile}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shopNotice: { fontSize: fontSize.body, color: colors.greenDeep, backgroundColor: colors.greenSoft, padding: spacing.md, borderRadius: radius.md, lineHeight: 24 },
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
    // Android 的 SafeAreaView 不处理状态栏，这里补上避让
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
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
    textAlign: 'center'
  },
  retryButton: {
    minHeight: tap.min,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  retryText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.white
  },
  body: {
    flex: 1
  },
  bodyContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: 10
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  greeting: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.ink
  },
  date: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  shopCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...cardShadow
  },
  shopCover: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenSoft
  },
  shopCoverImage: {
    width: '100%',
    height: '100%'
  },
  shopCoverIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  shopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm
  },
  shopName: {
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink
  },
  shopStatus: {
    fontSize: fontSize.body,
    color: colors.greenDeep,
    fontWeight: '600'
  },
  shopAddress: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: 2,
    fontSize: fontSize.body,
    color: colors.ink2
  },
  level1List: {
    gap: spacing.sm,
    paddingRight: spacing.md
  },
  level1Item: {
    minWidth: 88,
    height: 56,
    flexDirection: 'row',
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    ...cardShadow
  },
  level1ItemActive: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
    borderWidth: 1.5
  },
  level1Text: {
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.ink2
  },
  level1TextActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  },
  split: {
    flexDirection: 'row',
    gap: 10
  },
  level2: {
    width: 84,
    gap: 6
  },
  level2Item: {
    minHeight: tap.min,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  level2ItemActive: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green
  },
  level2Text: {
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink
  },
  level2TextActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  },
  level2Count: {
    marginLeft: 'auto',
    fontSize: 16,
    color: colors.ink2
  },
  goods: {
    flex: 1,
    gap: spacing.sm
  },
  goodsState: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md
  },
  goodsStateText: {
    fontSize: fontSize.body,
    color: colors.ink2,
    textAlign: 'center'
  },
  retrySmall: {
    minHeight: tap.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  goodsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 11,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    ...cardShadow
  },
  goodsPic: {
    width: 48,
    height: 48,
    borderRadius: 11,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center'
  },
  goodsImage: {
    width: 48,
    height: 48,
    borderRadius: 11
  },
  goodsText: {
    flex: 1,
    gap: 2
  },
  goodsName: {
    fontSize: fontSize.name,
    fontWeight: '600',
    color: colors.ink
  },
  goodsNameSoldOut: {
    color: colors.ink2
  },
  boughtTag: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.greenDeep
  },
  goodsPrice: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  plusButton: {
    width: tap.min,
    height: tap.min,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  plusButtonDisabled: {
    backgroundColor: colors.line
  },
  plusSoldOutText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink3
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
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
  }
});

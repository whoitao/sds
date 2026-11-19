import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthScreen from './src/screens/AuthScreen';
import AddressScreen from './src/screens/AddressScreen';
import CartScreen from './src/screens/CartScreen';
import CheckoutScreen from './src/screens/CheckoutScreen';
import HomeScreen from './src/screens/HomeScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ShopsScreen from './src/screens/ShopsScreen';
import {
  fetchCart,
  fetchMe,
  logout,
  type AuthSession,
  type CheckoutGroup,
  type CustomerProfile,
  type OrderPayload
} from './src/api';
import { colors, fontSize, spacing } from './src/theme';

/** 登录态只存不透明会话 token，顾客资料每次启动用 /api/auth/me 拉取 */
const TOKEN_KEY = 'sds.customer.token';

const shopKey = (customerId: string) => `sds.customer.shop.${customerId}`;

type Tab =
  | 'home'
  | 'cart'
  | 'profile'
  | 'addresses'
  | 'checkout'
  | 'orders'
  | 'orderDetail'
  | 'shops';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [selectedShopName, setSelectedShopName] = useState('');
  const [shopsBackTo, setShopsBackTo] = useState<'home' | 'cart'>('home');
  const [shopNotice, setShopNotice] = useState('');
  const [checkoutGroups, setCheckoutGroups] = useState<CheckoutGroup[] | null>(null);
  const [addressesBackTo, setAddressesBackTo] = useState<'profile' | 'checkout'>('profile');
  const [openOrder, setOpenOrder] = useState<OrderPayload | null>(null);
  // 购物车件数挂在 App 级：四个一级页共用，切 tab 时不会因为页面卸载而丢失
  const [cartCount, setCartCount] = useState<number | null>(null);

  const refreshCartCount = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await fetchCart(token);
      setCartCount(payload.itemCount);
    } catch {
      // 取数失败时保留上一次已知数量，不退化成 0
    }
  }, [token]);

  useEffect(() => {
    if (token) void refreshCartCount();
  }, [token, refreshCartCount]);

  useEffect(() => {
    let alive = true;

    async function restore() {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (!stored) return;
        const me = await fetchMe(stored);
        const savedShopId = await AsyncStorage.getItem(shopKey(me.customer.id));
        if (!alive) return;
        setSelectedShopId(savedShopId);
        setToken(stored);
        setCustomer(me.customer);
      } catch {
        // token 过期或服务不可用：清掉本地会话，回到登录页
        await AsyncStorage.removeItem(TOKEN_KEY);
      } finally {
        if (alive) setBooting(false);
      }
    }

    void restore();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSuccess(session: AuthSession) {
    await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
    setSelectedShopId(await AsyncStorage.getItem(shopKey(session.customer.id)));
    setSelectedShopName('');
    setShopNotice('');
    setToken(session.accessToken);
    setCustomer(session.customer);
    setTab('home');
  }

  async function handleLogout() {
    const current = token;
    setToken(null);
    setCustomer(null);
    setSelectedShopId(null);
    setSelectedShopName('');
    setShopNotice('');
    setCheckoutGroups(null);
    setCartCount(null);
    setTab('home');
    await AsyncStorage.removeItem(TOKEN_KEY);
    if (current) void logout(current).catch(() => undefined);
  }

  if (booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green} size="large" />
        <Text style={styles.centerText}>正在打开捎点啥…</Text>
      </View>
    );
  }

  if (!token || !customer) {
    return <AuthScreen onSuccess={(session) => void handleSuccess(session)} />;
  }

  if (tab === 'addresses') {
    return <AddressScreen token={token} onBack={() => setTab(addressesBackTo)} />;
  }

  if (tab === 'checkout' && checkoutGroups) {
    return (
      <CheckoutScreen
        token={token}
        groups={checkoutGroups}
        onBack={() => setTab('cart')}
        onOrders={() => setTab('orders')}
        onGoHome={() => setTab('home')}
        onManageAddresses={() => {
          setAddressesBackTo('checkout');
          setTab('addresses');
        }}
        onOrderPlaced={() => void refreshCartCount()}
      />
    );
  }

  if (tab === 'orderDetail' && openOrder) {
    return (
      <OrderDetailScreen
        token={token}
        orderId={openOrder.id}
        initial={openOrder}
        onBack={() => setTab('orders')}
      />
    );
  }

  if (tab === 'orders') {
    return (
      <OrdersScreen
        token={token}
        cartCount={cartCount}
        onGoHome={() => setTab('home')}
        onOpenCart={() => setTab('cart')}
        onOpenProfile={() => setTab('profile')}
        onOpenOrder={(order) => {
          setOpenOrder(order);
          setTab('orderDetail');
        }}
      />
    );
  }

  if (tab === 'profile') {
    return (
      <ProfileScreen
        customer={customer}
        cartCount={cartCount}
        onLogout={() => void handleLogout()}
        onGoHome={() => setTab('home')}
        onOpenCart={() => setTab('cart')}
        onOpenAddresses={() => {
          setAddressesBackTo('profile');
          setTab('addresses');
        }}
        onOpenOrders={() => setTab('orders')}
      />
    );
  }

  if (tab === 'cart') {
    return (
      <CartScreen
        token={token}
        shopName={selectedShopName}
        cartCount={cartCount}
        onCartCountChange={setCartCount}
        onGoHome={() => setTab('home')}
        onOpenProfile={() => setTab('profile')}
        onOpenOrders={() => setTab('orders')}
        onOpenShops={() => { setShopsBackTo('cart'); setTab('shops'); }}
        onCheckout={(groups) => {
          setCheckoutGroups(groups);
          setTab('checkout');
        }}
      />
    );
  }

  if (tab === 'shops' || !selectedShopId) {
    return (
      <ShopsScreen
        currentShopId={selectedShopId}
        onBack={() => setTab(selectedShopId ? shopsBackTo : 'profile')}
        onSelect={async (shop) => {
          await AsyncStorage.setItem(shopKey(customer.id), shop.id);
          setShopNotice(selectedShopId && selectedShopId !== shop.id ? '已换店，原店购物车里的菜仍为您保留。' : '');
          setSelectedShopId(shop.id);
          setSelectedShopName(shop.name);
          setTab('home');
        }}
      />
    );
  }

  return (
    <HomeScreen
      token={token}
      shopId={selectedShopId}
      shopNotice={shopNotice}
      cartCount={cartCount}
      onCartCountChange={setCartCount}
      onShopNameChange={setSelectedShopName}
      onOpenProfile={() => setTab('profile')}
      onOpenCart={() => setTab('cart')}
      onOpenOrders={() => setTab('orders')}
      onOpenShops={() => { setShopsBackTo('home'); setTab('shops'); }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.paper
  },
  centerText: {
    fontSize: fontSize.name,
    color: colors.ink2
  }
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthScreen from './src/screens/AuthScreen';
import AddressScreen from './src/screens/AddressScreen';
import CartScreen from './src/screens/CartScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { fetchMe, logout, type AuthSession, type CustomerProfile } from './src/api';
import { colors, fontSize, spacing } from './src/theme';

/** 登录态只存不透明会话 token，顾客资料每次启动用 /api/auth/me 拉取 */
const TOKEN_KEY = 'sds.customer.token';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [tab, setTab] = useState<'home' | 'cart' | 'profile' | 'addresses'>('home');

  useEffect(() => {
    let alive = true;

    async function restore() {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (!stored) return;
        const me = await fetchMe(stored);
        if (!alive) return;
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
    setToken(session.accessToken);
    setCustomer(session.customer);
    setTab('home');
  }

  async function handleLogout() {
    const current = token;
    setToken(null);
    setCustomer(null);
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
    return <AddressScreen token={token} onBack={() => setTab('profile')} />;
  }

  if (tab === 'profile') {
    return (
      <ProfileScreen
        customer={customer}
        onLogout={() => void handleLogout()}
        onGoHome={() => setTab('home')}
        onOpenCart={() => setTab('cart')}
        onOpenAddresses={() => setTab('addresses')}
      />
    );
  }

  if (tab === 'cart') {
    return (
      <CartScreen
        token={token}
        onGoHome={() => setTab('home')}
        onOpenProfile={() => setTab('profile')}
      />
    );
  }

  return (
    <HomeScreen
      customer={customer}
      token={token}
      onOpenProfile={() => setTab('profile')}
      onOpenCart={() => setTab('cart')}
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

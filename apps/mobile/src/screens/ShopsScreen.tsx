import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Linking, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { fetchHome, fetchNearbyShops, fetchShops, type ShopInfo, type ShopLocation } from '../api';
import { gpsToMapLocation, shopDistanceLabel, shopHoursLabel } from '../shop-location';
import ScreenHeader from '../components/ScreenHeader';
import ShopMap from '../components/ShopMap';
import { colors, fontSize, radius, spacing, tap } from '../theme';

type LocationState = 'locating' | 'ready' | 'denied' | 'unavailable';

export default function ShopsScreen({ currentShopId, onSelect, onBack }: {
  currentShopId: string | null;
  onSelect: (shop: ShopInfo) => Promise<void>;
  onBack: () => void;
}) {
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [location, setLocation] = useState<ShopLocation | null>(null);
  const [locationState, setLocationState] = useState<LocationState>('locating');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(currentShopId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const locationRequest = useRef(0);
  const listRequest = useRef(0);
  const mounted = useRef(true);

  const locate = useCallback(async () => {
    const request = ++locationRequest.current;
    setLocationState('locating');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted.current || request !== locationRequest.current) return;
      setCanAskAgain(permission.canAskAgain);
      if (!permission.granted) {
        setLocationState('denied');
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) throw new Error('定位服务未开启');
      const result = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('定位超时')), 12000); })
      ]);
      if (!mounted.current || request !== locationRequest.current) return;
      setLocation(gpsToMapLocation(result.coords));
      setLocationState('ready');
    } catch {
      if (!mounted.current || request !== locationRequest.current) return;
      setLocationState('unavailable');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void locate();
    return () => { mounted.current = false; locationRequest.current++; listRequest.current++; };
  }, [locate]);

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setError('');
    try {
      // 与 web 一致：拿到定位就只取 3 公里内并按距离排序，拿不到则回落到全部门店列表
      const result = location
        ? await fetchNearbyShops(location, 3000)
        : await fetchShops();
      if (!mounted.current || request !== listRequest.current) return;
      setShops(result.items);
      setSelectedId(id => result.items.some(shop => shop.id === id) ? id : result.items[0]?.id ?? null);
    } catch (err) {
      if (!mounted.current || request !== listRequest.current) return;
      setShops([]);
      setError(err instanceof Error ? err.message : '门店加载失败，请重试');
    } finally {
      if (mounted.current && request === listRequest.current) setLoading(false);
    }
  }, [location]);

  // 定位尚未结束时先不请求，避免先闪一遍全部门店再切成附近门店
  useEffect(() => {
    if (locationState !== 'locating') void load();
  }, [locationState, load]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' && locationState === 'denied' && !canAskAgain) void locate();
    });
    return () => listener.remove();
  }, [locationState, canAskAgain, locate]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!choosing) onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack, choosing]);

  async function enter(shop: ShopInfo) {
    if (choosing || shop.status !== 'open') return;
    setChoosing(shop.id);
    try {
      await fetchHome(shop.id);
      if (mounted.current) await onSelect(shop);
    } catch (err) {
      if (mounted.current) Alert.alert('暂时进不了这家店', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      if (mounted.current) setChoosing(null);
    }
  }

  const visibleShops = view === 'map' ? shops.filter(shop => shop.id === selectedId) : shops;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader left="back" title="附近的店" onLeftPress={() => { if (!choosing) onBack(); }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      >
        <View style={styles.row}>
          <Text style={styles.heading}>{location ? '附近门店' : '全部门店'}{loading ? '' : ` · ${shops.length} 家`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={view === 'list' ? '切换到地图找店' : '切换到列表找店'}
            style={styles.smallButton} onPress={() => setView(view === 'list' ? 'map' : 'list')}>
            <Ionicons name={view === 'list' ? 'map-outline' : 'list-outline'} size={20} color={colors.greenDeep} />
            <Text style={styles.actionText}>{view === 'list' ? '地图找店' : '列表找店'}</Text>
          </Pressable>
        </View>
        {loading ? <View style={styles.empty}><ActivityIndicator color={colors.green} /><Text style={styles.description}>{locationState === 'locating' ? '正在获取位置…' : '正在找门店…'}</Text></View>
          : error ? <View style={styles.empty}><Text style={styles.description}>{error}</Text><Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => void load()}><Text style={styles.actionText}>重新加载</Text></Pressable></View>
          : shops.length === 0 ? <View style={styles.empty}>
            <Text style={styles.heading}>{location ? '3 公里内暂时没有门店' : '暂时没有可展示的门店'}</Text>
            <Text style={styles.description}>稍后刷新再看看，或直接到店咨询店员。</Text>
          </View> : <>
            {view === 'map' ? <>
              <ShopMap shops={shops} location={location} selectedId={selectedId} onSelect={setSelectedId} onShowList={() => setView('list')} />
            </> : null}
            {visibleShops.map(shop => <View key={shop.id} style={[styles.card, shop.id === currentShopId && styles.currentCard]}>
              <View style={styles.row}>
                <Ionicons name="storefront-outline" size={26} color={colors.greenDeep} />
                <Text style={styles.shopName}>{shop.name}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.badge, shop.status === 'closed' && styles.closed]}>{shop.status === 'open' ? '接单中' : '休息中'}</Text>
                {shop.id === currentShopId ? <Text style={styles.current}>当前门店</Text> : null}
                {shop.distanceMeters != null ? <Text style={styles.description}>{shopDistanceLabel(shop.distanceMeters)}</Text> : null}
              </View>
              <Text style={styles.description}>{shop.address}</Text>
              <Text style={styles.description}>{shopHoursLabel(shop)}</Text>
              {shop.announcement ? <Text style={styles.description}>{shop.announcement}</Text> : null}
              <View style={styles.actions}>
                {shop.phone ? <Pressable accessibilityRole="button" accessibilityLabel={`拨打 ${shop.name} 电话`} style={styles.callButton}
                  onPress={() => void Linking.openURL(`tel:${shop.phone}`).catch(() => Alert.alert('请手动拨打门店电话', shop.phone!))}>
                  <Ionicons name="call-outline" size={20} color={colors.greenDeep} /><Text style={styles.actionText} numberOfLines={1}>打电话</Text>
                </Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`去 ${shop.name} 买菜`} accessibilityState={{ disabled: !!choosing || shop.status !== 'open' }}
                  disabled={!!choosing || shop.status !== 'open'} style={[styles.enter, (!!choosing || shop.status !== 'open') && styles.disabled]} onPress={() => void enter(shop)}>
                  <Text style={styles.enterText} numberOfLines={1}>{choosing === shop.id ? '正在进店…' : shop.status === 'open' ? '去买菜' : '休息中，暂不接单'}</Text>
                </Pressable>
              </View>
            </View>)}
          </>}
        <Text style={styles.footnote}>换店后，原店的购物车会保留，仍可在购物车里一起查看。距离为直线估算，不代表步行路线或配送范围。</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  callButton: { flex: 1, minHeight: tap.min, borderRadius: tap.min / 2, paddingHorizontal: spacing.sm, backgroundColor: colors.greenSoft, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  smallButton: { minHeight: tap.min, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.greenSoft, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: fontSize.body, fontWeight: '700', color: colors.greenDeep },
  heading: { flex: 1, fontSize: fontSize.title, fontWeight: '700', color: colors.ink },
  description: { fontSize: fontSize.body, lineHeight: 24, color: colors.ink2 },
  empty: { paddingVertical: 32, gap: spacing.md, alignItems: 'center' },
  card: { backgroundColor: colors.card, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg },
  currentCard: { borderColor: colors.green },
  shopName: { flex: 1, fontSize: fontSize.title, fontWeight: '700', color: colors.ink },
  badge: { fontSize: fontSize.body, color: colors.greenDeep, backgroundColor: colors.greenSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  closed: { color: colors.ink2, backgroundColor: colors.paper },
  current: { fontSize: fontSize.body, color: colors.greenDeep, fontWeight: '700' },
  enter: { flex: 1, minHeight: tap.min, borderRadius: tap.min / 2, paddingHorizontal: spacing.sm, backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  enterText: { color: colors.white, fontSize: fontSize.name, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  footnote: { color: colors.ink2, fontSize: fontSize.body, lineHeight: 24 }
});

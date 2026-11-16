import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Linking, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View
} from 'react-native';
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
  const [scope, setScope] = useState<'nearby' | 'all'>('all');
  const [radiusMeters, setRadiusMeters] = useState(3000);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(currentShopId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const manualSearch = useRef(false);
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
        setScope('all');
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
      if (!manualSearch.current) setScope('nearby');
    } catch {
      if (!mounted.current || request !== locationRequest.current) return;
      setLocationState('unavailable');
      setScope('all');
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
      const result = scope === 'nearby' && location
        ? await fetchNearbyShops(location, radiusMeters, search)
        : await fetchShops(search);
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
  }, [scope, location, radiusMeters, search]);

  useEffect(() => { void load(); }, [load]);
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

  function showAll() {
    manualSearch.current = true;
    setScope('all');
  }

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

  const locationText = {
    locating: '正在定位，也可以先按店名或地址找店',
    ready: '已获取位置，附近门店按直线距离排序',
    denied: '未授权定位，仍可按店名、街道或小区找店',
    unavailable: '暂时定位不到，仍可从全部门店中选择'
  }[locationState];
  const visibleShops = view === 'map' ? shops.filter(shop => shop.id === selectedId) : shops;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader left="back" title="附近的店" onLeftPress={() => { if (!choosing) onBack(); }}
        onHelpPress={() => Alert.alert('怎么找店？', '可以按店名、街道或小区搜索，也可以打开定位看附近的店。地图上的店名可以点，选好后点「进去看菜」。换店不会清空购物车。')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.location}>
          <Ionicons name="location-outline" size={22} color={colors.greenDeep} />
          <Text style={styles.locationText}>{locationText}</Text>
        </View>
        <View style={styles.row}>
          <TextInput accessibilityLabel="搜索店名、街道或小区" placeholder="店名 / 街道 / 小区" placeholderTextColor={colors.ink3}
            value={keyword} onChangeText={setKeyword} maxLength={50} returnKeyType="search" style={styles.input}
            onSubmitEditing={() => { showAll(); setSearch(keyword.trim()); }} />
          <Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => { showAll(); setSearch(keyword.trim()); }}>
            <Text style={styles.actionText}>搜索</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: scope === 'nearby', disabled: locationState === 'locating' }}
            disabled={locationState === 'locating'} style={[styles.scopeButton, scope === 'nearby' && styles.active]}
            onPress={() => {
              manualSearch.current = false;
              setSearch(''); setKeyword('');
              if (locationState === 'denied' && !canAskAgain) {
                void Linking.openSettings().catch(() => Alert.alert('请打开系统设置', '在系统设置中允许捎点啥使用位置。'));
              } else if (location && locationState === 'ready') setScope('nearby');
              else void locate();
            }}>
            <Text style={styles.actionText}>{locationState === 'denied' && !canAskAgain ? '去开启定位' : '看我附近'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: scope === 'all' }} style={[styles.scopeButton, scope === 'all' && styles.active]}
            onPress={() => { showAll(); setSearch(''); setKeyword(''); }}>
            <Text style={styles.actionText}>全部门店</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={locationState === 'locating'} style={styles.smallButton}
            onPress={() => { manualSearch.current = false; void locate(); }}>
            <Text style={styles.actionText}>重新定位</Text>
          </Pressable>
        </View>
        {scope === 'nearby' ? <View style={styles.row}>
          {[3000, 10000, 20000].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: radiusMeters === value }}
            style={[styles.scopeButton, radiusMeters === value && styles.active]} onPress={() => setRadiusMeters(value)}>
            <Text style={styles.actionText}>{value / 1000} 公里内</Text>
          </Pressable>)}
        </View> : null}
        <View style={styles.row}>
          <Text style={styles.heading}>{scope === 'nearby' ? '附近门店' : '全部门店'}{loading ? '' : ` · ${shops.length} 家`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={view === 'list' ? '切换到地图找店' : '切换到列表找店'}
            style={styles.smallButton} onPress={() => setView(view === 'list' ? 'map' : 'list')}>
            <Ionicons name={view === 'list' ? 'map-outline' : 'list-outline'} size={20} color={colors.greenDeep} />
            <Text style={styles.actionText}>{view === 'list' ? '地图找店' : '列表找店'}</Text>
          </Pressable>
        </View>
        {loading ? <View style={styles.empty}><ActivityIndicator color={colors.green} /><Text style={styles.description}>正在找门店…</Text></View>
          : error ? <View style={styles.empty}><Text style={styles.description}>{error}</Text><Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => void load()}><Text style={styles.actionText}>重新加载</Text></Pressable></View>
          : shops.length === 0 ? <View style={styles.empty}>
            <Text style={styles.heading}>{scope === 'nearby' ? `${radiusMeters / 1000} 公里内暂时没有门店` : '没有找到匹配的门店'}</Text>
            <Text style={styles.description}>可以换个店名、街道或小区，也可以看看全部门店。</Text>
            {scope === 'nearby' && radiusMeters < 20000 ? <Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => setRadiusMeters(radiusMeters === 3000 ? 10000 : 20000)}><Text style={styles.actionText}>扩大查找范围</Text></Pressable> : null}
            <Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => { showAll(); setKeyword(''); setSearch(''); }}><Text style={styles.actionText}>查看全部门店</Text></Pressable>
          </View> : <>
            {view === 'map' ? <>
              <ShopMap shops={shops} location={location} selectedId={selectedId} onSelect={setSelectedId} onShowList={() => setView('list')} />
              <Text style={styles.description}>点地图上的店名，在下面查看地址、电话和营业时间。</Text>
            </> : null}
            {visibleShops.map(shop => <View key={shop.id} style={[styles.card, shop.id === currentShopId && styles.currentCard]}>
              <View style={styles.row}>
                <Ionicons name="storefront-outline" size={26} color={colors.greenDeep} />
                <Text style={styles.shopName}>{shop.name}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.badge, shop.status === 'closed' && styles.closed]}>{shop.status === 'open' ? '接单中' : '休息中'}</Text>
                {shop.id === currentShopId ? <Text style={styles.current}>当前门店</Text> : null}
                <Text style={styles.description}>{shopDistanceLabel(shop.distanceMeters)}</Text>
              </View>
              <Text style={styles.description}>{shop.address}</Text>
              <Text style={styles.description}>{shopHoursLabel(shop)}</Text>
              {shop.announcement ? <Text style={styles.description}>{shop.announcement}</Text> : null}
              <View style={styles.row}>
                {shop.phone ? <Pressable accessibilityRole="button" accessibilityLabel={`拨打 ${shop.name} 电话`} style={styles.smallButton}
                  onPress={() => void Linking.openURL(`tel:${shop.phone}`).catch(() => Alert.alert('请手动拨打门店电话', shop.phone!))}>
                  <Ionicons name="call-outline" size={20} color={colors.greenDeep} /><Text style={styles.actionText}>打电话</Text>
                </Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`进入 ${shop.name} 看菜`} accessibilityState={{ disabled: !!choosing || shop.status !== 'open' }}
                  disabled={!!choosing || shop.status !== 'open'} style={[styles.enter, (!!choosing || shop.status !== 'open') && styles.disabled]} onPress={() => void enter(shop)}>
                  <Text style={styles.enterText}>{choosing === shop.id ? '正在进店…' : shop.status === 'open' ? '进去看菜' : '休息中，暂不接单'}</Text>
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
  safe: { flex: 1, backgroundColor: colors.paper, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  location: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.greenSoft },
  locationText: { flex: 1, fontSize: fontSize.body, color: colors.greenDeep, lineHeight: 24 },
  input: { flex: 1, minHeight: tap.min, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, color: colors.ink, fontSize: fontSize.body },
  smallButton: { minHeight: tap.min, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.greenSoft, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: fontSize.body, fontWeight: '700', color: colors.greenDeep },
  scopeButton: { flex: 1, minHeight: tap.min, minWidth: 88, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  active: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  heading: { flex: 1, fontSize: fontSize.title, fontWeight: '700', color: colors.ink },
  description: { fontSize: fontSize.body, lineHeight: 24, color: colors.ink2 },
  empty: { paddingVertical: 32, gap: spacing.md, alignItems: 'center' },
  card: { backgroundColor: colors.card, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg },
  currentCard: { borderColor: colors.green },
  shopName: { flex: 1, fontSize: fontSize.title, fontWeight: '700', color: colors.ink },
  badge: { fontSize: fontSize.body, color: colors.greenDeep, backgroundColor: colors.greenSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  closed: { color: colors.ink2, backgroundColor: colors.paper },
  current: { fontSize: fontSize.body, color: colors.greenDeep, fontWeight: '700' },
  enter: { flex: 1, minHeight: tap.primary, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  enterText: { color: colors.white, fontSize: fontSize.name, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  footnote: { color: colors.ink2, fontSize: fontSize.body, lineHeight: 24 }
});

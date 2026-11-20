import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  ExpoGaodeMapModule,
  MapView,
  Marker,
  type MapViewRef
} from 'expo-gaode-map';
import type { ShopInfo, ShopLocation } from '../api';
import type { Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

interface Props {
  shops: ShopInfo[];
  location: ShopLocation | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onShowList: () => void;
}

type PrivacyState = 'checking' | 'required' | 'ready' | 'error';

const DEFAULT_CENTER = { longitude: 120.387585, latitude: 36.074702 };
const PRIVACY_VERSION = '2026-11-19';
const GAODE_PRIVACY_URL = 'https://lbs.amap.com/pages/privacy/';

/** 原生高德地图：门店数据与定位仍沿用现有接口，地图和标记不再经过 WebView。 */
function NativeShopMap({ shops, location, selectedId, onSelect, onShowList }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const mapRef = useRef<MapViewRef>(null);
  const [privacy, setPrivacy] = useState<PrivacyState>('checking');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedId),
    [shops, selectedId]
  );
  const initialCenter = selectedShop ?? location ?? shops[0] ?? DEFAULT_CENTER;

  useEffect(() => {
    setReady(false);
    setFailed(false);
    try {
      const status = ExpoGaodeMapModule.getPrivacyStatus();
      setPrivacy(status.isReady ? 'ready' : 'required');
    } catch {
      // Expo Go 或未重新打包时没有原生模块，展示明确的重打包提示
      setPrivacy('error');
    }
  }, [attempt]);

  useEffect(() => {
    if (privacy !== 'ready' || ready || failed) return;
    // 原生高德初始化失败（Key 鉴权失败等）时 onLoad 永远不会回调，
    // 5 秒内没有 ready 就降级到占位提示 + 门店列表，避免地图区域空白。
    const timer = setTimeout(() => setFailed(true), 5000);
    return () => clearTimeout(timer);
  }, [privacy, ready, failed, attempt]);

  useEffect(() => {
    if (!ready || failed) return;
    const map = mapRef.current;
    if (!map) return;

    if (selectedShop) {
      void map.moveCamera({
        target: { longitude: selectedShop.longitude, latitude: selectedShop.latitude },
        zoom: 16
      }, 250).catch(() => {});
      return;
    }

    const points = [
      ...shops.map((shop) => ({ longitude: shop.longitude, latitude: shop.latitude })),
      ...(location ? [{ longitude: location.longitude, latitude: location.latitude }] : [])
    ];
    if (points.length === 0) return;
    void map.fitToCoordinates(points, {
      paddingPx: 72,
      maxZoom: 15,
      singlePointZoom: 15
    }).catch(() => {});
  }, [ready, failed, selectedShop, shops, location]);

  function agreePrivacy() {
    try {
      ExpoGaodeMapModule.setPrivacyConfig({
        hasShow: true,
        hasContainsPrivacy: true,
        hasAgree: true,
        privacyVersion: PRIVACY_VERSION
      });
      setPrivacy('ready');
    } catch {
      setPrivacy('error');
    }
  }

  const showFailure = failed || privacy === 'error';

  return (
    <View style={styles.container}>
      <View style={styles.mapArea}>
        {privacy === 'ready' && !failed ? (
          <MapView
            key={attempt}
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialCameraPosition={{
              target: { longitude: initialCenter.longitude, latitude: initialCenter.latitude },
              zoom: 14
            }}
            compassEnabled
            scaleControlsEnabled
            zoomControlsEnabled={false}
            myLocationButtonEnabled={false}
            onLoad={() => setReady(true)}
          >
            {/* Marker 是原生子视图，会触发 ExpoGaodeMapView.addView；
                原生 aMap 未初始化时挂载标记会直接崩溃，必须等地图 onLoad 之后再渲染。 */}
            {ready ? (
              <>
                {location ? (
                  <Marker
                    position={{ longitude: location.longitude, latitude: location.latitude }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    title="当前位置"
                  >
                    <View style={styles.locationDot}>
                      <View style={styles.locationDotCenter} />
                    </View>
                  </Marker>
                ) : null}
                {shops.map((shop) => (
                  <Marker
                    key={shop.id}
                    position={{ longitude: shop.longitude, latitude: shop.latitude }}
                    title={shop.name}
                    snippet={shop.address ?? undefined}
                    pinColor={selectedId === shop.id ? 'green' : shop.status === 'open' ? 'red' : 'purple'}
                    onMarkerPress={() => onSelect(shop.id)}
                  />
                ))}
              </>
            ) : null}
          </MapView>
        ) : null}

        {privacy === 'checking' ? (
          <View style={styles.centerOverlay}>
            <Ionicons name="map-outline" size={42} color={colors.greenDeep} />
            <Text style={styles.loadingText}>正在准备地图…</Text>
          </View>
        ) : null}

        {privacy === 'required' ? (
          <View style={styles.privacyOverlay}>
            <Ionicons name="shield-checkmark-outline" size={44} color={colors.greenDeep} />
            <Text style={styles.privacyTitle}>使用高德地图</Text>
            <Text style={styles.privacyText}>
              地图用于展示附近门店和您的位置。首次使用前，请阅读并同意高德地图隐私政策；不同意也可以使用门店列表。
            </Text>
            <Pressable onPress={() => void Linking.openURL(GAODE_PRIVACY_URL)}>
              <Text style={styles.privacyLink}>查看高德地图隐私政策</Text>
            </Pressable>
            <Pressable style={styles.agreeButton} onPress={agreePrivacy}>
              <Text style={styles.retryText}>同意并使用地图</Text>
            </Pressable>
            <Pressable style={styles.privacyListButton} onPress={onShowList}>
              <Text style={styles.privacyListText}>暂不同意，使用列表</Text>
            </Pressable>
          </View>
        ) : null}

        {privacy === 'ready' && !ready && !failed ? (
          <View style={styles.centerOverlay}>
            <Ionicons name="map-outline" size={42} color={colors.greenDeep} />
            <Text style={styles.loadingText}>地图加载中…</Text>
          </View>
        ) : null}

        {showFailure ? (
          <View style={styles.centerOverlay}>
            <Ionicons name="map-outline" size={42} color={colors.ink3} />
            <Text style={styles.failedTitle}>原生地图加载失败</Text>
            <Text style={styles.failedText}>
              可能是网络、高德 Key 未绑定当前包名/签名，或模拟器不支持地图渲染。可先用下方门店列表，真机上再试。
            </Text>
            <Pressable style={styles.retryButton} onPress={() => setAttempt((value) => value + 1)}>
              <Text style={styles.retryText}>重新加载</Text>
            </Pressable>
            <Pressable style={styles.failedListButton} onPress={onShowList}>
              <Text style={styles.failedListText}>使用门店列表</Text>
            </Pressable>
          </View>
        ) : null}

        {!showFailure && privacy !== 'required' ? (
          <Pressable style={styles.listButton} onPress={onShowList}>
            <Ionicons name="list" size={18} color={colors.greenDeep} />
            <Text style={styles.listText}>门店列表</Text>
          </Pressable>
        ) : null}
      </View>

      {!showFailure && privacy === 'ready' ? (
        <>
          <View style={styles.countRow}>
            <Text style={styles.countText}>{shops.length} 家门店</Text>
          </View>
          {selectedShop ? (
            <View style={styles.selectedCard}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.shopName} numberOfLines={1}>{selectedShop.name}</Text>
                <Text style={styles.shopAddress} numberOfLines={1}>
                  {selectedShop.address ?? '暂无地址'}
                </Text>
              </View>
              <View style={styles.selectedTag}>
                <Text style={styles.selectedTagText}>当前门店</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * 高德 iOS SDK 没有 arm64 模拟器切片，模拟器包在 Pods 层移除了高德原生模块
 * （见 plugins/with-ios-gaode-simulator.js），这里按「原生模块是否存在」判定：
 * 只有 iOS 模拟器包拿不到 ExpoGaodeMap，真机 / Android 构建始终存在，行为与之前一致。
 */
const USE_WEB_MAP =
  Platform.OS === 'ios' && requireOptionalNativeModule('ExpoGaodeMap') == null;

// 按需加载：Android / iOS 真机不会执行到这里，避免把 react-native-webview 的依赖提前求值
let webMapComponent: ComponentType<Props> | null = null;
function getWebMapComponent() {
  if (!webMapComponent) {
    webMapComponent = (require('./ShopWebMap') as { default: ComponentType<Props> }).default;
  }
  return webMapComponent;
}

export default function ShopMap(props: Props) {
  if (USE_WEB_MAP) {
    const WebMap = getWebMapComponent();
    return (
      <WebMap
        shops={props.shops}
        location={props.location}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        onShowList={props.onShowList}
      />
    );
  }

  return <NativeShopMap {...props} />;
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
  // 地图放在 ScrollView 里，flex:1 没有父级高度可用会塌成 0，这里给固定高度保证原生视图有尺寸
  container: { height: 260, borderRadius: 12, overflow: 'hidden' },
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden' },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 20
  },
  loadingText: { marginTop: 12, fontSize: 14, color: colors.ink3 },
  failedTitle: { marginTop: 12, fontSize: 16, fontWeight: '600', color: colors.ink },
  failedText: { marginTop: 8, fontSize: 13, lineHeight: 20, color: colors.ink3, textAlign: 'center' },
  retryButton: {
    marginTop: 18,
    backgroundColor: colors.greenDeep,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 11
  },
  retryText: { fontSize: 14, color: colors.white, fontWeight: '600' },
  failedListButton: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 6 },
  failedListText: { fontSize: 14, color: colors.greenDeep, fontWeight: '600' },
  privacyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 30
  },
  privacyTitle: { marginTop: 14, fontSize: 20, fontWeight: '700', color: colors.ink },
  privacyText: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink3,
    textAlign: 'center'
  },
  privacyLink: { marginTop: 14, fontSize: 14, color: colors.greenDeep, textDecorationLine: 'underline' },
  agreeButton: {
    marginTop: 24,
    backgroundColor: colors.greenDeep,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12
  },
  privacyListButton: { marginTop: 16, padding: 6 },
  privacyListText: { fontSize: 14, color: colors.ink3 },
  listButton: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 10
  },
  listText: { fontSize: 14, color: colors.greenDeep, fontWeight: '600' },
  countRow: {
    position: 'absolute',
    left: 14,
    top: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    elevation: 2,
    zIndex: 10
  },
  countText: { fontSize: 13, color: colors.ink2, fontWeight: '500' },
  selectedCard: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    left: 140,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 10
  },
  shopName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  shopAddress: { fontSize: 12, color: colors.ink3, marginTop: 3 },
  selectedTag: { backgroundColor: colors.greenSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  selectedTagText: { fontSize: 11, color: colors.greenDeep, fontWeight: '600' },
  locationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  locationDotCenter: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.greenDeep,
    borderWidth: 2,
    borderColor: colors.card
  }
});

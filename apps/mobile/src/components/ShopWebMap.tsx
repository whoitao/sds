import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
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

const DEFAULT_CENTER = { longitude: 120.387585, latitude: 36.074702 };

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * 高德 iOS SDK 只有 x86_64 + device arm64 切片，arm64 模拟器无法链接，
 * 所以模拟器包在 Pods 层移除了高德原生模块，这里用 WebView + Leaflet + 高德栅格瓦片渲染门店。
 * 瓦片与门店坐标同为 GCJ-02，点位不会像换用其他地图那样整体偏移。
 * 输入与原生分支一致：门店列表、当前定位、选中门店、点击回调。
 */
function buildHtml(shops: ShopInfo[], location: ShopLocation | null) {
  const payload = shops.map((shop) => ({
    id: shop.id,
    name: shop.name,
    address: shop.address,
    status: shop.status,
    longitude: shop.longitude,
    latitude: shop.latitude
  }));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #eef1f3; }
  .sds-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
  .sds-dot-me { width: 14px; height: 14px; border-radius: 50%; background: #2f6b45; border: 2px solid #fff; box-shadow: 0 0 0 4px rgba(47,107,69,.22); }
  .leaflet-control-attribution { font-size: 10px; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var shops = ${safeJson(payload)};
  var me = ${safeJson(location ? { longitude: location.longitude, latitude: location.latitude } : null)};
  var map = L.map('map', { zoomControl: false }).setView([${DEFAULT_CENTER.latitude}, ${DEFAULT_CENTER.longitude}], 13);

  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 18,
    attribution: '&copy; 高德地图'
  }).addTo(map);

  function dotIcon(shop, activeId) {
    var color = shop.id === activeId ? '#2f6b45' : (shop.status === 'open' ? '#e03131' : '#7b2d8e');
    return L.divIcon({
      className: '',
      html: '<div class="sds-dot" style="background:' + color + '"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  }

  var markers = {};
  shops.forEach(function (shop) {
    var marker = L.marker([shop.latitude, shop.longitude], { icon: dotIcon(shop, null) }).addTo(map);
    marker.bindTooltip(shop.name, { direction: 'top', offset: [0, -10] });
    marker.on('click', function () {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', id: shop.id }));
      }
    });
    markers[shop.id] = marker;
  });

  if (me) {
    L.marker([me.latitude, me.longitude], {
      icon: L.divIcon({ className: '', html: '<div class="sds-dot-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false
    }).addTo(map);
  }

  var points = shops.map(function (s) { return [s.latitude, s.longitude]; });
  if (me) { points.push([me.latitude, me.longitude]); }
  if (points.length > 1) {
    map.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
  } else if (points.length === 1) {
    map.setView(points[0], 15);
  }

  window.__sdsSelect = function (id) {
    shops.forEach(function (shop) {
      var marker = markers[shop.id];
      if (!marker) { return; }
      marker.setIcon(dotIcon(shop, id));
      if (shop.id === id) { map.panTo(marker.getLatLng()); }
    });
  };
</script>
</body>
</html>`;
}

// react-native-webview 14 的 d.ts 只声明了 FunctionComponent，没有导出 ref 实例类型
type WebViewHandle = { injectJavaScript: (script: string) => void };

export default function ShopWebMap({ shops, location, selectedId, onSelect, onShowList }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const webRef = useRef<WebViewHandle | null>(null);
  const html = useMemo(() => buildHtml(shops, location), [shops, location]);

  useEffect(() => {
    if (!selectedId) return;
    webRef.current?.injectJavaScript(`window.__sdsSelect && window.__sdsSelect(${safeJson(selectedId)}); true;`);
  }, [selectedId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef as never}
        source={{ html }}
        style={styles.web}
        originWhitelist={['*']}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
            if (data.type === 'select' && data.id) onSelect(data.id);
          } catch {
            // 非本组件发送的消息，忽略
          }
        }}
      />

      <View style={styles.badge}>
        <Text style={styles.badgeText}>{shops.length} 家门店</Text>
      </View>

      <Pressable style={styles.listButton} onPress={onShowList}>
        <Ionicons name="list" size={18} color={colors.greenDeep} />
        <Text style={styles.listText}>门店列表</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
  // 与原生分支保持一致：固定 260 高 + 圆角，保证 ScrollView 里的 WebView 有尺寸
  container: { height: 260, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  web: { flex: 1, backgroundColor: colors.cardSoft },
  badge: {
    position: 'absolute',
    left: 14,
    top: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16
  },
  badgeText: { fontSize: 13, color: colors.ink2, fontWeight: '500' },
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
    borderRadius: 22
  },
  listText: { fontSize: 14, color: colors.greenDeep, fontWeight: '600' }
});

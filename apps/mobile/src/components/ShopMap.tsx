import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { API_BASE_URL, type ShopInfo, type ShopLocation } from '../api';
import { colors, fontSize, radius, spacing, tap } from '../theme';

const mapUrl = `${API_BASE_URL}/api/mobile/shops/map`;

export default function ShopMap({ shops, location, selectedId, onSelect, onShowList }: {
  shops: ShopInfo[];
  location: ShopLocation | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShowList: () => void;
}) {
  const web = useRef<WebView<object>>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setFailed(true), 20000);
    if (ready) clearTimeout(timer);
    return () => clearTimeout(timer);
  }, [ready, attempt]);

  useEffect(() => {
    if (!ready) return;
    const data = JSON.stringify({
      shops: shops.map(({ id, name, latitude, longitude, status }) => ({ id, name, latitude, longitude, status })),
      location,
      selectedId
    }).replace(/</g, '\\u003c');
    web.current?.injectJavaScript(`window.renderShops(${data}); true;`);
  }, [ready, shops, location, selectedId]);

  return (
    <View style={styles.map}>
      <WebView<object>
        key={attempt}
        ref={web}
        source={{ uri: mapUrl }}
        style={styles.web}
        originWhitelist={[API_BASE_URL]}
        onShouldStartLoadWithRequest={({ url }) => url === mapUrl || url === 'about:blank'}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        geolocationEnabled={false}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        onMessage={({ nativeEvent }) => {
          let data: { type?: string; id?: string };
          try { data = JSON.parse(nativeEvent.data); } catch { return; }
          if (!data || typeof data !== 'object') return;
          if (data.type === 'ready') setReady(true);
          if (data.type === 'error') setFailed(true);
          if (data.type === 'select' && shops.some(shop => shop.id === data.id)) onSelect(data.id!);
        }}
      />
      {!ready && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.green} />
          <Text style={styles.text}>正在打开地图…</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.overlay}>
          <Text style={styles.text}>地图暂时打不开，列表仍可找店</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.button} onPress={onShowList}>
              <Text style={styles.actionText}>用列表找店</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
              setReady(false);
              setFailed(false);
              setAttempt(value => value + 1);
            }}>
              <Text style={styles.actionText}>重试地图</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  web: { flex: 1, backgroundColor: colors.paper },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  text: { fontSize: fontSize.body, color: colors.ink2, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md },
  button: { minHeight: tap.min, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenSoft, borderRadius: radius.md },
  actionText: { fontSize: fontSize.body, fontWeight: '700', color: colors.greenDeep }
});

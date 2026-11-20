import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontSize, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

type TabKey = 'home' | 'cart' | 'orders' | 'profile';

/** 图标与文字比正文小一档；tab 本身仍保底 tap.min，点按区域不变 */
const TAB_ICON_SIZE = 20;

/**
 * 底部导航：只在一级页出现（首页 / 购物车 / 订单 / 我的）。
 * 角标沿用设计稿的中性描边样式，不用红色营销角标。
 */
export default function TabBar({
  active,
  cartCount = 0,
  onHome,
  onCart,
  onOrders,
  onProfile
}: {
  active: TabKey;
  cartCount?: number;
  onHome: () => void;
  onCart: () => void;
  onOrders: () => void;
  onProfile: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // iOS 手势条、安卓手势/三键导航都由 insets.bottom 给出，底部再多留 6px 呼吸空间
  const insets = useSafeAreaInsets();
  const tabs: {
    key: TabKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconActive: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = [
    { key: 'home', label: '首页', icon: 'home-outline', iconActive: 'home', onPress: onHome },
    { key: 'cart', label: '购物车', icon: 'cart-outline', iconActive: 'cart', onPress: onCart },
    { key: 'orders', label: '订单', icon: 'receipt-outline', iconActive: 'receipt', onPress: onOrders },
    { key: 'profile', label: '我的', icon: 'person-outline', iconActive: 'person', onPress: onProfile }
  ];

  return (
    <View style={[styles.tabbar, { paddingBottom: Math.max(10, insets.bottom + 6) }]}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={selected ? `${tab.label}，当前页` : tab.label}
            accessibilityState={{ selected }}
            style={styles.tab}
            onPress={tab.onPress}
          >
            <View style={styles.iconWrap}>
              <Ionicons
                name={selected ? tab.iconActive : tab.icon}
                size={TAB_ICON_SIZE}
                color={selected ? colors.greenDeep : colors.ink2}
              />
              {tab.key === 'cart' && cartCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, selected ? styles.labelActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    tabbar: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: 7,
      paddingBottom: 10
    },
    tab: {
      flex: 1,
      minHeight: tap.min,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2
    },
    iconWrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center'
    },
    badge: {
      position: 'absolute',
      top: -5,
      right: -16,
      minWidth: 20,
      height: 20,
      paddingHorizontal: 3,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.green,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center'
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16,
      color: colors.greenDeep
    },
    label: {
      fontSize: fontSize.mini,
      lineHeight: 18,
      fontWeight: '600',
      color: colors.ink2
    },
    labelActive: {
      color: colors.greenDeep,
      fontWeight: '700'
    }
  });

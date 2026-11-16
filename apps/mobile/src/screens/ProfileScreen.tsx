import type { ComponentProps } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CustomerProfile } from '../api';
import { cardShadow, colors, fontSize, radius, spacing, tap } from '../theme';
import ScreenHeader from '../components/ScreenHeader';
import TabBar from '../components/TabBar';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function displayName(customer: CustomerProfile) {
  const nickname = customer.nickname?.trim();
  if (nickname) return nickname;
  return `尾号 ${customer.phone.slice(-4)} 的顾客`;
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

/** 菜单行：pending 为 true 时标「待接入」，已接通的入口不显示该标签 */
function MenuRow({
  icon,
  label,
  hint,
  onPress,
  pending = true
}: {
  icon: IoniconName;
  label: string;
  hint: string;
  onPress: () => void;
  pending?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pending ? `${label}，待接入` : label}
      style={styles.row}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={colors.greenDeep} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowHint} numberOfLines={1}>
        {hint}
      </Text>
      {pending ? (
        <View style={styles.pendingTag}>
          <Text style={styles.pendingTagText}>待接入</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
    </Pressable>
  );
}

export default function ProfileScreen({
  customer,
  onLogout,
  onGoHome,
  onOpenCart,
  onOpenAddresses,
  onOpenOrders
}: {
  customer: CustomerProfile;
  onLogout: () => void;
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenAddresses: () => void;
  onOpenOrders: () => void;
}) {
  const name = displayName(customer);

  function confirmLogout() {
    Alert.alert('退出登录', '退出后需要重新用手机号登录，确定退出吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定退出', style: 'destructive', onPress: onLogout }
    ]);
  }

  function comingSoon(label: string) {
    Alert.alert(label, '这个功能还在准备中，下次更新就能用。');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <ScreenHeader
        left="bell"
        onLeftPress={() => Alert.alert('暂无新消息', '订单进度和优惠会显示在这里。')}
        title="我的"
        onHelpPress={() => comingSoon('联系客服')}
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.profilePhone}>{maskPhone(customer.phone)}</Text>
          </View>
          <View style={styles.loginTag}>
            <Text style={styles.loginTagText}>已登录</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>我的信息</Text>
          <MenuRow
            icon="location-outline"
            label="收货地址"
            hint="管理收货地址"
            pending={false}
            onPress={onOpenAddresses}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="people-outline"
            label="家人代付"
            hint="还没有绑定"
            onPress={() => comingSoon('家人代付')}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>帮助</Text>
          <MenuRow
            icon="headset-outline"
            label="联系客服"
            hint="工作日 8:00–20:00"
            onPress={() => comingSoon('联系客服')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="document-text-outline"
            label="下单说明"
            hint="怎么买菜、怎么取菜"
            onPress={() => comingSoon('下单说明')}
          />
        </View>

        <View style={styles.tip}>
          <Ionicons name="heart-outline" size={20} color={colors.blueInk} />
          <Text style={styles.tipText}>不会操作？可以让家人帮忙，或到店里找店员。</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="退出登录"
          style={styles.logoutButton}
          onPress={confirmLogout}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </ScrollView>

      <TabBar
        active="profile"
        onHome={onGoHome}
        onCart={onOpenCart}
        onOrders={onOpenOrders}
        onProfile={() => undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
  },
  body: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.md
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...cardShadow
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.greenDeep
  },
  profileText: {
    flex: 1,
    gap: 2
  },
  profileName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink
  },
  profilePhone: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  loginTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.greenSoft
  },
  loginTagText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.greenDeep
  },
  section: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...cardShadow
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.ink2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs
  },
  rowLabel: {
    fontSize: fontSize.name,
    fontWeight: '600',
    color: colors.ink
  },
  rowHint: {
    flex: 1,
    textAlign: 'right',
    fontSize: fontSize.body,
    color: colors.ink3
  },
  pendingTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.amberSoft
  },
  pendingTagText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.amber
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginLeft: 30
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
  logoutButton: {
    minHeight: tap.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E7C9C6',
    backgroundColor: colors.card,
    ...cardShadow
  },
  logoutText: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.danger
  }
});

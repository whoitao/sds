import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, radius, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

/**
 * 全站统一顶栏（对应设计稿 v0.5 header）：
 * 左侧返回 / 铃铛，中间门店药丸或页面标题，右侧「帮助」。
 * 结算流程里门店药丸锁死（灰底、无下拉箭头），避免改变正在结算的门店。
 */
export default function ScreenHeader({
  left = 'none',
  onLeftPress,
  title,
  shopName,
  shopLocked = false,
  onShopPress,
  onHelpPress,
  helpLabel = '需要帮忙？',
  right
}: {
  left?: 'back' | 'bell' | 'none';
  onLeftPress?: () => void;
  title?: string;
  shopName?: string;
  shopLocked?: boolean;
  onShopPress?: () => void;
  onHelpPress?: () => void;
  helpLabel?: string;
  right?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.header}>
      {left === 'back' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={styles.roundButton}
          onPress={onLeftPress}
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
      ) : left === 'bell' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="消息"
          style={styles.roundButton}
          onPress={onLeftPress}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.ink2} />
        </Pressable>
      ) : (
        <View style={styles.roundPlaceholder} />
      )}

      <View style={styles.center}>
        {shopName ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              shopLocked ? `当前门店 ${shopName}，结算中不可换店` : `当前门店 ${shopName}，点击换店`
            }
            accessibilityState={{ disabled: shopLocked }}
            disabled={shopLocked}
            style={[styles.shopPill, shopLocked ? styles.shopPillLocked : null]}
            onPress={onShopPress}
          >
            <Ionicons
              name="storefront-outline"
              size={18}
              color={shopLocked ? colors.ink2 : colors.greenDeep}
            />
            <Text
              style={[styles.shopName, shopLocked ? styles.shopNameLocked : null]}
              numberOfLines={1}
            >
              {shopName}
            </Text>
            {shopLocked ? null : (
              <Ionicons name="chevron-down" size={18} color={colors.greenDeep} />
            )}
          </Pressable>
        ) : (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>

      {right ?? (onHelpPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={helpLabel}
          style={styles.helpRound}
          onPress={onHelpPress}
        >
          <Ionicons name="help-circle-outline" size={22} color={colors.greenDeep} />
        </Pressable>
      ) : (
        <View style={styles.roundPlaceholder} />
      ))}
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10
  },
  /** 图标按钮只保留点击热区与图标本身，不再套圆底/描边/投影 */
  roundButton: {
    width: tap.min,
    height: tap.min,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roundPlaceholder: {
    width: tap.min,
    height: tap.min
  },
  center: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center'
  },
  shopPill: {
    maxWidth: '100%',
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: tap.min / 2,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green
  },
  shopPillLocked: {
    backgroundColor: colors.cardSoft,
    borderColor: colors.line
  },
  shopName: {
    flexShrink: 1,
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.greenDeep
  },
  shopNameLocked: {
    color: colors.ink2
  },
  title: {
    maxWidth: '100%',
    textAlign: 'center',
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.2
  },
  helpRound: {
    width: tap.min,
    height: tap.min,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

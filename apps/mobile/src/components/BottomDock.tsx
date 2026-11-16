import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing, tap } from '../theme';

/**
 * 底部结算条：左侧一句话 + 合计金额，右侧深绿主按钮。
 * 金额永远用正文色显示，避免把价格做成促销红旗。
 */
export default function BottomDock({
  label,
  total,
  actionLabel,
  onAction,
  disabled = false,
  loading = false
}: {
  label: string;
  total?: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.dock}>
      <View style={styles.info}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {total ? <Text style={styles.total}>¥{total}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: disabled || loading }}
        disabled={disabled || loading}
        style={[styles.action, disabled || loading ? styles.actionDisabled : null]}
        onPress={onAction}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.actionText}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  label: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  total: {
    fontSize: fontSize.title + 2,
    fontWeight: '700',
    color: colors.ink
  },
  action: {
    flexShrink: 0,
    minHeight: tap.primary,
    minWidth: 130,
    paddingHorizontal: 22,
    borderRadius: radius.md,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionDisabled: {
    opacity: 0.45
  },
  actionText: {
    fontSize: fontSize.title,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.white
  }
});

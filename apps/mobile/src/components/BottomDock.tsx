import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fontSize, spacing, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

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

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
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
    // 高度/内边距/字号各收一档，仍保持胶囊且热区 48 ≥ 44
    minHeight: tap.min,
    minWidth: 112,
    paddingHorizontal: spacing.lg,
    borderRadius: tap.min / 2,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionDisabled: {
    opacity: 0.45
  },
  actionText: {
    fontSize: fontSize.name,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.white
  }
});

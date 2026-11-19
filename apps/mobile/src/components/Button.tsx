import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, tap } from '../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function ButtonBase({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  tone,
  compact = false
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone: 'primary' | 'ghost' | 'soft' | 'danger';
  compact?: boolean;
}) {
  const toneStyle =
    tone === 'primary'
      ? styles.primary
      : tone === 'soft'
        ? styles.soft
        : tone === 'danger'
          ? styles.danger
          : styles.ghost;
  const textStyle =
    tone === 'primary'
      ? styles.textPrimary
      : tone === 'danger'
        ? styles.textDanger
        : styles.textGreen;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      style={[
        styles.base,
        compact ? styles.compact : null,
        toneStyle,
        disabled || loading ? styles.disabled : null
      ]}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={tone === 'primary' ? colors.white : colors.greenDeep} />
      ) : (
        <View style={styles.content}>
          {icon ? (
            <Ionicons
              name={icon}
              size={22}
              color={tone === 'primary' ? colors.white : tone === 'danger' ? colors.danger : colors.greenDeep}
            />
          ) : null}
          <Text style={[styles.text, textStyle]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props: Omit<ComponentProps<typeof ButtonBase>, 'tone'>) {
  return <ButtonBase {...props} tone="primary" />;
}

export function GhostButton(props: Omit<ComponentProps<typeof ButtonBase>, 'tone'>) {
  return <ButtonBase {...props} tone="ghost" />;
}

export function SoftButton(props: Omit<ComponentProps<typeof ButtonBase>, 'tone'>) {
  return <ButtonBase {...props} tone="soft" />;
}

export function DangerButton(props: Omit<ComponentProps<typeof ButtonBase>, 'tone'>) {
  return <ButtonBase {...props} tone="danger" />;
}

const styles = StyleSheet.create({
  base: {
    minHeight: tap.primary,
    borderRadius: tap.primary / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  compact: {
    minHeight: tap.min
  },
  primary: {
    backgroundColor: colors.greenDeep
  },
  ghost: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: '#BFE0CB'
  },
  soft: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: '#BFE0CB'
  },
  danger: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: '#E7C9C6'
  },
  disabled: {
    opacity: 0.5
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  text: {
    fontSize: fontSize.title,
    fontWeight: '700'
  },
  textPrimary: {
    color: colors.white
  },
  textGreen: {
    color: colors.greenDeep
  },
  textDanger: {
    color: colors.danger
  }
});

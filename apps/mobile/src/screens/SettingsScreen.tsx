import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../components/ScreenHeader';
import { fontSize, radius, spacing, type Theme } from '../theme';
import { useTheme, useThemedStyles, type ThemePreference } from '../theme-context';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const OPTIONS: { key: ThemePreference; icon: IoniconName; label: string; hint: string }[] = [
  { key: 'light', icon: 'sunny-outline', label: '浅色', hint: '始终使用浅色界面' },
  { key: 'dark', icon: 'moon-outline', label: '深色', hint: '始终使用深色界面' },
  { key: 'system', icon: 'phone-portrait-outline', label: '跟随系统', hint: '随手机外观自动切换' }
];

/** 设置页：目前只有主题一项，浅色 / 深色 / 跟随系统 */
export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { theme, preference, systemScheme, setPreference } = useTheme();

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <ScreenHeader left="back" title="设置" onLeftPress={onBack} />

      <ScrollView style={styles.body} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>主题</Text>
          {OPTIONS.map((option, index) => {
            const selected = preference === option.key;
            return (
              <View key={option.key}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={styles.row}
                  onPress={() => setPreference(option.key)}
                >
                  <Ionicons
                    name={option.icon}
                    size={22}
                    color={selected ? theme.colors.greenDeep : theme.colors.ink2}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, selected ? styles.rowLabelActive : null]}>
                      {option.label}
                    </Text>
                    <Text style={styles.rowHint}>
                      {option.hint}
                      {option.key === 'system'
                        ? `（手机当前为${systemScheme === 'dark' ? '深色' : '浅色'}）`
                        : ''}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={24} color={theme.colors.green} />
                  ) : (
                    <View style={styles.checkPlaceholder} />
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>

        <Text style={styles.note}>切换后立即生效，重启 App 后仍会保留你的选择。</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.paper
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
    section: {
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...shadow
    },
    sectionTitle: {
      fontSize: fontSize.body,
      fontWeight: '700',
      color: colors.ink2,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs
    },
    row: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xs
    },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    rowLabel: {
      fontSize: fontSize.name,
      fontWeight: '600',
      color: colors.ink
    },
    rowLabelActive: {
      color: colors.greenDeep,
      fontWeight: '700'
    },
    rowHint: {
      fontSize: fontSize.body,
      color: colors.ink3
    },
    checkPlaceholder: {
      width: 24,
      height: 24
    },
    divider: {
      height: 1,
      backgroundColor: colors.line,
      marginLeft: 30
    },
    note: {
      paddingHorizontal: spacing.xs,
      fontSize: fontSize.body,
      lineHeight: 24,
      color: colors.ink3
    }
  });

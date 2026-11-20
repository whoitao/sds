import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getCities,
  getDistricts,
  getProvinces,
  nextRegionStep,
  selectCity,
  selectDistrict,
  selectProvince,
  type RegionIndex,
  type RegionNode,
  type RegionStep,
  type RegionValue
} from '@sds/shared';
import { fontSize, radius, spacing, tap, type Theme } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

const STEP_LABEL: Record<RegionStep, string> = {
  province: '选择省份',
  city: '选择城市',
  district: '选择区县',
  done: '选择区县'
};

/**
 * 省/市/县三级联动选择器（RN 渲染层）。
 * 数据来自 /api/regions，联动逻辑来自 @sds/shared，这里只负责交互与样式。
 */
export default function RegionPicker({
  visible,
  index,
  value,
  onClose,
  onChange
}: {
  visible: boolean;
  index: RegionIndex;
  value: RegionValue;
  onClose: () => void;
  onChange: (next: RegionValue) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [step, setStep] = useState<RegionStep>('province');

  useEffect(() => {
    if (visible) setStep(nextRegionStep(value));
  }, [visible, value]);

  const options =
    step === 'province'
      ? getProvinces(index)
      : step === 'city'
        ? getCities(index, value.provinceCode)
        : getDistricts(index, value.cityCode);

  function choose(node: RegionNode) {
    if (step === 'province') {
      const next = selectProvince(node);
      // 直辖市的「市辖区」这类占位层级只有一层，直接进区县，少点一次
      const cities = getCities(index, node.code);
      if (cities.length <= 1) {
        const withCity = cities[0] ? selectCity(next, cities[0]) : next;
        onChange(withCity);
        setStep('district');
        return;
      }
      onChange(next);
      setStep('city');
      return;
    }
    if (step === 'city') {
      onChange(selectCity(value, node));
      setStep('district');
      return;
    }
    onChange(selectDistrict(value, node));
    onClose();
  }

  const selectedCode =
    step === 'province'
      ? value.provinceCode
      : step === 'city'
        ? value.cityCode
        : value.districtCode;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭选择"
          style={styles.backdropHit}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{STEP_LABEL[step]}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              style={styles.closeButton}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.ink2} />
            </Pressable>
          </View>

          <View style={styles.crumbs}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新选择省份"
              style={styles.crumb}
              onPress={() => setStep('province')}
            >
              <Text style={[styles.crumbText, step === 'province' && styles.crumbActive]}>
                {value.provinceName ?? '请选择省'}
              </Text>
            </Pressable>
            <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新选择城市"
              style={[styles.crumb, !value.provinceCode && styles.crumbDisabled]}
              disabled={!value.provinceCode}
              onPress={() => setStep('city')}
            >
              <Text style={[styles.crumbText, step === 'city' && styles.crumbActive]}>
                {value.cityName ?? '请选择市'}
              </Text>
            </Pressable>
            <Ionicons name="chevron-forward" size={16} color={colors.ink3} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新选择区县"
              style={[styles.crumb, !value.cityCode && styles.crumbDisabled]}
              disabled={!value.cityCode}
              onPress={() => setStep('district')}
            >
              <Text style={[styles.crumbText, step === 'district' && styles.crumbActive]}>
                {value.districtName ?? '请选择区县'}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {options.map((node) => {
              const active = selectedCode === node.code;
              return (
                <Pressable
                  key={node.code}
                  accessibilityRole="button"
                  accessibilityLabel={node.name}
                  accessibilityState={{ selected: active }}
                  style={styles.option}
                  onPress={() => choose(node)}
                >
                  <Text style={[styles.optionText, active && styles.optionActive]}>{node.name}</Text>
                  {active ? <Ionicons name="checkmark" size={20} color={colors.green} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.backdrop
  },
  backdropHit: {
    flex: 1
  },
  sheet: {
    maxHeight: '72%',
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.md
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md
  },
  title: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  closeButton: {
    width: tap.min,
    height: tap.min,
    alignItems: 'center',
    justifyContent: 'center'
  },
  crumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  crumb: {
    minHeight: tap.min,
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  crumbDisabled: {
    opacity: 0.5
  },
  crumbText: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  crumbActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  },
  list: {
    flexGrow: 0
  },
  listContent: {
    paddingVertical: spacing.xs
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  optionText: {
    fontSize: fontSize.name,
    color: colors.ink
  },
  optionActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  }
});

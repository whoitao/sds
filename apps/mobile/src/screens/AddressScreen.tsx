import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  buildRegionSelection,
  emptyRegion,
  formatRegion,
  isRegionComplete,
  type RegionValue
} from '@sds/shared';
import {
  createAddress,
  deleteAddress,
  fetchAddresses,
  setDefaultAddress,
  updateAddress,
  type AddressItem
} from '../api';
import { useRegions } from '../regions';
import RegionPicker from '../components/RegionPicker';
import ScreenHeader from '../components/ScreenHeader';
import { PrimaryButton } from '../components/Button';
import { cardShadow, colors, fontSize, radius, spacing, tap } from '../theme';

type Editing = { mode: 'create' } | { mode: 'edit'; address: AddressItem } | null;

function formatPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

/** 列表展示：省市区 + 详细地址，去掉「市辖区」这类占位名 */
function fullAddress(address: AddressItem) {
  const region = formatRegion(
    {
      provinceCode: address.provinceCode,
      provinceName: address.province,
      cityCode: address.cityCode,
      cityName: address.city,
      districtCode: address.districtCode,
      districtName: address.district
    },
    ''
  );
  return `${region}${address.detail}`;
}

export default function AddressScreen({
  token,
  onBack
}: {
  token: string;
  onBack: () => void;
}) {
  const [items, setItems] = useState<AddressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [detail, setDetail] = useState('');
  const [remark, setRemark] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [formError, setFormError] = useState('');
  const [region, setRegion] = useState<RegionValue>(emptyRegion);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { index: regionIndex, loading: regionLoading, error: regionError, reload: reloadRegions } =
    useRegions();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await fetchAddresses(token);
      setItems(payload.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing({ mode: 'create' });
    setContactName('');
    setContactPhone('');
    setDetail('');
    setRemark('');
    setMakeDefault(items.length === 0);
    setFormError('');
    setRegion(emptyRegion());
  }

  function openEdit(address: AddressItem) {
    setEditing({ mode: 'edit', address });
    setContactName(address.contactName);
    setContactPhone(address.contactPhone);
    setDetail(address.detail);
    setRemark(address.remark ?? '');
    setMakeDefault(address.isDefault);
    setFormError('');
    setRegion(
      regionIndex
        ? buildRegionSelection(regionIndex, address)
        : {
            provinceCode: address.provinceCode,
            provinceName: address.province,
            cityCode: address.cityCode,
            cityName: address.city,
            districtCode: address.districtCode,
            districtName: address.district
          }
    );
  }

  // 区划字典可能晚于表单打开：解码到达后按已存编码重新回显
  useEffect(() => {
    if (!regionIndex || !editing || editing.mode !== 'edit') return;
    setRegion(buildRegionSelection(regionIndex, editing.address));
  }, [regionIndex, editing]);

  async function save() {
    if (!editing || busy) return;
    const name = contactName.trim();
    const phone = contactPhone.trim();
    const addressDetail = detail.trim();
    if (!name) return setFormError('请填写联系人');
    if (!/^1[3-9]\d{9}$/.test(phone)) return setFormError('请填写 11 位手机号');
    if (!isRegionComplete(region)) return setFormError('请选择省 / 市 / 县');
    if (addressDetail.length < 5) return setFormError('请填写详细地址（至少 5 个字）');

    setBusy(true);
    setFormError('');
    try {
      const input = {
        contactName: name,
        contactPhone: phone,
        provinceCode: region.provinceCode as string,
        cityCode: region.cityCode as string,
        districtCode: region.districtCode as string,
        detail: addressDetail,
        remark: remark.trim() || null,
        isDefault: makeDefault
      };
      if (editing.mode === 'create') {
        await createAddress(token, input);
      } else {
        await updateAddress(token, editing.address.id, input);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function makeThisDefault(address: AddressItem) {
    if (busy || address.isDefault) return;
    setBusy(true);
    try {
      const payload = await setDefaultAddress(token, address.id);
      setItems(payload.items);
    } catch (err) {
      Alert.alert('设置失败', err instanceof Error ? err.message : '请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(address: AddressItem) {
    Alert.alert('删除地址', `确定删除「${address.detail}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const payload = await deleteAddress(token, address.id);
              setItems(payload.items);
            } catch (err) {
              Alert.alert('删除失败', err instanceof Error ? err.message : '请稍后再试');
            } finally {
              setBusy(false);
            }
          })();
        }
      }
    ]);
  }

  if (editing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScreenHeader
          left="back"
          onLeftPress={() => setEditing(null)}
          title={editing.mode === 'create' ? '新增地址' : '编辑地址'}
          onHelpPress={() =>
            Alert.alert('需要帮忙？', '可以到店里找店员，或者让家人帮忙填写。')
          }
        />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>联系人</Text>
            <TextInput
              style={styles.input}
              value={contactName}
              onChangeText={setContactName}
              placeholder="例如：张桂英"
              placeholderTextColor={colors.ink3}
              maxLength={50}
            />

            <Text style={styles.label}>手机号</Text>
            <TextInput
              style={styles.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="11 位手机号"
              placeholderTextColor={colors.ink3}
              keyboardType="number-pad"
              maxLength={11}
            />

            <Text style={styles.label}>省 / 市 / 县</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="选择省、市、县"
              style={[styles.input, styles.regionRow, !regionIndex && styles.regionRowDisabled]}
              disabled={regionLoading}
              onPress={() => (regionIndex ? setPickerOpen(true) : reloadRegions())}
            >
              <Text
                style={[styles.regionText, !isRegionComplete(region) && styles.regionPlaceholder]}
                numberOfLines={1}
              >
                {isRegionComplete(region)
                  ? formatRegion(region, ' ')
                  : regionLoading
                    ? '正在加载地区…'
                    : regionError
                      ? '地区加载失败，点此重试'
                      : '请选择省 / 市 / 县'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.ink3} />
            </Pressable>

            <Text style={styles.label}>详细地址</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={detail}
              onChangeText={setDetail}
              placeholder="例如：阳光小区 3 号楼 1 单元 101"
              placeholderTextColor={colors.ink3}
              multiline
              maxLength={200}
            />

            <Text style={styles.label}>备注（选填）</Text>
            <TextInput
              style={styles.input}
              value={remark}
              onChangeText={setRemark}
              placeholder="例如：上午在家，下午去活动室"
              placeholderTextColor={colors.ink3}
              maxLength={500}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>设为默认地址</Text>
              <Switch
                value={makeDefault}
                onValueChange={setMakeDefault}
                trackColor={{ false: colors.line, true: colors.green }}
              />
            </View>

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <View style={styles.saveButton}>
              <PrimaryButton label="保存" loading={busy} onPress={() => void save()} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {regionIndex ? (
          <RegionPicker
            visible={pickerOpen}
            index={regionIndex}
            value={region}
            onClose={() => setPickerOpen(false)}
            onChange={setRegion}
          />
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader
        left="back"
        onLeftPress={onBack}
        title="收货地址"
        onHelpPress={() =>
          Alert.alert('需要帮忙？', '地址只用填一次，以后下单直接选，不用再打字。')
        }
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.green} size="large" />
            <Text style={styles.centerHint}>正在加载地址…</Text>
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Text style={styles.centerHint}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新加载"
              style={styles.secondaryButton}
              onPress={() => void load()}
            >
              <Text style={styles.secondaryButtonText}>重新加载</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="location-outline" size={40} color={colors.ink3} />
            <Text style={styles.emptyTitle}>还没有收货地址</Text>
            <Text style={styles.centerHint}>加了地址，送货上门时就不用每次重填。</Text>
          </View>
        ) : (
          items.map((address) => (
            <View key={address.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.contact}>{address.contactName}</Text>
                <Text style={styles.phone}>{formatPhone(address.contactPhone)}</Text>
                {address.isDefault ? (
                  <View style={styles.defaultTag}>
                    <Text style={styles.defaultTagText}>默认</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.detail}>{fullAddress(address)}</Text>
              {address.remark ? <Text style={styles.remark}>备注：{address.remark}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`编辑 ${address.detail}`}
                  style={styles.actionButton}
                  onPress={() => openEdit(address)}
                >
                  <Ionicons name="create-outline" size={20} color={colors.greenDeep} />
                  <Text style={styles.actionText}>编辑</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`设为默认 ${address.detail}`}
                  style={[styles.actionButton, address.isDefault && styles.actionDisabled]}
                  disabled={address.isDefault || busy}
                  onPress={() => void makeThisDefault(address)}
                >
                  <Ionicons
                    name={address.isDefault ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={20}
                    color={address.isDefault ? colors.ink3 : colors.greenDeep}
                  />
                  <Text style={[styles.actionText, address.isDefault && styles.actionTextMuted]}>
                    {address.isDefault ? '已是默认' : '设为默认'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除 ${address.detail}`}
                  style={styles.actionButton}
                  disabled={busy}
                  onPress={() => confirmDelete(address)}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  <Text style={[styles.actionText, styles.actionTextDanger]}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="新增地址" icon="add" onPress={openCreate} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper
  },
  flex: {
    flex: 1
  },
  content: {
    padding: spacing.md,
    gap: spacing.md
  },
  centerBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 48,
    paddingHorizontal: spacing.md
  },
  emptyTitle: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  centerHint: {
    fontSize: fontSize.body,
    color: colors.ink2,
    textAlign: 'center'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
    ...cardShadow
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  contact: {
    fontSize: fontSize.name,
    fontWeight: '700',
    color: colors.ink
  },
  phone: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.ink2
  },
  defaultTag: {
    backgroundColor: colors.greenSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  defaultTagText: {
    fontSize: fontSize.body,
    color: colors.greenDeep,
    fontWeight: '700'
  },
  detail: {
    fontSize: fontSize.body,
    color: colors.ink,
    lineHeight: 24
  },
  remark: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.xs,
    paddingTop: spacing.xs
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: tap.min,
    paddingHorizontal: 4
  },
  actionDisabled: {
    opacity: 0.7
  },
  actionText: {
    fontSize: fontSize.body,
    color: colors.greenDeep,
    fontWeight: '600'
  },
  actionTextMuted: {
    color: colors.ink3
  },
  actionTextDanger: {
    color: colors.danger
  },
  footer: {
    padding: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line
  },
  saveButton: {
    marginTop: spacing.md
  },
  secondaryButton: {
    minHeight: tap.min,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.green
  },
  secondaryButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.greenDeep
  },
  formContent: {
    padding: spacing.md,
    paddingBottom: 48,
    gap: spacing.xs
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2,
    marginTop: spacing.sm
  },
  input: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.name,
    color: colors.ink
  },
  multiline: {
    minHeight: 96,
    paddingTop: spacing.sm,
    textAlignVertical: 'top'
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs
  },
  regionRowDisabled: {
    opacity: 0.6
  },
  regionText: {
    flex: 1,
    fontSize: fontSize.name,
    color: colors.ink
  },
  regionPlaceholder: {
    color: colors.ink3
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: tap.min,
    marginTop: spacing.sm
  },
  switchLabel: {
    fontSize: fontSize.name,
    color: colors.ink
  },
  formError: {
    fontSize: fontSize.body,
    color: colors.danger,
    marginTop: spacing.xs
  }
});

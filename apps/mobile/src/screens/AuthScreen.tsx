import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loginWithCode, sendCode, type AuthSession } from '../api';
import { colors, fontSize, radius, spacing, tap } from '../theme';

type Mode = 'login' | 'register';

const PHONE_RE = /^1[3-9]\d{9}$/;

/**
 * 登录 / 注册页（适老化）：
 * - 手机号 + 验证码，未注册时切到「注册」并填写姓名；
 * - ⚠️ 验证码为开发态固定值（接口返回 devCode），界面上明确标注为临时方案。
 */
export default function AuthScreen({ onSuccess }: { onSuccess: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError('');
    setNotice('');
  }

  async function handleSendCode() {
    const value = phone.trim();
    if (!PHONE_RE.test(value)) {
      setError('请输入 11 位手机号');
      return;
    }
    setSending(true);
    setError('');
    setNotice('');
    try {
      const payload = await sendCode(value);
      setDevCode(payload.devCode);
      setNotice(`验证码已发送。开发环境验证码固定为 ${payload.devCode}（临时方案）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit() {
    const value = phone.trim();
    if (!PHONE_RE.test(value)) {
      setError('请输入 11 位手机号');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('请输入 6 位验证码');
      return;
    }
    if (mode === 'register' && !nickname.trim()) {
      setError('请填写姓名');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const session = await loginWithCode({
        phone: value,
        code: code.trim(),
        mode,
        nickname: mode === 'register' ? nickname.trim() : undefined
      });
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? '登录失败' : '注册失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>S</Text>
            </View>
            <Text style={styles.brandName}>捎点啥</Text>
            <Text style={styles.brandSlogan}>买菜不费劲，送到家门口</Text>
          </View>

          <View style={styles.segment}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'login' }}
              style={[styles.segmentItem, mode === 'login' ? styles.segmentItemActive : null]}
              onPress={() => switchMode('login')}
            >
              <Text style={[styles.segmentText, mode === 'login' ? styles.segmentTextActive : null]}>
                登录
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === 'register' }}
              style={[styles.segmentItem, mode === 'register' ? styles.segmentItemActive : null]}
              onPress={() => switchMode('register')}
            >
              <Text
                style={[styles.segmentText, mode === 'register' ? styles.segmentTextActive : null]}
              >
                注册
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>手机号</Text>
            <TextInput
              value={phone}
              onChangeText={(value) => setPhone(value.replace(/[^\d]/g, '').slice(0, 11))}
              placeholder="请输入 11 位手机号"
              placeholderTextColor={colors.ink3}
              keyboardType="phone-pad"
              maxLength={11}
              style={styles.input}
              accessibilityLabel="手机号"
            />

            <Text style={styles.label}>验证码</Text>
            <View style={styles.codeRow}>
              <TextInput
                value={code}
                onChangeText={(value) => setCode(value.replace(/[^\d]/g, '').slice(0, 6))}
                placeholder="请输入 6 位验证码"
                placeholderTextColor={colors.ink3}
                keyboardType="number-pad"
                maxLength={6}
                style={[styles.input, styles.codeInput]}
                accessibilityLabel="验证码"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="获取验证码"
                disabled={sending}
                style={[styles.codeButton, sending ? styles.codeButtonDisabled : null]}
                onPress={() => void handleSendCode()}
              >
                {sending ? (
                  <ActivityIndicator color={colors.greenDeep} />
                ) : (
                  <Text style={styles.codeButtonText}>获取验证码</Text>
                )}
              </Pressable>
            </View>

            {mode === 'register' ? (
              <>
                <Text style={styles.label}>姓名</Text>
                <TextInput
                  value={nickname}
                  onChangeText={(value) => setNickname(value.slice(0, 20))}
                  placeholder="例如：张桂英"
                  placeholderTextColor={colors.ink3}
                  maxLength={20}
                  style={styles.input}
                  accessibilityLabel="姓名"
                />
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'login' ? '登录' : '注册并登录'}
              disabled={submitting}
              style={[styles.submit, submitting ? styles.submitDisabled : null]}
              onPress={() => void handleSubmit()}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.submitText}>{mode === 'login' ? '登录' : '注册并登录'}</Text>
              )}
            </Pressable>

            <Text style={styles.switchHint}>
              {mode === 'login' ? '第一次使用？点上面的「注册」' : '已经注册过？点上面的「登录」'}
            </Text>
          </View>

          <View style={styles.devNote}>
            <Ionicons name="construct-outline" size={20} color={colors.amber} />
            <Text style={styles.devNoteText}>
              现在是开发体验版：验证码固定为 {devCode || '123456'}，不会真的发短信；正式上线后会改成短信验证码。
            </Text>
          </View>

          <Text style={styles.helpText}>不会操作？可以让家人帮忙，或到店里找店员。</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
  },
  flex: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.lg
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoText: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.white
  },
  brandName: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.ink
  },
  brandSlogan: {
    fontSize: fontSize.body,
    color: colors.ink2
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.greenSoft,
    gap: 4
  },
  segmentItem: {
    flex: 1,
    minHeight: tap.min,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  segmentItemActive: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line
  },
  segmentText: {
    fontSize: fontSize.name,
    fontWeight: '600',
    color: colors.ink2
  },
  segmentTextActive: {
    color: colors.greenDeep,
    fontWeight: '700'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.ink2,
    marginTop: spacing.xs
  },
  input: {
    minHeight: tap.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.title,
    color: colors.ink
  },
  codeRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  codeInput: {
    flex: 1
  },
  codeButton: {
    minWidth: 124,
    minHeight: tap.primary,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  codeButtonDisabled: {
    opacity: 0.6
  },
  codeButtonText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.greenDeep
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    lineHeight: 24
  },
  notice: {
    fontSize: fontSize.body,
    color: colors.greenDeep,
    lineHeight: 24
  },
  submit: {
    marginTop: spacing.sm,
    minHeight: tap.primary,
    borderRadius: radius.md,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center'
  },
  submitDisabled: {
    opacity: 0.7
  },
  submitText: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.white
  },
  switchHint: {
    fontSize: fontSize.body,
    color: colors.ink3,
    textAlign: 'center'
  },
  devNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: '#EBD7B4'
  },
  devNoteText: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.ink2
  },
  helpText: {
    fontSize: fontSize.body,
    color: colors.ink3,
    textAlign: 'center',
    paddingBottom: spacing.lg
  }
});

'use server';

import { redirect } from 'next/navigation';
import { apiRequest } from './api';
import { getMessages } from './i18n/server';
import { clearSessionCookie, getSessionToken, setSessionCookie } from './session';

export type LoginState = { error?: string };

const PHONE_RULE = /^1[3-9]\d{9}$/;
const DEFAULT_AFTER_LOGIN = '/addresses';

/** 只允许站内相对路径，防止 open redirect */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : DEFAULT_AFTER_LOGIN;
}

export async function sendCodeAction(phone: string) {
  const m = await getMessages();
  const trimmed = phone.trim();
  if (!PHONE_RULE.test(trimmed)) {
    return { ok: false, message: m.auth.phoneInvalid };
  }

  const response = await apiRequest<{
    devMode: boolean;
    devCode: string;
    expiresIn: number;
    message?: string;
  }>('/api/auth/send-code', { method: 'POST', body: { phone: trimmed } });

  if (!response.ok || !response.data) {
    return { ok: false, message: response.message ?? m.auth.sendCodeFailed };
  }
  return {
    ok: true,
    devMode: response.data.devMode,
    devCode: response.data.devCode,
    expiresIn: response.data.expiresIn,
    message: response.data.message
  };
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const m = await getMessages();
  const mode = formData.get('mode') === 'register' ? 'register' : 'login';
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const nickname = String(formData.get('name') ?? '').trim();
  const next = safeNext(formData.get('next'));

  if (!PHONE_RULE.test(phone)) return { error: m.auth.phoneInvalid };
  if (!/^\d{6}$/.test(code)) return { error: m.auth.codeInvalid };
  if (mode === 'register' && !nickname) return { error: m.auth.nameRequired };

  const response = await apiRequest<{ accessToken: string; expiresAt: string }>('/api/auth/login', {
    method: 'POST',
    body: { phone, code, mode, ...(mode === 'register' ? { nickname } : {}) }
  });

  if (!response.ok || !response.data?.accessToken) {
    return { error: response.message ?? m.auth.loginFailed };
  }

  await setSessionCookie(response.data.accessToken, response.data.expiresAt);
  redirect(next);
}

export async function logoutAction() {
  const token = await getSessionToken();
  if (token) {
    await apiRequest('/api/auth/logout', { method: 'POST', token });
  }
  await clearSessionCookie();
  redirect('/');
}

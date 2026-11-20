'use server';

import { revalidatePath } from 'next/cache';
import { API_BASE_URL, apiRequest } from './api';
import { getMessages } from './i18n/server';
import { getSessionToken } from './session';

/** 个人信息页的表单状态：error 走红字，message 走绿字提示 */
export type ProfileState = {
  error?: string;
  message?: string;
  avatarUrl?: string | null;
  nickname?: string;
};

const PHONE_RULE = /^1[3-9]\d{9}$/;
const NICKNAME_RULE = /^\S{2,20}$/;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)\S{8,32}$/;

function revalidateProfile() {
  revalidatePath('/profile');
  // 顶栏用户名 / 头像在布局里，改完要刷新整站壳
  revalidatePath('/', 'layout');
}

export async function updateNicknameAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const m = await getMessages();
  const token = await getSessionToken();
  if (!token) return { error: m.account.authExpired };

  const nickname = String(formData.get('nickname') ?? '').trim();
  if (!NICKNAME_RULE.test(nickname)) {
    return { error: m.account.nicknameInvalid };
  }

  const response = await apiRequest<{ customer: { nickname: string | null } }>('/api/auth/profile', {
    method: 'PATCH',
    token,
    body: { nickname }
  });
  if (!response.ok) return { error: response.message ?? m.account.saveFailed };

  revalidateProfile();
  return { message: m.account.nicknameUpdated, nickname };
}

export async function uploadAvatarAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const m = await getMessages();
  const token = await getSessionToken();
  if (!token) return { error: m.account.authExpired };

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { error: m.account.chooseImage };
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return { error: m.account.avatarTypeInvalid };
  }
  if (file.size > 2 * 1024 * 1024) return { error: m.account.avatarSizeError };

  const body = new FormData();
  body.append('file', file, file.name || 'avatar');

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/avatar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
      cache: 'no-store'
    });
  } catch {
    return { error: m.common.networkError };
  }

  const data = (await response.json().catch(() => null)) as
    | { path?: string; message?: string }
    | null;
  // 上传接口只返回桶内相对路径；再读 /me 拿拼接好的展示地址
  if (!response.ok || !data?.path) {
    return { error: data?.message ?? m.account.avatarUploadFailed };
  }

  revalidateProfile();
  try {
    const meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    const me = (await meResponse.json().catch(() => null)) as
      | { customer?: { avatarUrl?: string | null } }
      | null;
    return { message: m.account.avatarUpdated, avatarUrl: me?.customer?.avatarUrl ?? null };
  } catch {
    return { message: m.account.avatarUpdated };
  }
}

export async function removeAvatarAction(
  _prev: ProfileState,
  _formData: FormData
): Promise<ProfileState> {
  const m = await getMessages();
  const token = await getSessionToken();
  if (!token) return { error: m.account.authExpired };

  const response = await apiRequest('/api/auth/avatar', { method: 'DELETE', token });
  if (!response.ok) return { error: response.message ?? m.account.removeFailed };

  revalidateProfile();
  return { message: m.account.avatarRemoved, avatarUrl: null };
}

export async function resetPasswordAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const m = await getMessages();
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!PHONE_RULE.test(phone)) return { error: m.auth.phoneInvalid };
  if (!/^\d{6}$/.test(code)) return { error: m.auth.codeInvalid };
  if (!PASSWORD_RULE.test(password)) {
    return { error: m.account.passwordInvalid };
  }
  if (password !== confirm) return { error: m.account.passwordMismatch };

  const response = await apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: { phone, code, password }
  });
  if (!response.ok) return { error: response.message ?? m.account.resetFailed };

  return { message: m.account.passwordReset };
}

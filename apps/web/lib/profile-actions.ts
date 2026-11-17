'use server';

import { revalidatePath } from 'next/cache';
import { API_BASE_URL, apiRequest } from './api';
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
  const token = await getSessionToken();
  if (!token) return { error: '登录已失效，请重新登录' };

  const nickname = String(formData.get('nickname') ?? '').trim();
  if (!NICKNAME_RULE.test(nickname)) {
    return { error: '用户名需 2–20 个字，且不能包含空格' };
  }

  const response = await apiRequest<{ customer: { nickname: string | null } }>('/api/auth/profile', {
    method: 'PATCH',
    token,
    body: { nickname }
  });
  if (!response.ok) return { error: response.message ?? '保存失败，请稍后再试' };

  revalidateProfile();
  return { message: '用户名已更新', nickname };
}

export async function uploadAvatarAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const token = await getSessionToken();
  if (!token) return { error: '登录已失效，请重新登录' };

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { error: '请选择要上传的图片' };
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return { error: '仅支持 JPG / PNG / WebP / GIF' };
  }
  if (file.size > 2 * 1024 * 1024) return { error: '头像大小需在 2MB 以内' };

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
    return { error: '网络异常，请稍后再试' };
  }

  const data = (await response.json().catch(() => null)) as
    | { avatarUrl?: string; message?: string }
    | null;
  if (!response.ok || !data?.avatarUrl) {
    return { error: data?.message ?? '头像上传失败，请稍后再试' };
  }

  revalidateProfile();
  return { message: '头像已更新', avatarUrl: data.avatarUrl };
}

export async function removeAvatarAction(
  _prev: ProfileState,
  _formData: FormData
): Promise<ProfileState> {
  const token = await getSessionToken();
  if (!token) return { error: '登录已失效，请重新登录' };

  const response = await apiRequest('/api/auth/avatar', { method: 'DELETE', token });
  if (!response.ok) return { error: response.message ?? '移除失败，请稍后再试' };

  revalidateProfile();
  return { message: '已恢复默认头像', avatarUrl: null };
}

export async function resetPasswordAction(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!PHONE_RULE.test(phone)) return { error: '请输入正确的 11 位手机号' };
  if (!/^\d{6}$/.test(code)) return { error: '请输入 6 位数字验证码' };
  if (!PASSWORD_RULE.test(password)) {
    return { error: '新密码需 8–32 位，同时包含字母和数字，且不能有空格' };
  }
  if (password !== confirm) return { error: '两次输入的密码不一致' };

  const response = await apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: { phone, code, password }
  });
  if (!response.ok) return { error: response.message ?? '重置失败，请稍后再试' };

  return { message: '密码已重置，请牢记新密码' };
}

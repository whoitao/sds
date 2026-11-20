'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { getMessages } from '@/lib/i18n/server';
import { getSessionToken } from '@/lib/session';

/** 地址增删改的 Server Action：校验在服务端再做一遍，落库仍走 packages/api */
export type AddressActionState = { ok?: boolean; error?: string; message?: string };

const PHONE_RULE = /^1[3-9]\d{9}$/;
const ADDRESSES_PATH = '/addresses';

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? '').trim();
}

/** 未登录 / 会话失效统一回登录页，并带上回跳地址 */
async function requireToken() {
  const token = await getSessionToken();
  if (!token) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  return token;
}

export async function saveAddressAction(
  _prev: AddressActionState,
  formData: FormData
): Promise<AddressActionState> {
  const m = await getMessages();
  const token = await requireToken();

  const id = field(formData, 'id');
  const contactName = field(formData, 'contactName');
  const contactPhone = field(formData, 'contactPhone');
  const provinceCode = field(formData, 'provinceCode');
  const cityCode = field(formData, 'cityCode');
  const districtCode = field(formData, 'districtCode');
  const detail = field(formData, 'detail');
  const remark = field(formData, 'remark');

  if (!contactName) return { error: m.address.contactRequired };
  if (!PHONE_RULE.test(contactPhone)) return { error: m.address.phoneInvalid };
  if (!provinceCode || !cityCode || !districtCode) return { error: m.address.regionRequired };
  if (detail.length < 5) return { error: m.address.detailTooShort };

  const body = {
    contactName,
    contactPhone,
    provinceCode,
    cityCode,
    districtCode,
    detail,
    remark: remark || null
  };

  const response = id
    ? await apiRequest(`/api/addresses/${id}`, { method: 'PATCH', token, body })
    : await apiRequest('/api/addresses', {
        method: 'POST',
        token,
        body: { ...body, isDefault: formData.get('isDefault') === 'on' }
      });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  if (!response.ok) return { error: response.message ?? m.address.saveFailed };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: id ? m.address.savedUpdate : m.address.savedNew };
}

export async function deleteAddressAction(id: string): Promise<AddressActionState> {
  const m = await getMessages();
  const token = await requireToken();
  const response = await apiRequest(`/api/addresses/${id}`, { method: 'DELETE', token });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  if (!response.ok) return { error: response.message ?? m.address.deleteFailed };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: m.address.deleted };
}

export async function setDefaultAddressAction(id: string): Promise<AddressActionState> {
  const m = await getMessages();
  const token = await requireToken();
  const response = await apiRequest(`/api/addresses/${id}/default`, { method: 'PATCH', token });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  if (!response.ok) return { error: response.message ?? m.address.defaultFailed };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: m.address.defaultSet };
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
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
  const token = await requireToken();

  const id = field(formData, 'id');
  const contactName = field(formData, 'contactName');
  const contactPhone = field(formData, 'contactPhone');
  const provinceCode = field(formData, 'provinceCode');
  const cityCode = field(formData, 'cityCode');
  const districtCode = field(formData, 'districtCode');
  const detail = field(formData, 'detail');
  const remark = field(formData, 'remark');

  if (!contactName) return { error: '请填写联系人' };
  if (!PHONE_RULE.test(contactPhone)) return { error: '请填写正确的 11 位手机号' };
  if (!provinceCode || !cityCode || !districtCode) return { error: '请选择省 / 市 / 区县' };
  if (detail.length < 5) return { error: '请填写详细地址（至少 5 个字）' };

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
  if (!response.ok) return { error: response.message ?? '保存失败，请稍后再试' };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: id ? '地址已更新' : '地址已添加' };
}

export async function deleteAddressAction(id: string): Promise<AddressActionState> {
  const token = await requireToken();
  const response = await apiRequest(`/api/addresses/${id}`, { method: 'DELETE', token });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  if (!response.ok) return { error: response.message ?? '删除失败，请稍后再试' };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: '地址已删除' };
}

export async function setDefaultAddressAction(id: string): Promise<AddressActionState> {
  const token = await requireToken();
  const response = await apiRequest(`/api/addresses/${id}/default`, { method: 'PATCH', token });

  if (response.status === 401) redirect(`/login?next=${encodeURIComponent(ADDRESSES_PATH)}`);
  if (!response.ok) return { error: response.message ?? '设置默认地址失败，请稍后再试' };

  revalidatePath(ADDRESSES_PATH);
  return { ok: true, message: '已设为默认地址' };
}

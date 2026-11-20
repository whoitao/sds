/** 服务端访问 packages/api 的统一入口（只在 RSC / Server Action 中使用，避免浏览器 CORS） */
import { getMessages } from './i18n/server';

export const API_BASE_URL = (
  process.env.API_BASE_URL || `http://localhost:${process.env.PORT_API ?? 19852}`
).replace(/\/+$/, '');

export type ApiResponse<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  message?: string;
  /** 接口返回的业务错误码，前端可据此给出更明确的处理提示 */
  code?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  /** 只读公共数据可交给 Next 的 fetch 缓存；不传则保持 no-store */
  next?: { revalidate?: number | false; tags?: string[] };
};

export async function apiRequest<T>(
  path: string,
  { method = 'GET', token, body, next }: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(next ? { next } : { cache: 'no-store' as const })
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return {
      ok: response.ok,
      status: response.status,
      data,
      message: (data as { message?: string } | null)?.message,
      code: (data as { code?: string } | null)?.code
    };
  } catch {
    // 只在服务端调用，按当前语言给兜底提示
    const m = await getMessages();
    return { ok: false, status: 0, data: null, message: m.common.networkError };
  }
}

export type CustomerSummary = {
  id: string;
  nickname: string | null;
  phone: string | null;
  avatarUrl: string | null;
  totalOrders: number;
  createdAt?: string;
};

export type AddressItem = {
  id: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string | null;
  province: string | null;
  cityCode: string | null;
  city: string | null;
  districtCode: string | null;
  district: string | null;
  detail: string;
  remark: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { apiRequest, type CustomerSummary } from './api';

/**
 * Web 侧会话：把 API 下发的顾客 token 存在 httpOnly Cookie 里，
 * 只在服务端读取并转成 Authorization 头，浏览器拿不到 token。
 */
export const SESSION_COOKIE = 'sds_customer_token';
const SESSION_FALLBACK_SECONDS = 30 * 24 * 60 * 60;

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt?: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(expiresAt
      ? { expires: new Date(expiresAt) }
      : { maxAge: SESSION_FALLBACK_SECONDS })
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** 当前登录顾客；无会话或会话失效都返回 null（同一次请求内只请求一次） */
export const getCurrentCustomer = cache(async (): Promise<CustomerSummary | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const response = await apiRequest<{ customer: CustomerSummary }>('/api/auth/me', { token });
  if (!response.ok || !response.data?.customer) return null;
  return response.data.customer;
});

/** 受保护页面守卫：未登录时带着回跳地址去登录页 */
export async function requireCustomer(currentPath: string): Promise<CustomerSummary> {
  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }
  return customer;
}

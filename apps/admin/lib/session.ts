import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getApiBaseUrl } from './api-base';
import { ADMIN_COOKIE } from './auth-cookie';

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string;
  role: string;
  lastLoginAt: string | null;
  preferences?: {
    theme?: 'system' | 'light' | 'dark';
    pageSize?: number;
  };
}

/** 用 cookie 里的凭证回源校验身份，失效时返回 null */
export async function fetchAdminProfile(token: string): Promise<AdminProfile | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { admin: AdminProfile };
    return data.admin;
  } catch {
    return null;
  }
}

/** 后台页面的登录守卫：无凭证或凭证失效一律回登录页 */
export async function requireAdmin(): Promise<AdminProfile> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) redirect('/login');

  const admin = await fetchAdminProfile(token);
  if (!admin) redirect('/login');

  return admin;
}

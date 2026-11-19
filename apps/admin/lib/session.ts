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
    displayDensity?: 'compact' | 'standard' | 'relaxed';
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

export interface AdminAccess {
  permissions: string[];
  isSuperAdmin: boolean;
}

/**
 * 服务端读取当前管理员的有效权限，供页面首帧决定可见内容。
 * 与 /api/admin/me/permissions 同一数据源；失败时返回空权限，按最小可见渲染。
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return { permissions: [], isSuperAdmin: false };

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/admin/me/permissions`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (!response.ok) return { permissions: [], isSuperAdmin: false };

    const data = (await response.json()) as {
      roles?: Array<{ code?: string }>;
      permissions?: string[];
    };
    return {
      permissions: data.permissions ?? [],
      isSuperAdmin: (data.roles ?? []).some((role) => role.code === 'super_admin')
    };
  } catch {
    return { permissions: [], isSuperAdmin: false };
  }
}

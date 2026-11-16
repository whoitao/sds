import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApiBaseUrl } from './api-base';
import { ADMIN_COOKIE } from './auth-cookie';

/**
 * 同源代理：仅负责把 cookie 里的管理员令牌转成 Authorization 头后转发给 packages/api。
 * 业务逻辑与权限求值都在 API 侧，这里不做任何判断。
 */
export async function proxyToApi(path: string, init?: RequestInit) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: '未登录' }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
      cache: 'no-store'
    });

    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ code: 'API_UNREACHABLE', message: '服务不可用' }, { status: 503 });
  }
}

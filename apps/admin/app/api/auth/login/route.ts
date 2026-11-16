import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE } from '../../../../lib/auth-cookie';
import { getApiBaseUrl } from '../../../../lib/api-base';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ code: 'INVALID_BODY', message: '请输入账号和密码' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getApiBaseUrl()}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: body.username, password: body.password }),
      cache: 'no-store'
    });
  } catch {
    return NextResponse.json({ code: 'API_UNREACHABLE', message: '认证服务不可用，请稍后再试' }, { status: 503 });
  }

  const data = (await upstream.json().catch(() => ({}))) as {
    token?: string;
    admin?: unknown;
    code?: string;
    message?: string;
  };

  if (!upstream.ok || !data.token) {
    return NextResponse.json(
      { code: data.code ?? 'LOGIN_FAILED', message: data.message ?? '登录失败' },
      { status: upstream.status === 200 ? 401 : upstream.status }
    );
  }

  const response = NextResponse.json({ admin: data.admin });
  response.cookies.set(ADMIN_COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production'
  });
  return response;
}

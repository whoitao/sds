import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE } from './lib/auth-cookie';

/**
 * 只做「有没有凭证」的乐观拦截，签名与账号状态由 packages/api 的 /me 校验。
 * 这样 middleware 无需持有 JWT 密钥，也能避免未登录用户看到后台骨架。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ADMIN_COOKIE)?.value;

  if (pathname === '/login') {
    if (token) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|media/).*)']
};

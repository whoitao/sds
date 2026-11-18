import { NextResponse } from 'next/server';
import { apiRequest } from '@/lib/api';
import { getSessionToken } from '@/lib/session';

/** 顶栏用户菜单展开时才调用：只返回两个计数，不落缓存 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const response = await apiRequest<{ addressCount: number; ongoingOrderCount: number }>(
    '/api/mobile/summary',
    { token }
  );

  if (!response.ok || !response.data) {
    return NextResponse.json({ ok: false }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { ok: true, ...response.data },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

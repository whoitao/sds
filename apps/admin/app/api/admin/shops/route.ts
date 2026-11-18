import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../lib/proxy';
import { revalidateWebShopCache } from '../../../../lib/revalidate-web';

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();
  return proxyToApi(`/api/admin/shops${search ? `?${search}` : ''}`);
}

export async function POST(request: NextRequest) {
  const response = await proxyToApi('/api/admin/shops', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
  if (response.ok) void revalidateWebShopCache();
  return response;
}

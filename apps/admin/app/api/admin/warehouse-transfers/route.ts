import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../lib/proxy';

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();
  return proxyToApi(`/api/admin/warehouse-transfers${search ? `?${search}` : ''}`);
}

export async function POST(request: NextRequest) {
  return proxyToApi('/api/admin/warehouse-transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

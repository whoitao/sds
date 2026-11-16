import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

// 总部商品库列表与新建：同源代理到 packages/api 的 /api/admin/catalog/products
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();
  return proxyToApi(`/api/admin/catalog/products${search ? `?${search}` : ''}`);
}

export async function POST(request: NextRequest) {
  return proxyToApi('/api/admin/catalog/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

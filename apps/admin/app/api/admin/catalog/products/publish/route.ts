import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

// 发布（支持批量）：发布即自动铺货到所有尚未引用该商品的门店
export async function POST(request: NextRequest) {
  return proxyToApi('/api/admin/catalog/products/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

// 一键铺货：把已发布的总部商品补到该门店
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/shops/${id}/catalog/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

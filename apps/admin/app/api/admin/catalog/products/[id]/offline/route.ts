import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

// 总部强制下架 / 解除
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/catalog/products/${id}/offline`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

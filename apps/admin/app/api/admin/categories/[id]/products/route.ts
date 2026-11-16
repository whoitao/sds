import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

// 把分类下的直属商品批量迁移到目标分类
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/categories/${id}/products`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

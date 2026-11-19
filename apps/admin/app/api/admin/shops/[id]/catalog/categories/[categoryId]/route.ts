import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../../lib/proxy';

// 门店分类可见性：显示/隐藏共享分类（含父子联动由 API 处理）
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; categoryId: string }> }
) {
  const { id, categoryId } = await context.params;
  return proxyToApi(`/api/admin/shops/${id}/catalog/categories/${categoryId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

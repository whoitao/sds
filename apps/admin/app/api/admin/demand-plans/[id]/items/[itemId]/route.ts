import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  return proxyToApi(`/api/admin/demand-plans/${id}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

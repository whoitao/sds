import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.text();
  return proxyToApi(`/api/admin/users/${id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body
  });
}

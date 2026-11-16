import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/roles/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/roles/${id}`, { method: 'DELETE' });
}

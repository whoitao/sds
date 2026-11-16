import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/admins/${id}/roles`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/warehouses/${id}/members`);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/warehouses/${id}/members`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

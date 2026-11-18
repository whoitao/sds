import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToApi(`/api/admin/suppliers/${id}/scopes`, { method: 'GET' });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToApi(`/api/admin/suppliers/${id}/scopes`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

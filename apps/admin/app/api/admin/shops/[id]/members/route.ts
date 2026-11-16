import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/shops/${id}/members`);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/shops/${id}/members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

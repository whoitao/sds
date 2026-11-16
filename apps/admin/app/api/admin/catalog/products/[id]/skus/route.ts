import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/catalog/products/${id}/skus`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/catalog/products/${id}/skus`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

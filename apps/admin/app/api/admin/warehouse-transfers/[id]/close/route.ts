import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idempotencyKey = request.headers.get('idempotency-key');
  return proxyToApi(`/api/admin/warehouse-transfers/${id}/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
    },
    body: await request.text()
  });
}

import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function POST(request: NextRequest) {
  const idempotencyKey = request.headers.get('idempotency-key');
  return proxyToApi('/api/admin/warehouse-transfers/from-demand', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
    },
    body: await request.text()
  });
}

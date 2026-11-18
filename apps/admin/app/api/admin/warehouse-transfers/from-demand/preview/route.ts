import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function POST(request: NextRequest) {
  return proxyToApi('/api/admin/warehouse-transfers/from-demand/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

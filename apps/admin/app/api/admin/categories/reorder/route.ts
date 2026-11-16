import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function PATCH(request: NextRequest) {
  return proxyToApi('/api/admin/categories/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

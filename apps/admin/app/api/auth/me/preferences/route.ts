import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function GET() {
  return proxyToApi('/api/admin/auth/me/preferences');
}

export async function PATCH(request: NextRequest) {
  return proxyToApi('/api/admin/auth/me/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

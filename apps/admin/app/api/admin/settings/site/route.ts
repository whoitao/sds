import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function GET() {
  return proxyToApi('/api/admin/settings/site');
}

export async function PUT(request: NextRequest) {
  return proxyToApi('/api/admin/settings/site', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

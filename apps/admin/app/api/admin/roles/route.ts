import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../lib/proxy';

export async function GET() {
  return proxyToApi('/api/admin/roles');
}

export async function POST(request: NextRequest) {
  return proxyToApi('/api/admin/roles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

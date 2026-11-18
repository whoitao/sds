import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/requisitions/${id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ adminId: string }> }) {
  const { adminId } = await params;
  return proxyToApi(`/api/admin/requisitions/shop-scope/${adminId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
}

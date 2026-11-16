import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToApi(`/api/admin/users/${id}/addresses`, { method: 'GET' });
}

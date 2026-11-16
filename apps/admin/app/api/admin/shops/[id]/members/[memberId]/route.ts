import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await context.params;
  return proxyToApi(`/api/admin/shops/${id}/members/${memberId}`, { method: 'DELETE' });
}

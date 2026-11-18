import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';
import { revalidateWebShopCache } from '../../../../../lib/revalidate-web';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const response = await proxyToApi(`/api/admin/shops/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: await request.text()
  });
  if (response.ok) void revalidateWebShopCache();
  return response;
}

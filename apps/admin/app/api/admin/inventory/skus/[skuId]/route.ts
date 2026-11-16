import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../lib/proxy';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const { skuId } = await params;
  return proxyToApi(`/api/admin/inventory/skus/${skuId}`);
}

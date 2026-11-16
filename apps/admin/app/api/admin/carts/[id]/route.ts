import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

// 购物车明细：商品、数量、单价、小计
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/carts/${encodeURIComponent(id)}`);
}

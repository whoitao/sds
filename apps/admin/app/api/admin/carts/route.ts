import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../lib/proxy';

// 购物车列表：门店、顾客、商品名筛选与分页
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  return proxyToApi(`/api/admin/carts${query ? `?${query}` : ''}`);
}

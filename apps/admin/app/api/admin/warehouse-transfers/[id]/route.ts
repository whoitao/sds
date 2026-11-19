import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = request.nextUrl.searchParams.toString();
  return proxyToApi(`/api/admin/warehouse-transfers/${id}${search ? `?${search}` : ''}`);
}

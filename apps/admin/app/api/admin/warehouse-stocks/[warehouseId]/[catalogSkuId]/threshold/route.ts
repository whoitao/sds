import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../../../lib/proxy';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string; catalogSkuId: string }> }
) {
  const { warehouseId, catalogSkuId } = await params;
  return proxyToApi(
    `/api/admin/warehouse-stocks/${warehouseId}/${catalogSkuId}/threshold`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: await request.text()
    }
  );
}

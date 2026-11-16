import { proxyToApi } from '../../../../../lib/proxy';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(`/api/admin/orders/${id}`);
}

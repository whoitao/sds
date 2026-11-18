import { proxyToApi } from '../../../../../lib/proxy';

export async function GET() {
  return proxyToApi('/api/admin/requisitions/shop-scope');
}

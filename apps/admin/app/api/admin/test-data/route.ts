import { proxyToApi } from '../../../../lib/proxy';

export async function GET() {
  return proxyToApi('/api/admin/test-data');
}

export async function DELETE() {
  return proxyToApi('/api/admin/test-data', { method: 'DELETE' });
}

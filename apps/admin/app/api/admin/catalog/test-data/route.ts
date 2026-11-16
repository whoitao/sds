import type { NextRequest } from 'next/server';
import { proxyToApi } from '../../../../../lib/proxy';

// 测试数据清理：预览数量与执行删除
export async function GET(_request: NextRequest) {
  return proxyToApi('/api/admin/catalog/test-data');
}

export async function DELETE(_request: NextRequest) {
  return proxyToApi('/api/admin/catalog/test-data', { method: 'DELETE' });
}

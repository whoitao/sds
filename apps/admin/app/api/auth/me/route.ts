import { proxyToApi } from '../../../../lib/proxy';

/** 登录态校验同样走统一代理，只转发不回源实现 */
export async function GET() {
  return proxyToApi('/api/admin/auth/me');
}

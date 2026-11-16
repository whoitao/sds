/**
 * admin 端调用 API 的基地址。
 * 优先用显式配置的 API_BASE_URL；没有则按 PORT_API 派生，端口改了也不会连不上。
 */
export function getApiBaseUrl(): string {
  const explicit = process.env.API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.PORT_API?.trim() || '8787';
  return `http://localhost:${port}`;
}

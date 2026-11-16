import { Hono } from 'hono';
import { loadRegions } from '../lib/regions';

/**
 * 行政区划字典（公开接口，无需登录）。
 *
 * GET /api/regions 一次性返回全部的省/市/区县扁平列表，
 * 各端用 @sds/shared 的 buildRegionIndex 建索引后做联动；
 * 带 ETag，客户端可带 If-None-Match 拿 304，节省流量。
 */
export const regionRoutes = new Hono();

regionRoutes.get('/', async (c) => {
  const { version, nodes } = await loadRegions();
  const etag = `W/"regions-${version}"`;

  c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  c.header('ETag', etag);
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304);
  }

  return c.json({ version, count: nodes.length, items: nodes });
});

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@sds/db';
import { nearbyShopQuerySchema } from '@sds/shared';
import { shopMapHtml } from '../lib/shop-map.js';

export const publicShopRoutes = new Hono();

const shopFields = sql`id, name, address, phone, status, cover_url as "coverUrl",
  business_hours as "businessHours", announcement,
  longitude::double precision as longitude, latitude::double precision as latitude`;
const searchSchema = z.object({ keyword: z.string().trim().max(50).default('') });

function keywordFilter(keyword: string) {
  const value = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
  return sql`(name ilike ${value} or address ilike ${value})`;
}

publicShopRoutes.get('/', async (c) => {
  const parsed = searchSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ code: 'INVALID_QUERY', message: '搜索内容最多 50 个字' }, 400);
  const result = await (await getDb()).execute(sql`
    select ${shopFields}, null::integer as "distanceMeters"
      from shops
     where status != 'suspended' and ${keywordFilter(parsed.data.keyword)}
     order by (status = 'open') desc, name, id
  `);
  return c.json({ items: result.rows });
});

publicShopRoutes.get('/nearby', async (c) => {
  const parsed = nearbyShopQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: 'INVALID_QUERY', message: '请提供有效的位置与 20 公里以内的范围' }, 400);
  }
  const { lat, lng, radius, keyword = '' } = parsed.data;
  const result = await (await getDb()).execute(sql`
    with nearby as (
      select ${shopFields},
        6371000 * acos(least(1.0, greatest(-1.0,
          sin(radians(${lat}::double precision)) * sin(radians(latitude::double precision)) +
          cos(radians(${lat}::double precision)) * cos(radians(latitude::double precision)) *
          cos(radians(longitude::double precision - ${lng}::double precision))
        ))) as distance
        from shops
       where status != 'suspended' and ${keywordFilter(keyword)}
    )
    select id, name, address, phone, status, "coverUrl", "businessHours", announcement,
           longitude, latitude, round(distance)::integer as "distanceMeters"
      from nearby
     where distance <= ${radius}
     order by distance, name, id
  `);
  return c.json({ items: result.rows, radius, coordinateSystem: 'gcj02' });
});

publicShopRoutes.get('/map', (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  return c.html(shopMapHtml());
});

import { z } from 'zod';

/** 附近店铺查询参数（前后端共用，对应 PRD 4.4 技术选型中的 Zod） */
export const nearbyShopQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().positive().max(20000).default(3000),
  keyword: z.string().trim().max(50).optional()
});

export type NearbyShopQuery = z.infer<typeof nearbyShopQuerySchema>;

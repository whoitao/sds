import { asc, eq, sql } from 'drizzle-orm';
import { getDb, regions } from '@sds/db';
import { buildRegionIndex, type RegionIndex, type RegionLevel, type RegionNode } from '@sds/shared';

/**
 * 行政区划读取层（服务端缓存）。
 *
 * 区划数据变动极少，这里按「条数 + 最大更新时间」生成版本号，
 * 版本不变就复用进程内缓存，避免每个请求都扫一遍 regions 表。
 */
export interface RegionSnapshot {
  version: string;
  nodes: RegionNode[];
  index: RegionIndex;
}

let cached: RegionSnapshot | null = null;

export async function loadRegions(): Promise<RegionSnapshot> {
  const db = await getDb();
  const [meta] = await db
    .select({
      total: sql<number>`count(*)::int`,
      stamp: sql<string>`coalesce(max(updated_at)::text, '')`
    })
    .from(regions);
  const version = `${meta?.total ?? 0}-${meta?.stamp ?? ''}`;
  if (cached?.version === version) return cached;

  const rows = await db
    .select({
      code: regions.code,
      name: regions.name,
      level: regions.level,
      parentCode: regions.parentCode
    })
    .from(regions)
    .where(eq(regions.isActive, true))
    .orderBy(asc(regions.level), asc(regions.sortOrder), asc(regions.code));

  const nodes: RegionNode[] = rows.map((row) => ({
    code: row.code,
    name: row.name,
    level: row.level as RegionLevel,
    parentCode: row.parentCode
  }));

  cached = { version, nodes, index: buildRegionIndex(nodes) };
  return cached;
}

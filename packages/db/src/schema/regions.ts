import { smallint, boolean, index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * 行政区划字典（PRD 地址模块的统计基础）。
 * code 采用民政部行政区划编码：省 2 位、市 4 位、区县 6 位，作为父级关联键。
 * 名称列在 addresses 里另有快照，statistics 直接按地址的 district_code 聚合。
 */
export const regions = pgTable(
  'regions',
  {
    code: varchar('code', { length: 12 }).primaryKey(),
    name: varchar('name', { length: 60 }).notNull(),
    level: smallint('level').notNull(),
    parentCode: varchar('parent_code', { length: 12 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    parentIdx: index('regions_parent_idx').on(t.parentCode),
    levelIdx: index('regions_level_idx').on(t.level)
  })
);

export type RegionRow = typeof regions.$inferSelect;
export type NewRegionRow = typeof regions.$inferInsert;

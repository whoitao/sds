import { boolean, index, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.ts';
import { catalogSkus } from './skus.ts';

/**
 * 仓库主数据（迁移 0021）。
 * - `type`：hq 总部仓 / regional 区域仓，首期只启用一个总部仓；
 * - `status`：active 启用 / disabled 停用，停用后仍保留历史引用。
 */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 16 }).notNull().default('hq'),
    address: text('address'),
    coldZoneSupported: boolean('cold_zone_supported').notNull().default(false),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    remark: text('remark'),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    codeUnique: uniqueIndex('warehouses_code_unique').on(t.code),
    statusIdx: index('warehouses_status_idx').on(t.status),
    typeIdx: index('warehouses_type_idx').on(t.type)
  })
);

/** 管理员可见仓库范围；没有记录即看不到，super_admin 由接口层放行。 */
export const adminUserWarehouses = pgTable(
  'admin_user_warehouses',
  {
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.adminUserId, t.warehouseId] }),
    warehouseIdx: index('admin_user_warehouses_warehouse_idx').on(t.warehouseId)
  })
);

/**
 * 仓库层库存余额（迁移 0023）。
 * 仓库持有总部规格库存，`sku_id` 指向 `catalog_skus`；分拨到门店时再映射为门店 SKU，门店 SKU 不在此表。
 * 本轮只建表，尚未接入入库/分拨记账。
 */
export const warehouseStocks = pgTable(
  'warehouse_stocks',
  {
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => catalogSkus.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('0'),
    reservedQty: numeric('reserved_qty', { precision: 12, scale: 2 }).notNull().default('0'),
    avgUnitCost: numeric('avg_unit_cost', { precision: 10, scale: 2 }).notNull().default('0'),
    /** 安全库存下限（迁移 0034）：可用量 = quantity - reserved_qty，<= 该值触发仓库低库存预警 */
    minThreshold: numeric('min_threshold', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** 库存上限（迁移 0034，可选），仅作补货参考，不参与校验 */
    maxThreshold: numeric('max_threshold', { precision: 12, scale: 2 }),
    isTest: boolean('is_test').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.warehouseId, t.skuId] }),
    skuIdx: index('warehouse_stocks_sku_idx').on(t.skuId)
  })
);

export type Warehouse = typeof warehouses.$inferSelect;
export type NewWarehouse = typeof warehouses.$inferInsert;
export type WarehouseStock = typeof warehouseStocks.$inferSelect;
export type NewWarehouseStock = typeof warehouseStocks.$inferInsert;

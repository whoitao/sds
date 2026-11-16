import { pgEnum } from 'drizzle-orm/pg-core';

/** 库存追踪方式：tracked 关联库存表 / untracked 不追踪。总部商品与门店商品共用 */
export const productStockTypeEnum = pgEnum('product_stock_type', ['tracked', 'untracked']);

import { Hono } from 'hono';
import { eq, sql, type SQL } from 'drizzle-orm';
import { adminUserWarehouses, getDb } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, isSuperAdmin } from '../lib/shop-scope.js';

/**
 * 控制面板聚合接口（只读）：
 * - 一次请求返回销售、待办、库存金额、趋势、榜单与损耗，避免前端逐块拉大列表；
 * - 时间口径统一按 Asia/Shanghai 自然日；
 * - 权限沿用 reports.read；非超管按 admin_user_shops / admin_user_warehouses 收敛数据范围。
 */
export const dashboardRoutes = new Hono<AdminEnv>();

dashboardRoutes.use('*', requireAdmin);

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 参与销售口径的订单：用正向状态列表而不是 NOT IN，
 * 便于命中 orders(status, created_at) 索引；排除未支付、已取消、已退款。
 */
const SALES_STATUS_FILTER = sql`o.status in ('paid', 'preparing', 'delivering', 'pickup_ready', 'completed', 'refund_pending')`;

function uuidList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
}

function shopScope(column: SQL, shopIds: string[] | null): SQL {
  if (shopIds === null) return sql``;
  if (shopIds.length === 0) return sql`and false`;
  return sql`and ${column} in (${uuidList(shopIds)})`;
}

function warehouseScope(column: SQL, warehouseIds: string[] | null): SQL {
  if (warehouseIds === null) return sql``;
  if (warehouseIds.length === 0) return sql`and false`;
  return sql`and ${column} in (${uuidList(warehouseIds)})`;
}

/** 主体可能是门店或仓库的单据：非超管只要任意一侧在范围内即计入 */
function anyScope(
  shopIds: string[] | null,
  warehouseIds: string[] | null,
  shopColumn: SQL,
  warehouseColumn: SQL
): SQL {
  if (shopIds === null) return sql``;
  const parts: SQL[] = [];
  if (shopIds.length > 0) parts.push(sql`${shopColumn} in (${uuidList(shopIds)})`);
  if (warehouseIds !== null && warehouseIds.length > 0) {
    parts.push(sql`${warehouseColumn} in (${uuidList(warehouseIds)})`);
  }
  if (parts.length === 0) return sql`and false`;
  return sql`and (${sql.join(parts, sql` or `)})`;
}

async function accessibleWarehouseIds(adminId: string): Promise<string[] | null> {
  if (await isSuperAdmin(adminId)) return null;
  const db = await getDb();
  const rows = await db
    .select({ warehouseId: adminUserWarehouses.warehouseId })
    .from(adminUserWarehouses)
    .where(eq(adminUserWarehouses.adminUserId, adminId));
  return rows.map((row) => row.warehouseId);
}

function startOfShanghaiDay(date: Date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      SHANGHAI_OFFSET_MS
  );
}

function formatShanghaiDay(date: Date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return Math.round(toNumber(value) * 100) / 100;
}

function ratio(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function avg(total: number, count: number) {
  return count > 0 ? Math.round((total / count) * 100) / 100 : 0;
}

dashboardRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'reports.read');
  if (denied) return denied;

  const admin = c.get('admin');

  // 门店筛选：不传 = 当前账号范围内全部；传了必须是可访问门店
  const requestedShopId = c.req.query('shopId')?.trim() || null;
  if (requestedShopId && !UUID_RE.test(requestedShopId)) {
    return c.json({ code: 'INVALID_SHOP_ID', message: '门店 ID 不合法' }, 400);
  }

  let [shopIds, warehouseIds] = await Promise.all([
    accessibleShopIds(admin.sub),
    accessibleWarehouseIds(admin.sub)
  ]);

  if (requestedShopId) {
    if (shopIds !== null && !shopIds.includes(requestedShopId)) {
      return c.json({ code: 'FORBIDDEN', message: '无权查看该门店数据' }, 403);
    }
    // 单店口径：门店类指标收敛到该店；仓库类指标不属于单店，按 0 处理
    shopIds = [requestedShopId];
    warehouseIds = [];
  }

  const db = await getDb();
  const now = new Date();
  const todayStart = startOfShanghaiDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const elapsedToday = now.getTime() - todayStart.getTime();
  const yesterdayEnd = new Date(yesterdayStart.getTime() + elapsedToday);
  const last7Start = new Date(todayStart.getTime() - 6 * DAY_MS);
  const prev7Start = new Date(todayStart.getTime() - 13 * DAY_MS);
  const prev7End = last7Start;

  const orderScope = shopScope(sql`o.shop_id`, shopIds);
  const damageScope = anyScope(shopIds, warehouseIds, sql`dr.shop_id`, sql`dr.warehouse_id`);
  const transferScope = anyScope(
    shopIds,
    warehouseIds,
    sql`wt.to_shop_id`,
    sql`wt.from_warehouse_id`
  );
  const purchaseScope = anyScope(
    shopIds,
    warehouseIds,
    sql`p.shop_id`,
    sql`p.warehouse_id`
  );

  const salesPromise = db.execute(sql`
    select
      (count(*) filter (where o.created_at >= ${todayStart}))::int as today_orders,
      coalesce((sum(o.total_amount) filter (where o.created_at >= ${todayStart})), 0)::text as today_amount,
      (count(*) filter (
        where o.created_at >= ${yesterdayStart} and o.created_at < ${yesterdayEnd}
      ))::int as yesterday_orders,
      coalesce((sum(o.total_amount) filter (
        where o.created_at >= ${yesterdayStart} and o.created_at < ${yesterdayEnd}
      )), 0)::text as yesterday_amount,
      (count(*) filter (where o.created_at >= ${last7Start}))::int as week_orders,
      coalesce((sum(o.total_amount) filter (where o.created_at >= ${last7Start})), 0)::text as week_amount,
      (count(*) filter (
        where o.created_at >= ${prev7Start} and o.created_at < ${prev7End}
      ))::int as prev_week_orders,
      coalesce((sum(o.total_amount) filter (
        where o.created_at >= ${prev7Start} and o.created_at < ${prev7End}
      )), 0)::text as prev_week_amount
    from orders o
    where o.created_at >= ${prev7Start}
      and o.created_at < ${now}
      and ${SALES_STATUS_FILTER}
      ${orderScope}
  `);

  const todoPromise = db.execute(sql`
    select
      (select count(*) from orders o
        where o.status in ('paid', 'preparing') ${shopScope(sql`o.shop_id`, shopIds)})::int as pending_orders,
      (select count(*) from orders o
        where o.status = 'refund_pending' ${shopScope(sql`o.shop_id`, shopIds)})::int as refund_pending,
      (select count(*) from shop_requisitions r
        where r.status = 'submitted' ${shopScope(sql`r.shop_id`, shopIds)})::int as pending_requisitions,
      (select count(*) from purchase_orders p
        where p.status = 'submitted'
          ${purchaseScope}
      )::int as pending_purchases,
      (select count(*) from warehouse_transfers wt
        where wt.status = 'shipped'
          ${transferScope}
      )::int as pending_transfers,
      (select count(*) from damage_reports dr
        where dr.status = 'submitted'
          ${damageScope}
      )::int as pending_damage_reports,
      (select count(*) from product_skus ps
        left join product_sku_stocks st
          on st.product_sku_id = ps.id and st.shop_id = ps.shop_id
        where ps.stock_type = 'tracked'
          and coalesce(st.quantity, 0) <= coalesce(st.min_threshold, 0)
          ${shopScope(sql`ps.shop_id`, shopIds)})::int as low_stock_shop,
      (select count(*) from warehouse_stocks ws
        join catalog_skus cs on cs.id = ws.sku_id
        where cs.stock_type = 'tracked'
          and ws.quantity - ws.reserved_qty <= ws.min_threshold
          ${warehouseScope(sql`ws.warehouse_id`, warehouseIds)})::int as low_stock_warehouse
  `);

  const inventoryPromise = db.execute(sql`
    select
      coalesce((
        select sum(ws.quantity * ws.avg_unit_cost)
          from warehouse_stocks ws
         where true ${warehouseScope(sql`ws.warehouse_id`, warehouseIds)}
      ), 0)::text as warehouse_amount,
      (select count(*) from warehouse_stocks ws
        where true ${warehouseScope(sql`ws.warehouse_id`, warehouseIds)})::int as warehouse_skus,
      coalesce((
        select sum(st.quantity * st.avg_unit_cost)
          from product_sku_stocks st
         where true ${shopScope(sql`st.shop_id`, shopIds)}
      ), 0)::text as shop_amount,
      (select count(*) from product_sku_stocks st
        where true ${shopScope(sql`st.shop_id`, shopIds)})::int as shop_skus
  `);

  const trendPromise = db.execute(sql`
    select
      to_char((o.created_at at time zone 'Asia/Shanghai')::date, 'YYYY-MM-DD') as day,
      count(*)::int as order_count,
      coalesce(sum(o.total_amount), 0)::text as sales_amount
    from orders o
    where o.created_at >= ${last7Start}
      and o.created_at < ${now}
      and ${SALES_STATUS_FILTER}
      ${orderScope}
    group by 1
    order by 1
  `);

  const topSkuPromise = db.execute(sql`
    select
      oi.product_sku_id as "skuId",
      oi.name,
      oi.spec_name as "specName",
      sum(oi.quantity)::text as quantity,
      coalesce(sum(oi.subtotal), 0)::text as amount
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.created_at >= ${last7Start}
      and o.created_at < ${now}
      and ${SALES_STATUS_FILTER}
      ${orderScope}
    group by oi.product_sku_id, oi.name, oi.spec_name
    order by sum(oi.subtotal) desc
    limit 5
  `);

  const shopRankPromise = db.execute(sql`
    select
      o.shop_id as "shopId",
      s.name as "shopName",
      count(*)::int as "orderCount",
      coalesce(sum(o.total_amount), 0)::text as "salesAmount"
    from orders o
    join shops s on s.id = o.shop_id
    where o.created_at >= ${last7Start}
      and o.created_at < ${now}
      and ${SALES_STATUS_FILTER}
      ${orderScope}
    group by o.shop_id, s.name
    order by sum(o.total_amount) desc
    limit 5
  `);

  const lossPromise = db.execute(sql`
    select
      coalesce((
        select sum(dri.amount)
          from damage_report_items dri
          join damage_reports dr on dr.id = dri.report_id
         where dr.status = 'approved'
           and dr.reviewed_at >= ${last7Start}
           and dr.reviewed_at < ${now}
           ${damageScope}
      ), 0)::text as damage_amount,
      coalesce((
        select sum(wti.loss_amount)
          from warehouse_transfer_items wti
          join warehouse_transfers wt on wt.id = wti.transfer_id
         where wt.status = 'received'
           and wt.difference_closed_at >= ${last7Start}
           and wt.difference_closed_at < ${now}
           ${transferScope}
      ), 0)::text as transfer_loss_amount
  `);

  const [salesResult, todoResult, inventoryResult, trendResult, topSkuResult, shopRankResult, lossResult] =
    await Promise.all([
      salesPromise,
      todoPromise,
      inventoryPromise,
      trendPromise,
      topSkuPromise,
      shopRankPromise,
      lossPromise
    ]);

  const salesRow = (salesResult.rows[0] ?? {}) as Record<string, unknown>;
  const todayOrders = toNumber(salesRow.today_orders);
  const todayAmount = money(salesRow.today_amount);
  const yesterdayOrders = toNumber(salesRow.yesterday_orders);
  const yesterdayAmount = money(salesRow.yesterday_amount);
  const weekOrders = toNumber(salesRow.week_orders);
  const weekAmount = money(salesRow.week_amount);
  const prevWeekOrders = toNumber(salesRow.prev_week_orders);
  const prevWeekAmount = money(salesRow.prev_week_amount);

  const todoRow = (todoResult.rows[0] ?? {}) as Record<string, unknown>;
  const inventoryRow = (inventoryResult.rows[0] ?? {}) as Record<string, unknown>;
  const lossRow = (lossResult.rows[0] ?? {}) as Record<string, unknown>;

  const trendMap = new Map(
    trendResult.rows.map((row) => [
      String((row as Record<string, unknown>).day),
      row as Record<string, unknown>
    ])
  );
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(todayStart.getTime() - (6 - index) * DAY_MS);
    const key = formatShanghaiDay(date);
    const row = trendMap.get(key);
    return {
      date: key,
      orderCount: row ? toNumber(row.order_count) : 0,
      salesAmount: row ? money(row.sales_amount) : 0
    };
  });

  const damageAmount = money(lossRow.damage_amount);
  const transferLossAmount = money(lossRow.transfer_loss_amount);
  const lossAmount = Math.round((damageAmount + transferLossAmount) * 100) / 100;

  return c.json({
    generatedAt: now.toISOString(),
    timezone: 'Asia/Shanghai',
    range: {
      todayStart: todayStart.toISOString(),
      yesterdayStart: yesterdayStart.toISOString(),
      yesterdayEnd: yesterdayEnd.toISOString(),
      last7Start: last7Start.toISOString(),
      prev7Start: prev7Start.toISOString(),
      prev7End: prev7End.toISOString(),
      now: now.toISOString()
    },
    scope: {
      allShops: shopIds === null,
      shopCount: shopIds === null ? null : shopIds.length,
      selectedShopId: requestedShopId,
      allWarehouses: warehouseIds === null,
      warehouseCount: warehouseIds === null ? null : warehouseIds.length
    },
    sales: {
      today: {
        orderCount: todayOrders,
        salesAmount: todayAmount,
        avgOrderValue: avg(todayAmount, todayOrders),
        previous: {
          orderCount: yesterdayOrders,
          salesAmount: yesterdayAmount,
          avgOrderValue: avg(yesterdayAmount, yesterdayOrders)
        },
        orderChangePct: ratio(todayOrders, yesterdayOrders),
        salesChangePct: ratio(todayAmount, yesterdayAmount)
      },
      last7: {
        orderCount: weekOrders,
        salesAmount: weekAmount,
        avgOrderValue: avg(weekAmount, weekOrders),
        previous: {
          orderCount: prevWeekOrders,
          salesAmount: prevWeekAmount,
          avgOrderValue: avg(prevWeekAmount, prevWeekOrders)
        },
        orderChangePct: ratio(weekOrders, prevWeekOrders),
        salesChangePct: ratio(weekAmount, prevWeekAmount)
      }
    },
    todos: {
      pendingOrders: toNumber(todoRow.pending_orders),
      refundPendingOrders: toNumber(todoRow.refund_pending),
      pendingRequisitions: toNumber(todoRow.pending_requisitions),
      pendingPurchases: toNumber(todoRow.pending_purchases),
      pendingTransfers: toNumber(todoRow.pending_transfers),
      pendingDamageReports: toNumber(todoRow.pending_damage_reports),
      lowStockShopSkus: toNumber(todoRow.low_stock_shop),
      lowStockWarehouseSkus: toNumber(todoRow.low_stock_warehouse)
    },
    inventory: {
      warehouseAmount: money(inventoryRow.warehouse_amount),
      warehouseSkuCount: toNumber(inventoryRow.warehouse_skus),
      shopAmount: money(inventoryRow.shop_amount),
      shopSkuCount: toNumber(inventoryRow.shop_skus),
      lowStockShopSkus: toNumber(todoRow.low_stock_shop),
      lowStockWarehouseSkus: toNumber(todoRow.low_stock_warehouse)
    },
    trend,
    topSkus: topSkuResult.rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        skuId: String(item.skuId ?? ''),
        name: String(item.name ?? ''),
        specName: item.specName ? String(item.specName) : null,
        quantity: money(item.quantity),
        amount: money(item.amount)
      };
    }),
    shopRanking: shopRankResult.rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        shopId: String(item.shopId ?? ''),
        shopName: String(item.shopName ?? ''),
        orderCount: toNumber(item.orderCount),
        salesAmount: money(item.salesAmount)
      };
    }),
    loss: {
      damageAmount,
      transferLossAmount,
      amount: lossAmount,
      salesAmount: weekAmount,
      ratioPct: weekAmount > 0 ? Math.round((lossAmount / weekAmount) * 1000) / 10 : null
    }
  });
});

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';

/**
 * 测试/演示数据清理：所有业务表的 is_test = true 行。
 * - 仅 super_admin 具备 test_data.read / test_data.cleanup
 * - 删除按外键顺序执行，全程一个事务；任何一步失败整体回滚
 * - 只删除 is_test = true（以及其子行），不会碰真实数据
 */
export const testDataRoutes = new Hono<AdminEnv>();

testDataRoutes.use('*', requireAdmin);

type CleanupStep = { key: string; label: string; query: ReturnType<typeof sql> };

const TABLE_LABELS: Array<[string, string]> = [
  ['orders', '顾客订单'],
  ['order_items', '顾客订单明细'],
  ['order_payments', '顾客订单支付'],
  ['purchase_orders', '采购单'],
  ['purchase_order_items', '采购单明细'],
  ['purchase_receipts', '入库质检单'],
  ['purchase_receipt_items', '入库质检明细'],
  ['warehouse_transfers', '分拨单'],
  ['warehouse_transfer_items', '分拨单明细'],
  ['damage_reports', '报损单'],
  ['damage_report_items', '报损单明细'],
  ['shop_requisitions', '门店要货单'],
  ['shop_requisition_items', '要货单明细'],
  ['demand_plans', '需求计划'],
  ['demand_plan_items', '需求计划明细'],
  ['stock_movements', '库存流水'],
  ['warehouse_stocks', '仓库库存'],
  ['product_sku_stocks', '门店库存'],
  ['supplier_scopes', '供应商供货范围'],
  ['suppliers', '供应商'],
  ['product_stocks', '门店商品库存（旧）'],
  ['product_skus', '门店 SKU'],
  ['products', '门店商品'],
  ['catalog_skus', '总部 SKU'],
  ['catalog_products', '总部商品'],
  ['warehouses', '仓库'],
  ['shops', '门店'],
  ['document_events', '单据事件']
];

/**
 * 删除顺序：先删子行与流水，再删主表；门店/仓库放最后。
 * 子行同时按主表归属兜底（防止历史数据未继承标记）。
 */
function buildSteps(): CleanupStep[] {
  return [
    {
      key: 'order_payments',
      label: '顾客订单支付',
      query: sql`delete from order_payments
                  where is_test
                     or order_id in (select id from orders where is_test)`
    },
    {
      key: 'order_items',
      label: '顾客订单明细',
      query: sql`delete from order_items
                  where is_test
                     or order_id in (select id from orders where is_test)`
    },
    {
      key: 'orders',
      label: '顾客订单',
      query: sql`delete from orders
                  where is_test
                     or shop_id in (select id from shops where is_test)`
    },
    {
      key: 'purchase_receipt_items',
      label: '入库质检明细',
      query: sql`delete from purchase_receipt_items
                  where is_test
                     or receipt_id in (
                       select id from purchase_receipts
                        where is_test
                           or purchase_order_id in (select id from purchase_orders where is_test)
                     )`
    },
    {
      key: 'purchase_receipts',
      label: '入库质检单',
      query: sql`delete from purchase_receipts
                  where is_test
                     or purchase_order_id in (select id from purchase_orders where is_test)`
    },
    {
      key: 'purchase_order_items',
      label: '采购单明细',
      query: sql`delete from purchase_order_items
                  where is_test
                     or purchase_order_id in (select id from purchase_orders where is_test)`
    },
    {
      key: 'purchase_orders',
      label: '采购单',
      query: sql`delete from purchase_orders
                  where is_test
                     or shop_id in (select id from shops where is_test)`
    },
    {
      key: 'warehouse_transfer_items',
      label: '分拨单明细',
      query: sql`delete from warehouse_transfer_items
                  where is_test
                     or transfer_id in (
                       select id from warehouse_transfers
                        where is_test
                           or to_shop_id in (select id from shops where is_test)
                           or from_warehouse_id in (select id from warehouses where is_test)
                     )`
    },
    {
      key: 'warehouse_transfers',
      label: '分拨单',
      query: sql`delete from warehouse_transfers
                  where is_test
                     or to_shop_id in (select id from shops where is_test)
                     or from_warehouse_id in (select id from warehouses where is_test)`
    },
    {
      key: 'damage_report_items',
      label: '报损单明细',
      query: sql`delete from damage_report_items
                  where is_test
                     or report_id in (
                       select id from damage_reports
                        where is_test
                           or shop_id in (select id from shops where is_test)
                           or warehouse_id in (select id from warehouses where is_test)
                     )`
    },
    {
      key: 'damage_reports',
      label: '报损单',
      query: sql`delete from damage_reports
                  where is_test
                     or shop_id in (select id from shops where is_test)
                     or warehouse_id in (select id from warehouses where is_test)`
    },
    {
      key: 'shop_requisition_items',
      label: '要货单明细',
      query: sql`delete from shop_requisition_items
                  where is_test
                     or requisition_id in (select id from shop_requisitions where is_test)`
    },
    {
      key: 'shop_requisitions',
      label: '门店要货单',
      query: sql`delete from shop_requisitions
                  where is_test
                     or shop_id in (select id from shops where is_test)`
    },
    {
      key: 'demand_plan_items',
      label: '需求计划明细',
      query: sql`delete from demand_plan_items
                  where is_test
                     or demand_plan_id in (select id from demand_plans where is_test)`
    },
    {
      key: 'demand_plans',
      label: '需求计划',
      query: sql`delete from demand_plans where is_test`
    },
    {
      key: 'document_events',
      label: '单据事件',
      query: sql`delete from document_events where is_test`
    },
    {
      key: 'stock_movements',
      label: '库存流水',
      query: sql`delete from stock_movements where is_test`
    },
    {
      key: 'warehouse_stocks',
      label: '仓库库存',
      query: sql`delete from warehouse_stocks
                  where is_test
                     or warehouse_id in (select id from warehouses where is_test)`
    },
    {
      key: 'product_sku_stocks',
      label: '门店库存',
      query: sql`delete from product_sku_stocks
                  where is_test
                     or shop_id in (select id from shops where is_test)`
    },
    {
      key: 'supplier_scopes',
      label: '供应商供货范围',
      query: sql`delete from supplier_scopes
                  where is_test
                     or supplier_id in (select id from suppliers where is_test)
                     or (subject_type = 'shop'
                         and subject_id in (select id from shops where is_test))
                     or (subject_type = 'warehouse'
                         and subject_id in (select id from warehouses where is_test))`
    },
    {
      key: 'suppliers',
      label: '供应商',
      query: sql`delete from suppliers where is_test`
    },
    {
      key: 'product_stocks',
      label: '门店商品库存（旧）',
      query: sql`delete from product_stocks where is_test`
    },
    {
      key: 'product_skus',
      label: '门店 SKU',
      query: sql`delete from product_skus
                  where is_test
                     or shop_id in (select id from shops where is_test)`
    },
    {
      key: 'products',
      label: '门店商品',
      // 历史冒烟数据里存在「测试商品 + 真实 SKU（被真实采购单引用）」的组合，
      // 这类商品不能级联删除，否则会连带删掉正式采购明细引用的 SKU。
      query: sql`delete from products
                  where (is_test or shop_id in (select id from shops where is_test))
                    and not exists (
                      select 1 from product_skus ps
                      where ps.product_id = products.id and not ps.is_test
                    )`
    },
    {
      key: 'catalog_skus',
      label: '总部 SKU',
      query: sql`delete from catalog_skus
                  where is_test
                    and not exists (
                      select 1 from product_skus ps
                      where ps.catalog_sku_id = catalog_skus.id and not ps.is_test
                    )`
    },
    {
      key: 'catalog_products',
      label: '总部商品',
      query: sql`delete from catalog_products
                  where is_test
                    and not exists (
                      select 1 from catalog_skus cs
                      where cs.catalog_product_id = catalog_products.id and not cs.is_test
                    )`
    },
    {
      key: 'warehouses',
      label: '仓库',
      query: sql`delete from warehouses where is_test`
    },
    {
      key: 'shops',
      label: '门店',
      query: sql`delete from shops where is_test`
    }
  ];
}

/** 预览口径与删除条件保持一致（有外键保护的表单独统计） */
const COUNT_OVERRIDES: Record<string, string> = {
  products: `select count(*)::int as count from products
             where (is_test or shop_id in (select id from shops where is_test))
               and not exists (
                 select 1 from product_skus ps
                 where ps.product_id = products.id and not ps.is_test
               )`,
  catalog_skus: `select count(*)::int as count from catalog_skus
                 where is_test
                   and not exists (
                     select 1 from product_skus ps
                     where ps.catalog_sku_id = catalog_skus.id and not ps.is_test
                   )`,
  catalog_products: `select count(*)::int as count from catalog_products
                     where is_test
                       and not exists (
                         select 1 from catalog_skus cs
                         where cs.catalog_product_id = catalog_products.id and not cs.is_test
                       )`
};

/** 预览：各表待清理条数（仅统计 is_test = true） */
testDataRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'test_data.read');
  if (denied) return denied;

  const db = await getDb();
  const tables = [];
  let total = 0;
  for (const [table, label] of TABLE_LABELS) {
    const query = COUNT_OVERRIDES[table] ?? `select count(*)::int as count from ${table} where is_test = true`;
    const result = await db.execute(sql.raw(query));
    const count = Number((result.rows[0] as { count: number } | undefined)?.count ?? 0);
    tables.push({ table, label, count });
    total += count;
  }
  return c.json({ total, tables });
});

/** 执行清理；返回各表实际删除条数 */
testDataRoutes.delete('/', async (c) => {
  const denied = await guardPermission(c, 'test_data.cleanup');
  if (denied) return denied;

  const db = await getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const tables: Array<{ table: string; label: string; count: number }> = [];
      let total = 0;
      for (const step of buildSteps()) {
        const deleted = await tx.execute(step.query);
        const count = deleted.rowCount ?? 0;
        tables.push({ table: step.key, label: step.label, count });
        total += count;
      }
      return { tables, total };
    });
    return c.json({ ok: true, ...result });
  } catch (error) {
    console.error('[sds-api] 清理测试数据失败:', error);
    return c.json(
      {
        code: 'TEST_DATA_CLEANUP_FAILED',
        message: '清理失败：存在非测试数据引用测试门店/仓库，请先处理关联数据'
      },
      409
    );
  }
});

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth';
import { guardPermission } from '../lib/admin-access';

/**
 * 后台购物车管理（只读），对应迁移 0012。
 * 与移动端读写同一份 carts / cart_items；金额按当前有效价计算。
 */
export const adminCartRoutes = new Hono<AdminEnv>();

adminCartRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function money(value: number | string | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

function buildWhere(shopId?: string, customer?: string, productName?: string) {
  const conditions = [sql`true`];
  if (shopId) conditions.push(sql`c.shop_id = ${shopId}::uuid`);
  if (customer) {
    const like = `%${customer}%`;
    conditions.push(
      sql`(coalesce(cu.nickname, '') ilike ${like}
        or coalesce(cu.real_name, '') ilike ${like}
        or coalesce(cu.phone, u.phone) ilike ${like})`
    );
  }
  if (productName) {
    conditions.push(sql`exists (
      select 1
        from cart_items x
        join products xp on xp.id = x.product_id
        left join catalog_products xcp on xcp.id = xp.catalog_product_id
       where x.cart_id = c.id
         and coalesce(xcp.name, xp.name) ilike ${`%${productName}%`}
    )`);
  }
  return sql.join(conditions, sql` and `);
}

type ListRow = {
  id: string;
  shop_id: string;
  shop_name: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  remark: string | null;
  updated_at: Date | string;
  item_count: number;
  total_amount: string;
};

adminCartRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'carts.read');
  if (denied) return denied;

  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });
  const shopId = c.req.query('shopId')?.trim() || undefined;
  const customer = c.req.query('customer')?.trim() || undefined;
  const productName = c.req.query('productName')?.trim() || undefined;
  const where = buildWhere(shopId, customer, productName);

  const db = await getDb();
  const listResult = await db.execute(sql`
    select c.id, c.shop_id, s.name as shop_name, c.customer_id,
           coalesce(cu.nickname, cu.real_name, '未填写姓名') as customer_name,
           coalesce(cu.phone, u.phone) as customer_phone,
           c.remark, c.updated_at,
           count(ci.id)::int as item_count,
           coalesce(sum(ci.quantity * coalesce(p.price, cp.default_price)), 0) as total_amount
      from carts c
      join shops s on s.id = c.shop_id
      join customers cu on cu.id = c.customer_id
      join users u on u.id = cu.user_id
      join cart_items ci on ci.cart_id = c.id
      left join products p on p.id = ci.product_id
      left join catalog_products cp on cp.id = p.catalog_product_id
     where ${where}
     group by c.id, s.name, cu.nickname, cu.real_name, cu.phone, u.phone
     order by c.updated_at desc
     limit ${pageSize} offset ${offset}
  `);

  const countResult = await db.execute(sql`
    select count(*)::int as total
      from carts c
      join customers cu on cu.id = c.customer_id
      join users u on u.id = cu.user_id
     where ${where}
  `);

  const rows = listResult.rows as unknown as ListRow[];
  const total = Number((countResult.rows[0] as { total?: number } | undefined)?.total ?? 0);

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id,
      shopName: row.shop_name,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      remark: row.remark ?? '',
      itemCount: Number(row.item_count),
      totalAmount: money(row.total_amount),
      updatedAt: new Date(row.updated_at).toISOString()
    })),
    total,
    page,
    pageSize
  });
});

type DetailRow = {
  id: string;
  shop_name: string;
  customer_name: string;
  customer_phone: string | null;
  remark: string | null;
  updated_at: Date | string;
  item_id: string | null;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  unit_price: string | null;
  quantity: number | null;
};

adminCartRoutes.get('/:id', async (c) => {
  const denied = await guardPermission(c, 'carts.read');
  if (denied) return denied;

  const db = await getDb();
  const result = await db.execute(sql`
    select c.id, s.name as shop_name,
           coalesce(cu.nickname, cu.real_name, '未填写姓名') as customer_name,
           coalesce(cu.phone, u.phone) as customer_phone,
           c.remark, c.updated_at,
           ci.id as item_id, ci.product_id,
           coalesce(cp.name, p.name) as product_name,
           coalesce(cp.unit, p.unit) as unit,
           coalesce(p.price, cp.default_price) as unit_price,
           ci.quantity
      from carts c
      join shops s on s.id = c.shop_id
      join customers cu on cu.id = c.customer_id
      join users u on u.id = cu.user_id
      left join cart_items ci on ci.cart_id = c.id
      left join products p on p.id = ci.product_id
      left join catalog_products cp on cp.id = p.catalog_product_id
     where c.id = ${c.req.param('id')}::uuid
     order by ci.created_at
  `);

  const rows = result.rows as unknown as DetailRow[];
  if (rows.length === 0) {
    return c.json({ code: 'CART_NOT_FOUND', message: '购物车不存在' }, 404);
  }

  const head = rows[0];
  const items = rows
    .filter((row) => row.item_id)
    .map((row) => {
      const quantity = Number(row.quantity ?? 0);
      const unitPrice = money(row.unit_price);
      return {
        id: row.item_id,
        productId: row.product_id,
        name: row.product_name ?? '商品已删除',
        unit: row.unit ?? '份',
        unitPrice,
        quantity,
        subtotal: money(Number(unitPrice) * quantity)
      };
    });

  return c.json({
    id: head.id,
    shopName: head.shop_name,
    customerName: head.customer_name,
    customerPhone: head.customer_phone,
    remark: head.remark ?? '',
    updatedAt: new Date(head.updated_at).toISOString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: money(items.reduce((sum, item) => sum + Number(item.subtotal), 0)),
    items
  });
});

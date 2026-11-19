import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '@sds/db';
import { resolveImageUrl } from '../lib/storage.js';

/**
 * 顾客端（移动端）接口，对应多店方案与老人下单流程 S0。
 * - 不复用 /api/admin/*，不需要后台登录态；
 * - 只返回营业中门店、门店可见分类（`shop_hidden_categories` 在此生效）、
 *   可售商品（`is_available` 且未被总部强制下架）；
 * - 价格口径：门店价优先，为空时取总部建议价；
 * - `is_test` 不参与过滤，测试数据与正式数据同口径展示。
 */
export const mobileRoutes = new Hono();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CategoryRow {
  id: string;
  parent_id: string | null;
  level: number;
  name: string;
  sort_order: number;
  icon_url: string | null;
}

interface MobileProductRow {
  id: string;
  catalogProductId: string | null;
  name: string;
  imageUrl: string | null;
  unit: string;
  price: string | null;
  categoryId: string | null;
  [key: string]: unknown;
}

interface MobileSkuRow {
  skuId: string;
  productId: string;
  specName: string;
  barcode: string | null;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  isDefault: boolean;
  price: string | null;
  stockQuantity: string;
  soldOut: boolean;
}

/** 门店可见分类：总部启用 + 未被本店隐藏；父级隐藏时子级一并视为不可见 */
async function listVisibleCategories(shopId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select c.id, c.parent_id, c.level, c.name, c.sort_order, c.icon_url
      from catalog_categories c
     where c.is_active
       and not exists (
         select 1 from shop_hidden_categories h
          where h.shop_id = ${shopId}::uuid and h.catalog_category_id = c.id
       )
       and (
         c.parent_id is null
         or (
           exists (select 1 from catalog_categories pc where pc.id = c.parent_id and pc.is_active)
           and not exists (
             select 1 from shop_hidden_categories ph
              where ph.shop_id = ${shopId}::uuid and ph.catalog_category_id = c.parent_id
           )
         )
       )
     order by c.level, c.sort_order, c.created_at
  `);
  return result.rows as unknown as CategoryRow[];
}

/** 各分类在本店的可售商品数；本地商品用 products.category_id，共享商品用总部分类 */
async function listVisibleCategoryCounts(shopId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select coalesce(cp.category_id, p.category_id) as category_id, count(*)::int as count
      from products p
      left join catalog_products cp on cp.id = p.catalog_product_id
     where p.shop_id = ${shopId}::uuid
       and p.is_available
       and not p.is_blocked
       and (p.catalog_product_id is null or cp.status = 'published')
       and coalesce(cp.category_id, p.category_id) is not null
       and exists (
         select 1
           from product_skus ps
           left join catalog_skus cs on cs.id = ps.catalog_sku_id
          where ps.product_id = p.id
            and ps.is_available
            and (ps.catalog_sku_id is null or cs.status = 'active')
       )
     group by 1
  `);
  const map = new Map<string, number>();
  for (const row of result.rows as unknown as { category_id: string; count: number }[]) {
    map.set(row.category_id, Number(row.count));
  }
  return map;
}

async function findOpenShop(shopId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select id, name, address, phone, status, cover_url as "coverUrl",
           business_hours as "businessHours", announcement,
           longitude::double precision as longitude, latitude::double precision as latitude
      from shops
     where id = ${shopId}::uuid and status = 'open'
     limit 1
  `);
  return (result.rows[0] as unknown as Record<string, unknown> | undefined) ?? null;
}

mobileRoutes.get('/shops/:shopId/home', async (c) => {
  const shopId = c.req.param('shopId');
  if (!UUID_RE.test(shopId)) {
    return c.json({ code: 'INVALID_SHOP_ID', message: '门店 ID 不合法' }, 400);
  }

  const shop = await findOpenShop(shopId);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在或未营业' }, 404);

  const [categories, countMap] = await Promise.all([
    listVisibleCategories(shopId),
    listVisibleCategoryCounts(shopId)
  ]);

  const childrenByParent = new Map<string, CategoryRow[]>();
  for (const row of categories) {
    if (!row.parent_id) continue;
    const list = childrenByParent.get(row.parent_id) ?? [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }

  const items = categories
    .filter((row) => row.level === 1)
    .map((root) => {
      const children = (childrenByParent.get(root.id) ?? []).map((child) => ({
        id: child.id,
        name: child.name,
        iconUrl: resolveImageUrl(child.icon_url),
        productCount: countMap.get(child.id) ?? 0
      }));
      const direct = countMap.get(root.id) ?? 0;
      return {
        id: root.id,
        name: root.name,
        iconUrl: resolveImageUrl(root.icon_url),
        productCount: direct + children.reduce((sum, child) => sum + child.productCount, 0),
        children
      };
    });

  return c.json({
    shop: shop ? { ...shop, coverUrl: resolveImageUrl(shop.coverUrl as string | null) } : shop,
    categories: items
  });
});

mobileRoutes.get('/shops/:shopId/products', async (c) => {
  const shopId = c.req.param('shopId');
  if (!UUID_RE.test(shopId)) {
    return c.json({ code: 'INVALID_SHOP_ID', message: '门店 ID 不合法' }, 400);
  }

  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 50) || 50));
  const offset = (page - 1) * pageSize;
  const categoryId = c.req.query('categoryId')?.trim() ?? '';

  const shop = await findOpenShop(shopId);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在或未营业' }, 404);

  const categories = await listVisibleCategories(shopId);
  let scope = categories.map((row) => row.id);

  if (categoryId) {
    if (!UUID_RE.test(categoryId)) {
      return c.json({ code: 'INVALID_CATEGORY_ID', message: '分类 ID 不合法' }, 400);
    }
    const current = categories.find((row) => row.id === categoryId);
    if (!current) {
      return c.json({ code: 'CATEGORY_NOT_VISIBLE', message: '分类不存在或该门店不可见' }, 404);
    }
    // 一级分类按「本级 + 直接子级」取商品，与首页左侧「全部」的计数口径一致
    scope =
      current.level === 1
        ? [current.id, ...categories.filter((row) => row.parent_id === current.id).map((row) => row.id)]
        : [current.id];
  }

  if (scope.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize });
  }

  const db = await getDb();
  const idList = sql.join(
    scope.map((id) => sql`${id}`),
    sql`, `
  );

  const [items, totalRows] = await Promise.all([
    db.execute(sql`
      select p.id,
             p.catalog_product_id as "catalogProductId",
             coalesce(cp.name, p.name) as name,
             coalesce(cp.image_url, p.image_url) as "imageUrl",
             coalesce(cp.unit, p.unit) as unit,
             coalesce(p.price, cp.default_price) as price,
             coalesce(cp.category_id, p.category_id) as "categoryId"
        from products p
        left join catalog_products cp on cp.id = p.catalog_product_id
       where p.shop_id = ${shopId}::uuid
         and p.is_available
         and not p.is_blocked
         and (p.catalog_product_id is null or cp.status = 'published')
         and coalesce(cp.category_id, p.category_id) in (${idList})
         and exists (
           select 1
             from product_skus ps
             left join catalog_skus cs on cs.id = ps.catalog_sku_id
            where ps.product_id = p.id
              and ps.is_available
              and (ps.catalog_sku_id is null or cs.status = 'active')
         )
       order by p.sort_order, p.created_at
       limit ${pageSize} offset ${offset}
    `),
    db.execute(sql`
      select count(*)::int as total
        from products p
        left join catalog_products cp on cp.id = p.catalog_product_id
       where p.shop_id = ${shopId}::uuid
         and p.is_available
         and not p.is_blocked
         and (p.catalog_product_id is null or cp.status = 'published')
         and coalesce(cp.category_id, p.category_id) in (${idList})
         and exists (
           select 1
             from product_skus ps
             left join catalog_skus cs on cs.id = ps.catalog_sku_id
            where ps.product_id = p.id
              and ps.is_available
              and (ps.catalog_sku_id is null or cs.status = 'active')
         )
    `)
  ]);

  const products = items.rows as unknown as MobileProductRow[];
  let skuRows: MobileSkuRow[] = [];
  if (products.length > 0) {
    const productIds = sql.join(
      products.map((product) => sql`${product.id}::uuid`),
      sql`, `
    );
    const skuResult = await db.execute(sql`
      select ps.id as "skuId",
             ps.product_id as "productId",
             ps.spec_name as "specName",
             ps.barcode,
             ps.unit,
             ps.quantity_mode as "quantityMode",
             ps.stock_type as "stockType",
             ps.is_default as "isDefault",
             coalesce(ps.price, cs.default_price, p.price) as price,
             coalesce(st.quantity, 0) as "stockQuantity",
             (ps.stock_type = 'tracked' and coalesce(st.quantity, 0) <= 0) as "soldOut"
        from product_skus ps
        join products p on p.id = ps.product_id and p.shop_id = ps.shop_id
        left join catalog_products cp on cp.id = p.catalog_product_id
        left join catalog_skus cs on cs.id = ps.catalog_sku_id
        left join product_sku_stocks st on st.product_sku_id = ps.id
       where ps.shop_id = ${shopId}::uuid
         and ps.product_id in (${productIds})
         and ps.is_available
         and p.is_available
         and not p.is_blocked
         and (p.catalog_product_id is null or cp.status = 'published')
         and (ps.catalog_sku_id is null or cs.status = 'active')
       order by ps.sort_order, ps.created_at
    `);
    skuRows = skuResult.rows as unknown as MobileSkuRow[];
  }

  const skusByProduct = new Map<string, MobileSkuRow[]>();
  for (const sku of skuRows) {
    const list = skusByProduct.get(sku.productId) ?? [];
    list.push(sku);
    skusByProduct.set(sku.productId, list);
  }

  const enriched = products.map((product) => {
    const skus = skusByProduct.get(product.id) ?? [];
    const defaultSku = skus.find((sku) => sku.isDefault) ?? skus[0] ?? null;
    const prices = skus
      .map((sku) => Number(sku.price))
      .filter((price) => Number.isFinite(price));
    const priceFrom = prices.length > 0 ? Math.min(...prices).toFixed(2) : product.price;
    const priceTo = prices.length > 0 ? Math.max(...prices).toFixed(2) : product.price;
    return {
      ...product,
      imageUrl: resolveImageUrl(product.imageUrl),
      price: defaultSku?.price ?? product.price,
      defaultSkuId: defaultSku?.skuId ?? null,
      priceFrom,
      priceTo,
      soldOut: skus.length === 0 || skus.every((sku) => sku.soldOut),
      skus
    };
  });

  return c.json({
    items: enriched,
    total: Number((totalRows.rows[0] as unknown as { total: number } | undefined)?.total ?? 0),
    page,
    pageSize
  });
});

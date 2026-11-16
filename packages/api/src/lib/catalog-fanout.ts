import { sql } from 'drizzle-orm';
import { getDb } from '@sds/db';

type Database = Awaited<ReturnType<typeof getDb>>;

function uuidList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
}

/**
 * 把已发布总部商品铺到单个门店，并同步总部 SKU + 0 库存行。
 * 只补缺，不覆盖门店已改的价格/上下架/排序/库存。
 */
export async function fanOutCatalogProductsToShop(
  db: Database,
  shopId: string,
  categoryScope: string[] | null
) {
  const categoryFilter =
    categoryScope && categoryScope.length > 0
      ? sql`and cp.category_id in (${uuidList(categoryScope)})`
      : sql``;

  const products = await db.execute(sql`
    insert into products
      (shop_id, catalog_product_id, name, description, image_url, unit, stock_type,
       is_available, sort_order, is_test)
    select ${shopId}::uuid, cp.id, cp.name, cp.description, cp.image_url, cp.unit,
           cp.stock_type, true, 0, cp.is_test
      from catalog_products cp
     where cp.status = 'published' ${categoryFilter}
    on conflict (shop_id, catalog_product_id) where catalog_product_id is not null do nothing
    returning id
  `);

  const skus = await db.execute(sql`
    insert into product_skus
      (shop_id, product_id, catalog_sku_id, spec_name, barcode, unit, price,
       stock_type, quantity_mode, is_available, is_default, sort_order)
    select p.shop_id, p.id, cs.id, cs.spec_name, cs.barcode, cs.unit, null,
           cs.stock_type, cs.quantity_mode, true, cs.is_default, cs.sort_order
      from products p
      join catalog_products cp on cp.id = p.catalog_product_id
      join catalog_skus cs on cs.catalog_product_id = cp.id and cs.status = 'active'
     where p.shop_id = ${shopId}::uuid
       and cp.status = 'published' ${categoryFilter}
    on conflict (shop_id, catalog_sku_id) where catalog_sku_id is not null do nothing
    returning id
  `);

  await db.execute(sql`
    insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
    select ps.id, ps.shop_id, 0, 0
      from product_skus ps
      join products p on p.id = ps.product_id
      join catalog_products cp on cp.id = p.catalog_product_id
     where ps.shop_id = ${shopId}::uuid
       and cp.status = 'published' ${categoryFilter}
       and ps.stock_type = 'tracked'
    on conflict (product_sku_id) do nothing
  `);

  return {
    importedProducts: products.rowCount ?? 0,
    createdSkus: skus.rowCount ?? 0
  };
}

/**
 * 发布总部商品后，铺到所有门店；同时同步 SKU + 0 库存行。
 */
export async function fanOutCatalogProductsToAllShops(
  db: Database,
  catalogProductIds: string[]
) {
  if (catalogProductIds.length === 0) {
    return { attachedRows: 0, attachedShops: 0, createdSkus: 0 };
  }
  const productFilter = sql`cp.id in (${uuidList(catalogProductIds)})`;

  const products = await db.execute(sql`
    insert into products
      (shop_id, catalog_product_id, name, description, image_url, unit, stock_type,
       is_available, sort_order, is_test)
    select s.id, cp.id, cp.name, cp.description, cp.image_url, cp.unit,
           cp.stock_type, true, 0, cp.is_test
      from shops s
      cross join catalog_products cp
     where cp.status = 'published' and ${productFilter}
    on conflict (shop_id, catalog_product_id) where catalog_product_id is not null do nothing
    returning shop_id
  `);

  const skus = await db.execute(sql`
    insert into product_skus
      (shop_id, product_id, catalog_sku_id, spec_name, barcode, unit, price,
       stock_type, quantity_mode, is_available, is_default, sort_order)
    select p.shop_id, p.id, cs.id, cs.spec_name, cs.barcode, cs.unit, null,
           cs.stock_type, cs.quantity_mode, true, cs.is_default, cs.sort_order
      from products p
      join catalog_products cp on cp.id = p.catalog_product_id
      join catalog_skus cs on cs.catalog_product_id = cp.id and cs.status = 'active'
     where ${productFilter}
    on conflict (shop_id, catalog_sku_id) where catalog_sku_id is not null do nothing
    returning id
  `);

  await db.execute(sql`
    insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
    select ps.id, ps.shop_id, 0, 0
      from product_skus ps
      join products p on p.id = ps.product_id
      join catalog_products cp on cp.id = p.catalog_product_id
     where ${productFilter}
       and ps.stock_type = 'tracked'
    on conflict (product_sku_id) do nothing
  `);

  const shopIds = new Set(
    (products.rows as unknown as { shop_id: string }[]).map((row) => row.shop_id)
  );
  return {
    attachedRows: products.rowCount ?? 0,
    attachedShops: shopIds.size,
    createdSkus: skus.rowCount ?? 0
  };
}

/**
 * 总部新增规格后补到已有门店商品。
 * 默认下架，等运营确认后再上架，避免 C 端突然出现新规格。
 */
export async function fanOutNewCatalogSku(
  db: Database,
  catalogSkuId: string,
  available = false
) {
  const skus = await db.execute(sql`
    insert into product_skus
      (shop_id, product_id, catalog_sku_id, spec_name, barcode, unit, price,
       stock_type, quantity_mode, is_available, is_default, sort_order)
    select p.shop_id, p.id, cs.id, cs.spec_name, cs.barcode, cs.unit, null,
           cs.stock_type, cs.quantity_mode, ${available}, false, cs.sort_order
      from catalog_skus cs
      join catalog_products cp on cp.id = cs.catalog_product_id and cp.status = 'published'
      join products p on p.catalog_product_id = cp.id
     where cs.id = ${catalogSkuId}::uuid
    on conflict (shop_id, catalog_sku_id) where catalog_sku_id is not null do nothing
    returning id
  `);

  await db.execute(sql`
    insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
    select ps.id, ps.shop_id, 0, 0
      from product_skus ps
     where ps.catalog_sku_id = ${catalogSkuId}::uuid
       and ps.stock_type = 'tracked'
    on conflict (product_sku_id) do nothing
  `);

  return { createdSkus: skus.rowCount ?? 0 };
}

/**
 * 总部修改共享规格字段后，同步到所有门店 SKU；追踪方式变为 tracked 时补 0 库存行。
 * 数量模式从 decimal_2 改为 integer 的校验由调用方先行完成。
 */
export async function syncCatalogSkuToShopSkus(db: Database, catalogSkuId: string) {
  const updated = await db.execute(sql`
    update product_skus ps
       set spec_name = cs.spec_name,
           barcode = cs.barcode,
           unit = cs.unit,
           stock_type = cs.stock_type,
           quantity_mode = cs.quantity_mode,
           updated_at = now()
      from catalog_skus cs
     where ps.catalog_sku_id = cs.id
       and cs.id = ${catalogSkuId}::uuid
    returning ps.id
  `);

  await db.execute(sql`
    insert into product_sku_stocks (product_sku_id, shop_id, quantity, min_threshold)
    select ps.id, ps.shop_id, 0, 0
      from product_skus ps
     where ps.catalog_sku_id = ${catalogSkuId}::uuid
       and ps.stock_type = 'tracked'
    on conflict (product_sku_id) do nothing
  `);

  return { updatedSkus: updated.rowCount ?? 0 };
}

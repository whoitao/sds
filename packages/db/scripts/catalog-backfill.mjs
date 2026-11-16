#!/usr/bin/env node
/**
 * P2 数据合并：把各门店现有分类树合并为总部共享树（catalog_categories），
 * 并把门店商品按「名称 + 单位」关联到总部商品（catalog_products）。
 *
 * 用法：
 *   node packages/db/scripts/catalog-backfill.mjs           # dry-run，只打印计划，最后回滚
 *   node packages/db/scripts/catalog-backfill.mjs --apply   # 真正写入
 *
 * 口径：
 * - 分类按「完整路径名」合并：顶级按 name，子级按「父名/子名」；跨店同名即视为同一分类；
 * - 商品只做关联，不改门店行字段：仅写 products.catalog_product_id；
 * - 新建的总部商品一律 draft（门店不可见），需在总部商品库确认后发布；
 * - 只关联不改名：名称或单位不一致的商品保持本地独有（catalog_product_id 为空）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const APPLY = process.argv.includes('--apply');

function loadRootEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      /* 走下面的兜底解析 */
    }
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL（根目录 .env）');
  process.exit(1);
}

const log = (...args) => console.log(...args);

async function findCategory(client, parentId, name) {
  const { rows } = await client.query(
    `select id from catalog_categories
      where name = $1 and parent_id is not distinct from $2
      limit 1`,
    [name, parentId]
  );
  return rows[0]?.id ?? null;
}

async function ensureCategory(client, parentId, name, sortOrder, iconUrl, stats) {
  const existing = await findCategory(client, parentId, name);
  if (existing) return existing;
  const { rows } = await client.query(
    `insert into catalog_categories (parent_id, level, name, sort_order, icon_url)
     values ($1, $2, $3, $4, $5) returning id`,
    [parentId, parentId ? 2 : 1, name, sortOrder, iconUrl]
  );
  stats.created.push(parentId ? { level: 2, name } : { level: 1, name });
  return rows[0].id;
}

async function findCatalogProduct(client, name, unit) {
  const { rows } = await client.query(
    `select id, default_price from catalog_products where name = $1 and unit = $2 limit 1`,
    [name, unit]
  );
  return rows[0] ?? null;
}

async function run(client) {
  const stats = {
    shops: 0,
    shopCategories: 0,
    created: [],
    products: 0,
    linked: 0,
    reused: 0,
    createdCatalogProducts: 0,
    localOnly: [],
    priceDiffs: [],
    categoryUnmapped: []
  };

  const { rows: shops } = await client.query('select id, name from shops order by created_at');
  stats.shops = shops.length;

  // ---------- 1. 分类：按路径名合并 ----------
  const { rows: shopCategories } = await client.query(
    `select c.id, c.shop_id, c.parent_id, c.name, c.sort_order, c.icon_url,
            p.name as parent_name
       from categories c
       left join categories p on p.id = c.parent_id
      order by c.level, c.sort_order, c.created_at`
  );
  stats.shopCategories = shopCategories.length;

  const topIdByName = new Map();
  const childKeyToId = new Map();

  for (const row of shopCategories.filter((item) => item.parent_id === null)) {
    if (!topIdByName.has(row.name)) {
      const id = await ensureCategory(client, null, row.name, row.sort_order, row.icon_url, stats);
      topIdByName.set(row.name, id);
    }
  }

  for (const row of shopCategories.filter((item) => item.parent_id !== null)) {
    const parentId = topIdByName.get(row.parent_name);
    if (!parentId) {
      stats.categoryUnmapped.push(`${row.name}（父级「${row.parent_name}」缺失）`);
      continue;
    }
    const key = `${row.parent_name}/${row.name}`;
    if (!childKeyToId.has(key)) {
      const id = await ensureCategory(client, parentId, row.name, row.sort_order, row.icon_url, stats);
      childKeyToId.set(key, id);
    }
  }

  // ---------- 2. 商品：按 名称 + 单位 关联总部商品 ----------
  const { rows: shopProducts } = await client.query(
    `select p.id, p.shop_id, p.name, p.unit, p.price, p.description, p.image_url,
            p.stock_type, coalesce(pc.name, '') as parent_name, coalesce(c.name, '') as category_name
       from products p
       left join categories c on c.id = p.category_id
       left join categories pc on pc.id = c.parent_id
      where p.catalog_product_id is null
      order by p.created_at`
  );
  stats.products = shopProducts.length;

  for (const product of shopProducts) {
    let catalog = await findCatalogProduct(client, product.name, product.unit);
    if (catalog) {
      stats.reused += 1;
      if (Number(catalog.default_price) !== Number(product.price)) {
        stats.priceDiffs.push(
          `${product.name}（${product.unit}）：总部 ¥${catalog.default_price} / 门店记录 ¥${product.price}，门店价将保留`
        );
      }
    } else {
      const catalogCategoryId = product.category_name
        ? childKeyToId.get(`${product.parent_name}/${product.category_name}`) ??
          (product.parent_name
            ? topIdByName.get(product.parent_name) ?? null
            : topIdByName.get(product.category_name) ?? null)
        : null;
      const { rows } = await client.query(
        `insert into catalog_products
           (category_id, name, description, image_url, unit, default_price, stock_type, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'draft')
         returning id, default_price`,
        [
          catalogCategoryId,
          product.name,
          product.description,
          product.image_url,
          product.unit,
          product.price,
          product.stock_type
        ]
      );
      catalog = rows[0];
      stats.createdCatalogProducts += 1;
    }

    await client.query(
      `update products set catalog_product_id = $1, updated_at = now() where id = $2`,
      [catalog.id, product.id]
    );
    stats.linked += 1;
  }

  const { rows: localRows } = await client.query(
    `select s.name as shop_name, p.name from products p
       join shops s on s.id = p.shop_id
      where p.catalog_product_id is null
      order by s.name, p.name`
  );
  stats.localOnly = localRows.map((row) => `${row.shop_name} / ${row.name}`);

  return stats;
}

function printReport(stats) {
  log('\n== 分类合并 ==');
  log(`门店数 ${stats.shops}，门店分类行 ${stats.shopCategories}`);
  const topNames = stats.created.filter((item) => item.level === 1).map((item) => item.name);
  const childCount = stats.created.filter((item) => item.level === 2).length;
  log(`新建总部一级分类：${topNames.join('、') || '无'}`);
  log(`新建总部二级分类：${childCount} 个`);

  log('\n== 商品关联 ==');
  log(`门店商品行 ${stats.products}，已关联 ${stats.linked}`);
  log(`复用已有总部商品 ${stats.reused}，新建总部商品 ${stats.createdCatalogProducts}（均为 draft）`);

  log('\n== 需人工确认 ==');
  if (stats.categoryUnmapped.length === 0) log('- 分类映射：无异常');
  else stats.categoryUnmapped.forEach((item) => log(`- 分类未映射：${item}`));

  if (stats.priceDiffs.length === 0) log('- 价格差异：无');
  else stats.priceDiffs.forEach((item) => log(`- 价格差异：${item}`));

  if (stats.localOnly.length === 0) log('- 保持本地独有的商品：无');
  else stats.localOnly.forEach((item) => log(`- 本地独有：${item}`));
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

await client.connect();
try {
  await client.query('BEGIN');
  const stats = await run(client);
  printReport(stats);
  if (APPLY) {
    await client.query('COMMIT');
    log('\n已提交写入。新建的总部商品为 draft，需在总部商品库发布后门店才可见。');
  } else {
    await client.query('ROLLBACK');
    log('\n[dry-run] 已回滚，未写入。确认无误后加 --apply 执行。');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('执行失败，已回滚：', error);
  process.exitCode = 1;
} finally {
  await client.end();
}

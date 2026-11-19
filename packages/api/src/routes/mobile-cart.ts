import { Hono, type Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  cartItems,
  carts,
  catalogProducts,
  catalogSkus,
  getDb,
  productSkuStocks,
  productSkus,
  products
} from '@sds/db';
import { findCustomerSession, tokenFromHeader } from '../lib/customer-session.js';
import { normalizeQuantity, quantityNumber, type QuantityMode } from '../lib/quantity.js';
import { resolveImageUrl } from '../lib/storage.js';

/**
 * 顾客购物车，绑定登录顾客（Bearer 会话）。
 * - 一车一店：carts(customer_id, shop_id) 唯一，跨店商品各成一组；
 * - 条目按 SKU 存储，单价/小计读取时按当前有效价计算；
 * - 数量按 SKU 的 integer / decimal_2 模式校验；
 * - 清空或删到 0 条时删除 carts 行。
 */
export const cartRoutes = new Hono();

const quantityInput = z.union([z.string(), z.number()]);

const addItemSchema = z
  .object({
    skuId: z.uuid('SKU ID 不合法').optional(),
    productId: z.uuid('商品 ID 不合法').optional(),
    quantity: quantityInput.default('1')
  })
  .refine((value) => Boolean(value.skuId || value.productId), 'skuId 或 productId 必填');

const updateItemSchema = z.object({ quantity: quantityInput });

const remarkSchema = z.object({ shopId: z.uuid(), remark: z.string().max(200) });

const MAX_QUANTITY_CENTS = 999999;

type CartSku = {
  id: string;
  shopId: string;
  productId: string;
  quantityMode: QuantityMode;
  stockType: 'tracked' | 'untracked';
  stockQuantity: string;
  skuAvailable: boolean;
  productAvailable: boolean;
  productBlocked: boolean;
  catalogStatus: string | null;
  catalogProductStatus: string | null;
};

type CartRow = {
  cart_id: string;
  shop_id: string;
  shop_name: string;
  remark: string | null;
  updated_at: Date | string;
  item_id: string | null;
  product_id: string | null;
  product_sku_id: string | null;
  quantity: string | null;
  name: string | null;
  image_url: string | null;
  unit: string | null;
  spec_name: string | null;
  quantity_mode: QuantityMode | null;
  stock_type: 'tracked' | 'untracked' | null;
  stock_quantity: string | null;
  unit_price: string | null;
  sku_available: boolean | null;
  product_available: boolean | null;
  product_blocked: boolean | null;
  catalog_status: string | null;
  catalog_product_status: string | null;
};

class CartError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 404 | 409 = 400
  ) {
    super(message);
  }
}

function money(value: number | string | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

function cents(value: string | number | null | undefined) {
  return Math.round(quantityNumber(value) * 100);
}

function ensureSkuBuyable(sku: CartSku) {
  if (
    !sku.skuAvailable ||
    !sku.productAvailable ||
    sku.productBlocked ||
    (sku.catalogStatus && sku.catalogStatus !== 'active') ||
    (sku.catalogProductStatus && sku.catalogProductStatus !== 'published')
  ) {
    throw new CartError('SKU_UNAVAILABLE', '该规格暂时不能购买', 400);
  }
}

async function resolveCustomer(c: Context) {
  const token = tokenFromHeader(c.req.header('authorization'));
  return findCustomerSession(token);
}

async function resolveCartSku(skuId?: string, productId?: string) {
  const db = await getDb();
  const condition = skuId
    ? sql`ps.id = ${skuId}::uuid`
    : sql`ps.product_id = ${productId}::uuid`;
  const result = await db.execute(sql`
    select ps.id,
           ps.shop_id as "shopId",
           ps.product_id as "productId",
           ps.quantity_mode as "quantityMode",
           ps.stock_type as "stockType",
           ps.is_available as "skuAvailable",
           coalesce(st.quantity, 0) as "stockQuantity",
           p.is_available as "productAvailable",
           p.is_blocked as "productBlocked",
           cs.status as "catalogStatus",
           cp.status as "catalogProductStatus"
      from product_skus ps
      join products p on p.id = ps.product_id and p.shop_id = ps.shop_id
      left join catalog_skus cs on cs.id = ps.catalog_sku_id
      left join catalog_products cp on cp.id = p.catalog_product_id
      left join product_sku_stocks st on st.product_sku_id = ps.id
     where ${condition}
     order by ps.is_default desc, ps.sort_order, ps.created_at
     limit 1
  `);
  return (result.rows[0] as unknown as CartSku | undefined) ?? null;
}

async function buildPayload(customerId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select c.id as cart_id, c.shop_id, s.name as shop_name, c.remark, c.updated_at,
           ci.id as item_id, ci.product_id, ci.product_sku_id, ci.quantity,
           coalesce(cp.name, p.name) as name,
           coalesce(cp.image_url, p.image_url) as image_url,
           coalesce(ps.unit, cp.unit, p.unit) as unit,
           ps.spec_name,
           ps.quantity_mode,
           ps.stock_type,
           ps.is_available as sku_available,
           p.is_available as product_available,
           p.is_blocked as product_blocked,
           cs.status as catalog_status,
           cp.status as catalog_product_status,
           coalesce(st.quantity, 0) as stock_quantity,
           coalesce(ps.price, cs.default_price, p.price) as unit_price
      from carts c
      join shops s on s.id = c.shop_id
      left join cart_items ci on ci.cart_id = c.id
      left join product_skus ps on ps.id = ci.product_sku_id
      left join products p on p.id = ci.product_id
      left join catalog_products cp on cp.id = p.catalog_product_id
      left join catalog_skus cs on cs.id = ps.catalog_sku_id
      left join product_sku_stocks st on st.product_sku_id = ps.id
     where c.customer_id = ${customerId}::uuid
     order by c.updated_at desc, ci.created_at
  `);
  const rows = result.rows as unknown as CartRow[];

  const groups = new Map<
    string,
    {
      id: string;
      shopId: string;
      shopName: string;
      remark: string;
      updatedAt: string;
      itemCount: number;
      totalAmount: string;
      items: {
        id: string;
        productId: string;
        skuId: string;
        specName: string | null;
        name: string;
        imageUrl: string | null;
        unit: string;
        unitPrice: string;
        quantity: number;
        quantityText: string;
        quantityMode: QuantityMode;
        stockQuantity: number;
        soldOut: boolean;
        /** 已下架：门店停售、总部强制下架或目录规格非 active，与售罄分开标记 */
        offShelf: boolean;
        subtotal: string;
      }[];
    }
  >();

  for (const row of rows) {
    let group = groups.get(row.cart_id);
    if (!group) {
      group = {
        id: row.cart_id,
        shopId: row.shop_id,
        shopName: row.shop_name,
        remark: row.remark ?? '',
        updatedAt: new Date(row.updated_at).toISOString(),
        itemCount: 0,
        totalAmount: '0.00',
        items: []
      };
      groups.set(row.cart_id, group);
    }
    if (!row.item_id || !row.product_id || !row.product_sku_id) continue;

    const quantity = quantityNumber(row.quantity);
    const unitPrice = money(row.unit_price);
    const quantityMode = row.quantity_mode ?? 'integer';
    const stockQuantity = quantityNumber(row.stock_quantity);
    // 与下单校验（ensureBuyable）保持同一口径：任一可用性标记不通过即视为已下架
    const offShelf =
      !row.sku_available ||
      !row.product_available ||
      row.product_blocked === true ||
      (row.catalog_status !== null && row.catalog_status !== 'active') ||
      (row.catalog_product_status !== null && row.catalog_product_status !== 'published');
    group.items.push({
      id: row.item_id,
      productId: row.product_id,
      skuId: row.product_sku_id,
      specName: row.spec_name,
      name: row.name ?? '商品已下架',
      imageUrl: resolveImageUrl(row.image_url),
      unit: row.unit ?? '份',
      unitPrice,
      quantity,
      quantityText: Number(row.quantity ?? 0).toFixed(2),
      quantityMode,
      stockQuantity,
      soldOut: row.stock_type === 'tracked' && stockQuantity <= 0,
      offShelf,
      subtotal: money(Number(unitPrice) * quantity)
    });
    group.itemCount += quantity;
    group.totalAmount = money(Number(group.totalAmount) + Number(unitPrice) * quantity);
  }

  const list = [...groups.values()];
  return {
    carts: list,
    itemCount: list.reduce((sum, group) => sum + group.itemCount, 0),
    totalAmount: money(list.reduce((sum, group) => sum + Number(group.totalAmount), 0))
  };
}

/** 删除条目；车内已无条目时连同 carts 行一起删除 */
async function deleteItemAndMaybeCart(cartId: string, itemId: string) {
  const db = await getDb();
  await db.delete(cartItems).where(eq(cartItems.id, itemId));
  const remaining = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  if (Number(remaining[0]?.count ?? 0) === 0) {
    await db.delete(carts).where(eq(carts.id, cartId));
  } else {
    await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  }
}

cartRoutes.get('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);
  return c.json(await buildPayload(session.customerId));
});

cartRoutes.post('/items', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = addItemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '商品或数量不合法' },
      400
    );
  }
  const { skuId, productId } = parsed.data;

  const sku = await resolveCartSku(skuId, productId);
  if (!sku) return c.json({ code: 'SKU_NOT_FOUND', message: '商品规格不存在' }, 404);
  try {
    ensureSkuBuyable(sku);
  } catch (error) {
    if (error instanceof CartError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }

  const quantity = normalizeQuantity(parsed.data.quantity, sku.quantityMode);
  if (quantity === null || Number(quantity) <= 0) {
    return c.json(
      { code: 'INVALID_QUANTITY_PRECISION', message: '数量不符合该规格的计量方式' },
      400
    );
  }
  if (cents(quantity) > MAX_QUANTITY_CENTS) {
    return c.json({ code: 'CART_QUANTITY_LIMIT', message: '单个规格数量过大' }, 400);
  }

  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      let [cart] = await tx
        .select()
        .from(carts)
        .where(and(eq(carts.customerId, session.customerId), eq(carts.shopId, sku.shopId)))
        .limit(1);
      if (!cart) {
        [cart] = await tx
          .insert(carts)
          .values({ customerId: session.customerId, shopId: sku.shopId })
          .returning();
      }

      const [existing] = await tx
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(
          and(eq(cartItems.cartId, cart.id), eq(cartItems.productSkuId, sku.id))
        )
        .limit(1);
      const nextCents = cents(existing?.quantity) + cents(quantity);
      if (nextCents > MAX_QUANTITY_CENTS) {
        throw new CartError('CART_QUANTITY_LIMIT', '单个规格数量过大', 400);
      }
      if (sku.stockType === 'tracked' && nextCents > cents(sku.stockQuantity)) {
        throw new CartError('STOCK_INSUFFICIENT', '库存不足', 409);
      }

      await tx
        .insert(cartItems)
        .values({
          cartId: cart.id,
          productId: sku.productId,
          productSkuId: sku.id,
          quantity: (nextCents / 100).toFixed(2)
        })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productSkuId],
          set: {
            productId: sku.productId,
            quantity: (nextCents / 100).toFixed(2),
            updatedAt: new Date()
          }
        });
      await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    });
  } catch (error) {
    if (error instanceof CartError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }

  return c.json(await buildPayload(session.customerId));
});

cartRoutes.patch('/items/:itemId', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = updateItemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_INPUT', message: '数量不合法' }, 400);
  }

  const db = await getDb();
  const [row] = await db
    .select({
      itemId: cartItems.id,
      cartId: cartItems.cartId,
      customerId: carts.customerId,
      skuId: productSkus.id,
      quantityMode: productSkus.quantityMode,
      stockType: productSkus.stockType,
      stockQuantity: productSkuStocks.quantity,
      skuAvailable: productSkus.isAvailable,
      productAvailable: products.isAvailable,
      productBlocked: products.isBlocked,
      catalogStatus: catalogSkus.status,
      catalogProductStatus: catalogProducts.status
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .innerJoin(productSkus, eq(productSkus.id, cartItems.productSkuId))
    .innerJoin(products, eq(products.id, productSkus.productId))
    .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
    .leftJoin(catalogProducts, eq(catalogProducts.id, products.catalogProductId))
    .leftJoin(productSkuStocks, eq(productSkuStocks.productSkuId, productSkus.id))
    .where(eq(cartItems.id, c.req.param('itemId')))
    .limit(1);

  if (!row || row.customerId !== session.customerId) {
    return c.json({ code: 'ITEM_NOT_FOUND', message: '购物车条目不存在' }, 404);
  }

  const quantity = normalizeQuantity(parsed.data.quantity, row.quantityMode);
  if (quantity === null) {
    return c.json(
      { code: 'INVALID_QUANTITY_PRECISION', message: '数量不符合该规格的计量方式' },
      400
    );
  }

  if (Number(quantity) === 0) {
    await deleteItemAndMaybeCart(row.cartId, row.itemId);
    return c.json(await buildPayload(session.customerId));
  }

  if (cents(quantity) > MAX_QUANTITY_CENTS) {
    return c.json({ code: 'CART_QUANTITY_LIMIT', message: '单个规格数量过大' }, 400);
  }
  if (
    !row.skuAvailable ||
    !row.productAvailable ||
    row.productBlocked ||
    (row.catalogStatus && row.catalogStatus !== 'active') ||
    (row.catalogProductStatus && row.catalogProductStatus !== 'published')
  ) {
    return c.json({ code: 'SKU_UNAVAILABLE', message: '该规格暂时不能购买' }, 400);
  }
  if (row.stockType === 'tracked' && cents(quantity) > cents(row.stockQuantity)) {
    return c.json({ code: 'STOCK_INSUFFICIENT', message: '库存不足' }, 409);
  }

  await db
    .update(cartItems)
    .set({ quantity, updatedAt: new Date() })
    .where(eq(cartItems.id, row.itemId));
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, row.cartId));

  return c.json(await buildPayload(session.customerId));
});

cartRoutes.delete('/items/:itemId', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const db = await getDb();
  const [row] = await db
    .select({ itemId: cartItems.id, cartId: cartItems.cartId, customerId: carts.customerId })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(eq(cartItems.id, c.req.param('itemId')))
    .limit(1);

  if (!row || row.customerId !== session.customerId) {
    return c.json({ code: 'ITEM_NOT_FOUND', message: '购物车条目不存在' }, 404);
  }

  await deleteItemAndMaybeCart(row.cartId, row.itemId);
  return c.json(await buildPayload(session.customerId));
});

cartRoutes.delete('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const shopId = c.req.query('shopId');
  if (!shopId) return c.json({ code: 'INVALID_INPUT', message: '缺少门店参数' }, 400);

  const db = await getDb();
  await db
    .delete(carts)
    .where(and(eq(carts.customerId, session.customerId), eq(carts.shopId, shopId)));
  return c.json(await buildPayload(session.customerId));
});

cartRoutes.patch('/remark', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = remarkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_INPUT', message: '备注不合法' }, 400);
  }

  const db = await getDb();
  const updated = await db
    .update(carts)
    .set({ remark: parsed.data.remark.trim() || null, updatedAt: new Date() })
    .where(
      and(eq(carts.customerId, session.customerId), eq(carts.shopId, parsed.data.shopId))
    )
    .returning({ id: carts.id });

  if (updated.length === 0) {
    return c.json({ code: 'CART_NOT_FOUND', message: '购物车不存在' }, 404);
  }

  return c.json(await buildPayload(session.customerId));
});

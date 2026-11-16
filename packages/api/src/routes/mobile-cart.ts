import { Hono, type Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { cartItems, carts, getDb, products } from '@sds/db';
import { findCustomerSession, tokenFromHeader } from '../lib/customer-session';

/**
 * 顾客购物车，绑定登录顾客（Bearer 会话）。
 * - 一车一店：carts(customer_id, shop_id) 唯一，跨店商品各成一组；
 * - 条目只存 product_id + quantity，单价/小计按当前有效价读取；
 * - 清空或删到 0 条时删除 carts 行。
 */
export const cartRoutes = new Hono();

const addItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1)
});

const updateItemSchema = z.object({ quantity: z.number().int().min(0).max(99) });

const remarkSchema = z.object({ shopId: z.string().uuid(), remark: z.string().max(200) });

type CartRow = {
  cart_id: string;
  shop_id: string;
  shop_name: string;
  remark: string | null;
  updated_at: Date | string;
  item_id: string | null;
  product_id: string | null;
  quantity: number | null;
  name: string | null;
  image_url: string | null;
  unit: string | null;
  unit_price: string | null;
};

function money(value: number | string | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

async function resolveCustomer(c: Context) {
  const token = tokenFromHeader(c.req.header('authorization'));
  return findCustomerSession(token);
}

async function buildPayload(customerId: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    select c.id as cart_id, c.shop_id, s.name as shop_name, c.remark, c.updated_at,
           ci.id as item_id, ci.product_id, ci.quantity,
           coalesce(cp.name, p.name) as name,
           coalesce(cp.image_url, p.image_url) as image_url,
           coalesce(cp.unit, p.unit) as unit,
           coalesce(p.price, cp.default_price) as unit_price
      from carts c
      join shops s on s.id = c.shop_id
      left join cart_items ci on ci.cart_id = c.id
      left join products p on p.id = ci.product_id
      left join catalog_products cp on cp.id = p.catalog_product_id
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
        name: string;
        imageUrl: string | null;
        unit: string;
        unitPrice: string;
        quantity: number;
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
    if (!row.item_id || !row.product_id) continue;
    const quantity = Number(row.quantity ?? 0);
    const unitPrice = money(row.unit_price);
    group.items.push({
      id: row.item_id,
      productId: row.product_id,
      name: row.name ?? '商品已下架',
      imageUrl: row.image_url,
      unit: row.unit ?? '份',
      unitPrice,
      quantity,
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

  const body = await c.req.json().catch(() => null);
  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_INPUT', message: '商品或数量不合法' }, 400);
  }
  const { productId, quantity } = parsed.data;

  const db = await getDb();
  const [product] = await db
    .select({
      id: products.id,
      shopId: products.shopId,
      isAvailable: products.isAvailable,
      isBlocked: products.isBlocked
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product || !product.isAvailable || product.isBlocked) {
    return c.json({ code: 'PRODUCT_UNAVAILABLE', message: '该商品暂时不能购买' }, 400);
  }

  await db.transaction(async (tx) => {
    let [cart] = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.customerId, session.customerId), eq(carts.shopId, product.shopId)))
      .limit(1);
    if (!cart) {
      [cart] = await tx
        .insert(carts)
        .values({ customerId: session.customerId, shopId: product.shopId })
        .returning();
    }
    await tx
      .insert(cartItems)
      .values({ cartId: cart.id, productId, quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.productId],
        set: {
          quantity: sql`${cartItems.quantity} + ${quantity}`,
          updatedAt: new Date()
        }
      });
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
  });

  return c.json(await buildPayload(session.customerId));
});

cartRoutes.patch('/items/:itemId', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_INPUT', message: '数量不合法' }, 400);
  }

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

  if (parsed.data.quantity === 0) {
    await deleteItemAndMaybeCart(row.cartId, row.itemId);
  } else {
    await db
      .update(cartItems)
      .set({ quantity: parsed.data.quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, row.itemId));
    await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, row.cartId));
  }

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

  const body = await c.req.json().catch(() => null);
  const parsed = remarkSchema.safeParse(body);
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

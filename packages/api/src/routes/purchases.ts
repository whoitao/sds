import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  getDb,
  productSkuStocks,
  productSkus,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import {
  addMoney,
  inferQuantityMode,
  normalizeQuantity,
  roundAmount,
  type QuantityMode
} from '../lib/quantity.js';

/** 平台运营侧供应商、采购单与收货入库 */
export const purchaseRoutes = new Hono<AdminEnv>();

purchaseRoutes.use('*', requireAdmin);

function parsePaging(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

class PurchaseError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 403 | 404 | 409 = 409
  ) {
    super(message);
  }
}

function generatePoNo() {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PO${time}${random}`.slice(0, 32);
}

function parseExpectedAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PurchaseError('INVALID_EXPECTED_AT', '预计到货时间格式不合法', 400);
  }
  return date;
}

const supplierSchema = z.object({
  shopId: z.uuid('店铺 ID 不合法'),
  name: z.string().trim().min(1, '供应商名称必填').max(100),
  contactName: z.string().trim().max(50).nullish(),
  phone: z.string().trim().max(30).nullish(),
  remark: z.string().trim().max(500).nullish()
});

const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    contactName: z.string().trim().max(50).nullish(),
    phone: z.string().trim().max(30).nullish(),
    remark: z.string().trim().max(500).nullish(),
    status: z.enum(['active', 'disabled']).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

purchaseRoutes.get('/suppliers', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'purchases.read', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [eq(suppliers.shopId, shopId)];
  if (keyword) {
    conditions.push(
      or(
        ilike(suppliers.name, `%${keyword}%`),
        ilike(suppliers.contactName, `%${keyword}%`),
        ilike(suppliers.phone, `%${keyword}%`)
      )!
    );
  }
  if (status === 'active' || status === 'disabled') {
    conditions.push(eq(suppliers.status, status));
  }
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.name))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(suppliers).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

purchaseRoutes.post('/suppliers', async (c) => {
  const parsed = supplierSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const denied = await guardPermission(c, 'purchases.write', { shopId: parsed.data.shopId });
  if (denied) return denied;

  const [row] = await (await getDb())
    .insert(suppliers)
    .values({
      shopId: parsed.data.shopId,
      name: parsed.data.name,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      remark: parsed.data.remark ?? null,
      status: 'active'
    })
    .returning({ id: suppliers.id });

  return c.json({ item: { ...row, shopId: parsed.data.shopId, name: parsed.data.name } }, 201);
});

purchaseRoutes.patch('/suppliers/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: suppliers.id, shopId: suppliers.shopId })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '供应商不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.write', { shopId: current.shopId });
  if (denied) return denied;

  const parsed = updateSupplierSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  await db
    .update(suppliers)
    .set({
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.contactName === undefined ? {} : { contactName: parsed.data.contactName }),
      ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone }),
      ...(parsed.data.remark === undefined ? {} : { remark: parsed.data.remark }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status })
    })
    .where(eq(suppliers.id, id));

  return c.json({ item: { id } });
});

const purchaseItemInputSchema = z
  .object({
    skuId: z.uuid('SKU ID 不合法').nullish(),
    itemName: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantity: z.union([z.string(), z.number()]),
    unitCost: z.number().min(0, '进价不能为负').max(99999999)
  })
  .refine((value) => Boolean(value.skuId) || Boolean(value.itemName && value.unit), {
    message: '非 SKU 明细必须填写名称与单位'
  });

const createPurchaseSchema = z.object({
  shopId: z.uuid('店铺 ID 不合法'),
  supplierId: z.uuid('供应商 ID 不合法').nullish(),
  supplierName: z.string().trim().min(1).max(100).nullish(),
  supplierPhone: z.string().trim().max(30).nullish(),
  expectedAt: z.string().trim().nullish(),
  remark: z.string().trim().max(500).nullish(),
  items: z.array(purchaseItemInputSchema).min(1, '至少一条采购明细').max(200)
});

type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;

type ResolvedPurchaseItem = {
  productSkuId: string | null;
  itemName: string;
  unit: string;
  quantityMode: QuantityMode;
  quantity: string;
  unitCost: string;
  amount: string;
  stockType: 'tracked' | 'untracked';
};

async function resolvePurchaseItems(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  inputs: PurchaseItemInput[]
): Promise<ResolvedPurchaseItem[]> {
  const skuIds = [...new Set(inputs.map((item) => item.skuId).filter(Boolean) as string[])];
  if (skuIds.length !== inputs.filter((item) => item.skuId).length) {
    throw new PurchaseError('DUPLICATE_SKU', '同一 SKU 只能出现一次', 400);
  }

  const skuRows =
    skuIds.length === 0
      ? []
      : await db
          .select({
            id: productSkus.id,
            productName: products.name,
            specName: productSkus.specName,
            unit: productSkus.unit,
            quantityMode: productSkus.quantityMode,
            stockType: productSkus.stockType
          })
          .from(productSkus)
          .innerJoin(products, eq(products.id, productSkus.productId))
          .where(and(eq(productSkus.shopId, shopId), inArray(productSkus.id, skuIds)));

  if (skuRows.length !== skuIds.length) {
    throw new PurchaseError('SKU_NOT_IN_SHOP', '存在不属于该门店的 SKU', 404);
  }
  const skuMap = new Map(skuRows.map((row) => [row.id, row]));

  return inputs.map((input) => {
    const unitCost = input.unitCost.toFixed(2);
    if (input.skuId) {
      const sku = skuMap.get(input.skuId)!;
      const quantity = normalizeQuantity(input.quantity, sku.quantityMode);
      if (quantity === null || Number(quantity) <= 0) {
        throw new PurchaseError(
          'INVALID_QUANTITY_PRECISION',
          `SKU ${sku.productName} 的采购数量不符合其数量模式`,
          400
        );
      }
      return {
        productSkuId: sku.id,
        itemName: `${sku.productName} ${sku.specName}`.trim(),
        unit: sku.unit,
        quantityMode: sku.quantityMode,
        quantity,
        unitCost,
        amount: roundAmount(quantity, unitCost),
        stockType: sku.stockType
      };
    }

    const quantityMode = inferQuantityMode(input.unit);
    const quantity = normalizeQuantity(input.quantity, quantityMode);
    if (quantity === null || Number(quantity) <= 0) {
      throw new PurchaseError(
        'INVALID_QUANTITY_PRECISION',
        '采购数量不符合单位对应的数量模式',
        400
      );
    }
    return {
      productSkuId: null,
      itemName: input.itemName!,
      unit: input.unit!,
      quantityMode,
      quantity,
      unitCost,
      amount: roundAmount(quantity, unitCost),
      stockType: 'untracked'
    };
  });
}

async function resolveSupplierSnapshot(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  supplierId: string | null | undefined,
  supplierName: string | null | undefined,
  supplierPhone: string | null | undefined
) {
  if (!supplierId) {
    if (!supplierName) {
      throw new PurchaseError('SUPPLIER_REQUIRED', '请选择供应商或填写供应商名称', 400);
    }
    return { supplierId: null, supplierName, supplierPhone: supplierPhone ?? null };
  }

  const [supplier] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shopId)))
    .limit(1);
  if (!supplier) {
    throw new PurchaseError('SUPPLIER_NOT_FOUND', '供应商不存在', 404);
  }
  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierPhone: supplier.phone
  };
}

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid('采购明细 ID 不合法'),
        receivedQuantity: z.union([z.string(), z.number()]),
        unitCost: z.number().min(0).max(99999999).optional(),
        differenceReason: z.string().trim().max(200).nullish()
      })
    )
    .max(200)
    .optional()
});

purchaseRoutes.get('/purchases', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'purchases.read', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const status = c.req.query('status')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [eq(purchaseOrders.shopId, shopId)];
  if (['draft', 'submitted', 'received', 'cancelled'].includes(status)) {
    conditions.push(
      eq(
        purchaseOrders.status,
        status as 'draft' | 'submitted' | 'received' | 'cancelled'
      )
    );
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(purchaseOrders.poNo, `%${keyword}%`),
        ilike(purchaseOrders.supplierName, `%${keyword}%`)
      )!
    );
  }
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        shopId: purchaseOrders.shopId,
        poNo: purchaseOrders.poNo,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        supplierPhone: purchaseOrders.supplierPhone,
        status: purchaseOrders.status,
        orderedAmount: purchaseOrders.orderedAmount,
        receivedAmount: purchaseOrders.receivedAmount,
        expectedAt: purchaseOrders.expectedAt,
        submittedAt: purchaseOrders.submittedAt,
        receivedAt: purchaseOrders.receivedAt,
        cancelledAt: purchaseOrders.cancelledAt,
        cancelReason: purchaseOrders.cancelReason,
        remark: purchaseOrders.remark,
        createdAt: purchaseOrders.createdAt,
        itemCount: sql<number>`(
          select count(*) from purchase_order_items poi where poi.purchase_order_id = purchase_orders.id
        )::int`
      })
      .from(purchaseOrders)
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(purchaseOrders).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

purchaseRoutes.get('/purchases/suggestions', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'purchases.read', { shopId });
  if (denied) return denied;

  const db = await getDb();
  const result = await db.execute(sql`
    select
      ps.id as "skuId",
      ps.product_id as "productId",
      p.name as "productName",
      ps.spec_name as "specName",
      ps.unit,
      ps.quantity_mode as "quantityMode",
      st.quantity,
      st.min_threshold as "minThreshold",
      st.max_threshold as "maxThreshold",
      greatest(
        coalesce(st.max_threshold, st.min_threshold * 2) - st.quantity,
        0
      ) as "suggestedQuantity",
      (
        select sm.unit_cost
          from stock_movements sm
         where sm.product_sku_id = ps.id
           and sm.movement_type = 'purchase_in'
           and sm.unit_cost is not null
         order by sm.created_at desc
         limit 1
      ) as "lastUnitCost"
    from product_skus ps
    join products p on p.id = ps.product_id
    join product_sku_stocks st on st.product_sku_id = ps.id
    where ps.shop_id = ${shopId}::uuid
      and ps.stock_type = 'tracked'
      and st.quantity <= st.min_threshold
    order by (st.quantity - st.min_threshold) asc, p.name asc
    limit 200
  `);

  return c.json({ items: result.rows });
});

purchaseRoutes.get('/purchases/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [order] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.read', { shopId: order.shopId });
  if (denied) return denied;

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productSkuId: purchaseOrderItems.productSkuId,
      productId: productSkus.productId,
      productName: products.name,
      specName: productSkus.specName,
      stockType: productSkus.stockType,
      itemName: purchaseOrderItems.itemName,
      unit: purchaseOrderItems.unit,
      quantityMode: purchaseOrderItems.quantityMode,
      quantity: purchaseOrderItems.quantity,
      unitCost: purchaseOrderItems.unitCost,
      receivedQuantity: purchaseOrderItems.receivedQuantity,
      amount: purchaseOrderItems.amount,
      differenceReason: purchaseOrderItems.differenceReason
    })
    .from(purchaseOrderItems)
    .leftJoin(productSkus, eq(productSkus.id, purchaseOrderItems.productSkuId))
    .leftJoin(products, eq(products.id, productSkus.productId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderItems.id));

  return c.json({ item: { ...order, items } });
});

purchaseRoutes.post('/purchases', async (c) => {
  const parsed = createPurchaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const data = parsed.data;
  const denied = await guardPermission(c, 'purchases.write', { shopId: data.shopId });
  if (denied) return denied;

  const db = await getDb();
  try {
    const supplier = await resolveSupplierSnapshot(
      db,
      data.shopId,
      data.supplierId,
      data.supplierName,
      data.supplierPhone
    );
    const items = await resolvePurchaseItems(db, data.shopId, data.items);
    const orderedAmount = addMoney(items.map((item) => item.amount));
    const admin = c.get('admin');
    const expectedAt = parseExpectedAt(data.expectedAt);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          shopId: data.shopId,
          poNo: generatePoNo(),
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          supplierPhone: supplier.supplierPhone,
          status: 'draft',
          orderedAmount,
          expectedAt,
          createdByAdminId: admin?.sub ?? null,
          remark: data.remark ?? null
        })
        .returning({ id: purchaseOrders.id, poNo: purchaseOrders.poNo });

      await tx.insert(purchaseOrderItems).values(
        items.map((item) => ({
          purchaseOrderId: order.id,
          productSkuId: item.productSkuId,
          itemName: item.itemName,
          unit: item.unit,
          quantityMode: item.quantityMode,
          quantity: item.quantity,
          unitCost: item.unitCost,
          receivedQuantity: '0.00',
          amount: item.amount
        }))
      );

      return order;
    });

    return c.json({ item: { ...result, orderedAmount } }, 201);
  } catch (error) {
    if (error instanceof PurchaseError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (isUniqueViolation(error)) {
      return c.json({ code: 'PO_NO_CONFLICT', message: '采购单号冲突，请重试' }, 409);
    }
    throw error;
  }
});

const updatePurchaseSchema = z
  .object({
    supplierId: z.uuid('供应商 ID 不合法').nullish(),
    supplierName: z.string().trim().min(1).max(100).nullish(),
    supplierPhone: z.string().trim().max(30).nullish(),
    expectedAt: z.string().trim().nullish(),
    remark: z.string().trim().max(500).nullish(),
    items: z.array(purchaseItemInputSchema).min(1).max(200).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

purchaseRoutes.patch('/purchases/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      supplierPhone: purchaseOrders.supplierPhone
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.write', { shopId: current.shopId });
  if (denied) return denied;

  if (current.status !== 'draft') {
    return c.json({ code: 'PURCHASE_NOT_EDITABLE', message: '只有草稿状态的采购单可编辑' }, 409);
  }

  const parsed = updatePurchaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const data = parsed.data;

  try {
    const supplierTouched =
      data.supplierId !== undefined ||
      data.supplierName !== undefined ||
      data.supplierPhone !== undefined;
    const supplier = supplierTouched
      ? await resolveSupplierSnapshot(
          db,
          current.shopId,
          data.supplierId === undefined ? current.supplierId : data.supplierId,
          data.supplierName === undefined ? current.supplierName : data.supplierName,
          data.supplierPhone === undefined ? current.supplierPhone : data.supplierPhone
        )
      : null;
    const items = data.items
      ? await resolvePurchaseItems(db, current.shopId, data.items)
      : null;
    const orderedAmount = items ? addMoney(items.map((item) => item.amount)) : null;
    const expectedAt = parseExpectedAt(data.expectedAt);

    await db.transaction(async (tx) => {
      await tx
        .update(purchaseOrders)
        .set({
          ...(supplier
            ? {
                supplierId: supplier.supplierId,
                supplierName: supplier.supplierName,
                supplierPhone: supplier.supplierPhone
              }
            : {}),
          ...(data.expectedAt === undefined ? {} : { expectedAt }),
          ...(data.remark === undefined ? {} : { remark: data.remark }),
          ...(orderedAmount === null ? {} : { orderedAmount }),
          updatedAt: new Date()
        })
        .where(eq(purchaseOrders.id, id));

      if (items) {
        await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
        await tx.insert(purchaseOrderItems).values(
          items.map((item) => ({
            purchaseOrderId: id,
            productSkuId: item.productSkuId,
            itemName: item.itemName,
            unit: item.unit,
            quantityMode: item.quantityMode,
            quantity: item.quantity,
            unitCost: item.unitCost,
            receivedQuantity: '0.00',
            amount: item.amount
          }))
        );
      }
    });

    return c.json({ item: { id, ...(orderedAmount === null ? {} : { orderedAmount }) } });
  } catch (error) {
    if (error instanceof PurchaseError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  }
});

purchaseRoutes.post('/purchases/:id/submit', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: purchaseOrders.id, shopId: purchaseOrders.shopId, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.write', { shopId: current.shopId });
  if (denied) return denied;

  if (current.status !== 'draft') {
    return c.json({ code: 'PURCHASE_NOT_EDITABLE', message: '只有草稿状态的采购单可提交' }, 409);
  }

  const [itemCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, id));
  if ((itemCount?.total ?? 0) === 0) {
    return c.json({ code: 'PURCHASE_ITEM_MISMATCH', message: '采购单没有明细' }, 409);
  }

  const admin = c.get('admin');
  await db
    .update(purchaseOrders)
    .set({
      status: 'submitted',
      submittedAt: new Date(),
      submittedByAdminId: admin?.sub ?? null,
      updatedAt: new Date()
    })
    .where(eq(purchaseOrders.id, id));

  return c.json({ ok: true, item: { id, status: 'submitted' } });
});

purchaseRoutes.post('/purchases/:id/cancel', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: purchaseOrders.id, shopId: purchaseOrders.shopId, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.write', { shopId: current.shopId });
  if (denied) return denied;

  if (current.status !== 'draft' && current.status !== 'submitted') {
    return c.json({ code: 'PURCHASE_NOT_EDITABLE', message: '该采购单不可取消' }, 409);
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => null);
  const reason = body?.reason?.trim().slice(0, 200) || null;

  await db
    .update(purchaseOrders)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
      updatedAt: new Date()
    })
    .where(eq(purchaseOrders.id, id));

  return c.json({ ok: true, item: { id, status: 'cancelled' } });
});

purchaseRoutes.post('/purchases/:id/receive', async (c) => {
  const parsed = receiveSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [order] = await db
    .select({ id: purchaseOrders.id, shopId: purchaseOrders.shopId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = await guardPermission(c, 'purchases.write', { shopId: order.shopId });
  if (denied) return denied;

  const admin = c.get('admin');
  const inputMap = new Map((parsed.data.items ?? []).map((item) => [item.id, item]));

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, id))
        .for('update');
      if (!locked) throw new PurchaseError('NOT_FOUND', '采购单不存在', 404);
      if (locked.status === 'received') {
        throw new PurchaseError('PURCHASE_ALREADY_RECEIVED', '该采购单已入库', 409);
      }
      if (locked.status !== 'submitted') {
        throw new PurchaseError('PURCHASE_NOT_EDITABLE', '只有已提交的采购单可入库', 409);
      }

      const items = await tx
        .select({
          id: purchaseOrderItems.id,
          productSkuId: purchaseOrderItems.productSkuId,
          itemName: purchaseOrderItems.itemName,
          unit: purchaseOrderItems.unit,
          quantityMode: purchaseOrderItems.quantityMode,
          quantity: purchaseOrderItems.quantity,
          unitCost: purchaseOrderItems.unitCost,
          stockType: productSkus.stockType
        })
        .from(purchaseOrderItems)
        .leftJoin(productSkus, eq(productSkus.id, purchaseOrderItems.productSkuId))
        .where(eq(purchaseOrderItems.purchaseOrderId, id));

      if (items.length === 0) {
        throw new PurchaseError('PURCHASE_ITEM_MISMATCH', '采购单没有明细', 409);
      }

      const orderedIds = new Set(items.map((item) => item.id));
      for (const input of inputMap.keys()) {
        if (!orderedIds.has(input)) {
          throw new PurchaseError('PURCHASE_ITEM_MISMATCH', '存在不属于该采购单的明细', 400);
        }
      }

      const receivedAmounts: string[] = [];

      for (const item of items) {
        const input = inputMap.get(item.id);
        const rawReceived = input?.receivedQuantity ?? item.quantity;
        const received = normalizeQuantity(rawReceived, item.quantityMode);
        if (received === null) {
          throw new PurchaseError(
            'INVALID_QUANTITY_PRECISION',
            `${item.itemName} 的实收数量不符合其数量模式`,
            400
          );
        }
        if (Math.round(Number(received) * 100) > Math.round(Number(item.quantity) * 100)) {
          throw new PurchaseError(
            'PURCHASE_ITEM_MISMATCH',
            `${item.itemName} 的实收数量不能大于采购数量`,
            409
          );
        }

        const unitCost = (input?.unitCost ?? Number(item.unitCost)).toFixed(2);
        const amount = roundAmount(received, unitCost);
        receivedAmounts.push(amount);

        if (item.productSkuId && item.stockType === 'tracked' && Number(received) > 0) {
          const [stock] = await tx
            .select({ quantity: productSkuStocks.quantity })
            .from(productSkuStocks)
            .where(eq(productSkuStocks.productSkuId, item.productSkuId))
            .for('update');
          if (!stock) {
            throw new PurchaseError(
              'STOCK_ROW_MISSING',
              `${item.itemName} 缺少库存行，请先在商品规格中同步库存`,
              409
            );
          }
          const afterCents =
            Math.round(Number(stock.quantity) * 100) +
            Math.round(Number(received) * 100);
          const after = (afterCents / 100).toFixed(2);

          await tx
            .update(productSkuStocks)
            .set({ quantity: after, updatedAt: new Date() })
            .where(eq(productSkuStocks.productSkuId, item.productSkuId));

          await tx.insert(stockMovements).values({
            shopId: locked.shopId,
            productSkuId: item.productSkuId,
            movementType: 'purchase_in',
            quantityChange: received,
            balanceAfter: after,
            unitCost,
            referenceType: 'purchase_order',
            referenceId: locked.id,
            operatorAdminId: admin?.sub ?? null,
            remark: `采购入库 ${locked.poNo}`
          });
        }

        await tx
          .update(purchaseOrderItems)
          .set({
            receivedQuantity: received,
            unitCost,
            differenceReason: input?.differenceReason ?? null
          })
          .where(eq(purchaseOrderItems.id, item.id));
      }

      const receivedAmount = addMoney(receivedAmounts);

      await tx
        .update(purchaseOrders)
        .set({
          status: 'received',
          receivedAt: new Date(),
          receivedByAdminId: admin?.sub ?? null,
          receivedAmount,
          updatedAt: new Date()
        })
        .where(eq(purchaseOrders.id, id));

      return { id, status: 'received' as const, receivedAmount };
    });

    return c.json({ ok: true, item: result });
  } catch (error) {
    if (error instanceof PurchaseError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (isUniqueViolation(error)) {
      return c.json({ code: 'PURCHASE_ALREADY_RECEIVED', message: '该采购单已入库' }, 409);
    }
    throw error;
  }
});

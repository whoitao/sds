import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  catalogProducts,
  catalogSkus,
  demandPlans,
  getDb,
  productSkuStocks,
  productSkus,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  supplierScopes,
  shops,
  stockMovements,
  suppliers,
  warehouseStocks,
  warehouses
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
import {
  DOCUMENT_NEW_STATE,
  acquireIdempotencyKey,
  completeIdempotencyKey,
  generateDocumentNo,
  hashIdempotencyRequest,
  recordDocumentEvent,
  releaseIdempotencyKey
} from '../lib/documents.js';

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

function generatePoNo(prefix: 'PO' | 'WH' = 'PO') {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${time}${random}`.slice(0, 32);
}

function parseExpectedAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PurchaseError('INVALID_EXPECTED_AT', '预计到货时间格式不合法', 400);
  }
  return date;
}

const supplierFieldsSchema = {
  code: z.string().trim().max(32).nullish(),
  name: z.string().trim().min(1, '供应商名称必填').max(100),
  contactName: z.string().trim().max(50).nullish(),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(300).nullish(),
  settlementMethod: z.string().trim().max(32).nullish(),
  taxNo: z.string().trim().max(50).nullish(),
  email: z.string().trim().max(120).nullish(),
  remark: z.string().trim().max(500).nullish()
};

const supplierSchema = z.object({
  /** 兼容旧调用：传 shopId 时同时建立一条供货关系；不传则只建平台主体 */
  shopId: z.uuid('店铺 ID 不合法').nullish(),
  status: z.enum(['active', 'disabled']).optional(),
  ...supplierFieldsSchema
});

const updateSupplierSchema = z
  .object({
    code: supplierFieldsSchema.code,
    name: supplierFieldsSchema.name.optional(),
    contactName: supplierFieldsSchema.contactName,
    phone: supplierFieldsSchema.phone,
    address: supplierFieldsSchema.address,
    settlementMethod: supplierFieldsSchema.settlementMethod,
    taxNo: supplierFieldsSchema.taxNo,
    email: supplierFieldsSchema.email,
    remark: supplierFieldsSchema.remark,
    status: z.enum(['active', 'disabled']).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const bindSupplierShopsSchema = z.object({
  shopIds: z.array(z.uuid('店铺 ID 不合法')).max(200),
  status: z.enum(['active', 'disabled']).optional()
});

const supplierScopeInputSchema = z.object({
  subjectType: z.enum(['shop', 'warehouse']),
  subjectId: z.uuid('主体 ID 不合法'),
  status: z.enum(['active', 'inactive']).optional()
});

/** 全量替换供货范围：门店与仓库混在一个列表提交（迁移 0029）。 */
const replaceSupplierScopesSchema = z.object({
  scopes: z.array(supplierScopeInputSchema).max(500)
});

type SupplierScopeType = 'shop' | 'warehouse';
type SupplierRow = typeof suppliers.$inferSelect;
type SupplierShopLink = { shopId: string; shopName: string; status: string };
type SupplierWarehouseLink = { warehouseId: string; warehouseName: string; status: string };

/** 旧 admin 仍按 shopId 读取；平台主体没有单一门店时回退到历史门店。 */
function toSupplierResponse(
  row: SupplierRow,
  shopId: string | null,
  shopLinks: SupplierShopLink[] = [],
  warehouseLinks: SupplierWarehouseLink[] = []
) {
  const { legacyShopId, ...rest } = row;
  return {
    ...rest,
    shopId: shopId ?? legacyShopId,
    shopIds: shopLinks.map((link) => link.shopId),
    shops: shopLinks,
    shopCount: shopLinks.filter((link) => link.status === 'active').length,
    warehouseIds: warehouseLinks.map((link) => link.warehouseId),
    warehouses: warehouseLinks,
    warehouseCount: warehouseLinks.filter((link) => link.status === 'active').length
  };
}

/** 供应商对某个门店/总部仓存在启用中的供货关系（统一走 supplier_scopes）。 */
function scopeExists(subjectType: SupplierScopeType, subjectId: string) {
  return sql<boolean>`exists (
    select 1 from ${supplierScopes}
    where ${supplierScopes.supplierId} = ${suppliers.id}
      and ${supplierScopes.subjectType} = ${subjectType}
      and ${supplierScopes.subjectId} = ${subjectId}
      and ${supplierScopes.status} = 'active'
  )`;
}

purchaseRoutes.get('/suppliers', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  if (shopId && warehouseId) {
    return c.json({ code: 'INVALID_QUERY', message: 'shopId 与 warehouseId 只能二选一' }, 400);
  }
  // 旧调用（带 shopId/warehouseId）沿用采购权限；平台档案查询用 suppliers.read。
  const denied = shopId
    ? ((await guardPermission(c, 'purchases.read', { shopId })) ??
      (await guardPermission(c, 'suppliers.read')))
    : warehouseId
      ? ((await guardPermission(c, 'warehouse.read')) ??
        (await guardPermission(c, 'suppliers.read')))
      : await guardPermission(c, 'suppliers.read');
  if (denied) return denied;

  const db = await getDb();
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [];
  if (shopId) {
    conditions.push(scopeExists('shop', shopId));
  }
  if (warehouseId) {
    conditions.push(scopeExists('warehouse', warehouseId));
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(suppliers.name, `%${keyword}%`),
        ilike(suppliers.code, `%${keyword}%`),
        ilike(suppliers.contactName, `%${keyword}%`),
        ilike(suppliers.phone, `%${keyword}%`),
        ilike(suppliers.address, `%${keyword}%`)
      )!
    );
  }
  if (status === 'active' || status === 'disabled') {
    conditions.push(eq(suppliers.status, status));
  } else if (shopId || warehouseId) {
    // 采购选择只暴露启用供应商；档案页（不带主体过滤）仍可查看停用记录
    conditions.push(eq(suppliers.status, 'active'));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(where)
      .orderBy(asc(suppliers.name))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(suppliers).where(where)
  ]);

  const supplierIds = rows.map((row) => row.id);
  const [shopLinks, warehouseLinks] = supplierIds.length
    ? await Promise.all([
        db
          .select({
            supplierId: supplierScopes.supplierId,
            shopId: supplierScopes.subjectId,
            shopName: shops.name,
            status: supplierScopes.status
          })
          .from(supplierScopes)
          .innerJoin(shops, eq(shops.id, supplierScopes.subjectId))
          .where(
            and(
              inArray(supplierScopes.supplierId, supplierIds),
              eq(supplierScopes.subjectType, 'shop')
            )
          ),
        db
          .select({
            supplierId: supplierScopes.supplierId,
            warehouseId: supplierScopes.subjectId,
            warehouseName: warehouses.name,
            status: supplierScopes.status
          })
          .from(supplierScopes)
          .innerJoin(warehouses, eq(warehouses.id, supplierScopes.subjectId))
          .where(
            and(
              inArray(supplierScopes.supplierId, supplierIds),
              eq(supplierScopes.subjectType, 'warehouse')
            )
          )
      ])
    : [[], []];
  const shopsBySupplier = new Map<string, SupplierShopLink[]>();
  for (const link of shopLinks) {
    const list = shopsBySupplier.get(link.supplierId) ?? [];
    list.push({ shopId: link.shopId, shopName: link.shopName, status: link.status });
    shopsBySupplier.set(link.supplierId, list);
  }
  const warehousesBySupplier = new Map<string, SupplierWarehouseLink[]>();
  for (const link of warehouseLinks) {
    const list = warehousesBySupplier.get(link.supplierId) ?? [];
    list.push({
      warehouseId: link.warehouseId,
      warehouseName: link.warehouseName,
      status: link.status
    });
    warehousesBySupplier.set(link.supplierId, list);
  }

  return c.json({
    items: rows.map((row) =>
      toSupplierResponse(
        row,
        shopId || null,
        shopsBySupplier.get(row.id) ?? [],
        warehousesBySupplier.get(row.id) ?? []
      )
    ),
    total: totalRows[0]?.total ?? 0,
    page,
    pageSize
  });
});

purchaseRoutes.post('/suppliers', async (c) => {
  const parsed = supplierSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const shopId = parsed.data.shopId ?? null;
  const denied = shopId
    ? ((await guardPermission(c, 'suppliers.write')) ??
      (await guardPermission(c, 'purchases.write', { shopId })))
    : await guardPermission(c, 'suppliers.write');
  if (denied) return denied;

  const db = await getDb();
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(suppliers)
        .values({
          code: parsed.data.code ?? null,
          name: parsed.data.name,
          contactName: parsed.data.contactName ?? null,
          phone: parsed.data.phone ?? null,
          address: parsed.data.address ?? null,
          settlementMethod: parsed.data.settlementMethod ?? null,
          taxNo: parsed.data.taxNo ?? null,
          email: parsed.data.email ?? null,
          remark: parsed.data.remark ?? null,
          status: parsed.data.status ?? 'active'
        })
        .returning();
      if (shopId) {
        await tx.insert(supplierScopes).values({
          supplierId: created.id,
          subjectType: 'shop',
          subjectId: shopId,
          status: 'active',
          isTest: created.isTest
        });
      }
      return created;
    });

    const shopLinks: SupplierShopLink[] = shopId
      ? [
          {
            shopId,
            shopName:
              (
                await db
                  .select({ name: shops.name })
                  .from(shops)
                  .where(eq(shops.id, shopId))
                  .limit(1)
              )[0]?.name ?? '',
            status: 'active'
          }
        ]
      : [];
    return c.json({ item: toSupplierResponse(row, shopId, shopLinks) }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SUPPLIER_CODE_EXISTS', message: '供应商编码已存在' }, 409);
    }
    throw error;
  }
});

purchaseRoutes.patch('/suppliers/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [current] = await db
    .select({ id: suppliers.id, legacyShopId: suppliers.legacyShopId })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '供应商不存在' }, 404);

  const denied =
    (await guardPermission(c, 'suppliers.write')) ??
    (current.legacyShopId
      ? await guardPermission(c, 'purchases.write', { shopId: current.legacyShopId })
      : null);
  if (denied) return denied;

  const parsed = updateSupplierSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  try {
    await db
      .update(suppliers)
      .set({
        ...(parsed.data.code === undefined ? {} : { code: parsed.data.code }),
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.contactName === undefined ? {} : { contactName: parsed.data.contactName }),
        ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone }),
        ...(parsed.data.address === undefined ? {} : { address: parsed.data.address }),
        ...(parsed.data.settlementMethod === undefined
          ? {}
          : { settlementMethod: parsed.data.settlementMethod }),
        ...(parsed.data.taxNo === undefined ? {} : { taxNo: parsed.data.taxNo }),
        ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
        ...(parsed.data.remark === undefined ? {} : { remark: parsed.data.remark }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        updatedAt: new Date()
      })
      .where(eq(suppliers.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ code: 'SUPPLIER_CODE_EXISTS', message: '供应商编码已存在' }, 409);
    }
    throw error;
  }

  return c.json({ item: { id } });
});

/**
 * 兼容旧调用：只全量替换该供应商的「门店」供货范围，仓库范围保持不变。
 * 新页面统一使用 PUT /suppliers/:id/scopes。
 */
purchaseRoutes.put('/suppliers/:id/shops', async (c) => {
  const denied = await guardPermission(c, 'suppliers.write');
  if (denied) return denied;

  const parsed = bindSupplierShopsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [supplier] = await db
    .select({ id: suppliers.id, isTest: suppliers.isTest })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!supplier) return c.json({ code: 'NOT_FOUND', message: '供应商不存在' }, 404);

  const uniqueShopIds = [...new Set(parsed.data.shopIds)];
  if (uniqueShopIds.length > 0) {
    const existing = await db
      .select({ id: shops.id })
      .from(shops)
      .where(inArray(shops.id, uniqueShopIds));
    if (existing.length !== uniqueShopIds.length) {
      return c.json({ code: 'SHOP_NOT_FOUND', message: '存在无效的门店 ID' }, 400);
    }
  }

  const status = parsed.data.status === 'disabled' ? 'inactive' : 'active';
  await db.transaction(async (tx) => {
    await tx
      .delete(supplierScopes)
      .where(
        and(
          eq(supplierScopes.supplierId, id),
          eq(supplierScopes.subjectType, 'shop'),
          ...(uniqueShopIds.length > 0
            ? [notInArray(supplierScopes.subjectId, uniqueShopIds)]
            : [])
        )
      );

    if (uniqueShopIds.length > 0) {
      await tx
        .insert(supplierScopes)
        .values(
          uniqueShopIds.map((shopId) => ({
            supplierId: id,
            subjectType: 'shop',
            subjectId: shopId,
            status,
            isTest: supplier.isTest
          }))
        )
        .onConflictDoUpdate({
          target: [
            supplierScopes.supplierId,
            supplierScopes.subjectType,
            supplierScopes.subjectId
          ],
          set: { status, updatedAt: new Date() }
        });
    }

    await tx
      .update(suppliers)
      .set({ updatedAt: new Date() })
      .where(eq(suppliers.id, id));
  });

  return c.json({ item: { id, shopIds: uniqueShopIds } });
});

/** 读取统一供货范围（门店 + 仓库）。 */
purchaseRoutes.get('/suppliers/:id/scopes', async (c) => {
  const denied = await guardPermission(c, 'suppliers.read');
  if (denied) return denied;

  const db = await getDb();
  const id = c.req.param('id');
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!supplier) return c.json({ code: 'NOT_FOUND', message: '供应商不存在' }, 404);

  const [shopRows, warehouseRows] = await Promise.all([
    db
      .select({
        subjectId: supplierScopes.subjectId,
        subjectName: shops.name,
        status: supplierScopes.status
      })
      .from(supplierScopes)
      .innerJoin(shops, eq(shops.id, supplierScopes.subjectId))
      .where(
        and(eq(supplierScopes.supplierId, id), eq(supplierScopes.subjectType, 'shop'))
      ),
    db
      .select({
        subjectId: supplierScopes.subjectId,
        subjectName: warehouses.name,
        status: supplierScopes.status
      })
      .from(supplierScopes)
      .innerJoin(warehouses, eq(warehouses.id, supplierScopes.subjectId))
      .where(
        and(eq(supplierScopes.supplierId, id), eq(supplierScopes.subjectType, 'warehouse'))
      )
  ]);

  return c.json({
    items: [
      ...shopRows.map((row) => ({ ...row, subjectType: 'shop' as const })),
      ...warehouseRows.map((row) => ({ ...row, subjectType: 'warehouse' as const }))
    ]
  });
});

/** 全量替换统一供货范围：门店与仓库混在一个列表提交，服务端校验主体存在且启用。 */
purchaseRoutes.put('/suppliers/:id/scopes', async (c) => {
  const denied = await guardPermission(c, 'suppliers.write');
  if (denied) return denied;

  const parsed = replaceSupplierScopesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [supplier] = await db
    .select({ id: suppliers.id, isTest: suppliers.isTest })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!supplier) return c.json({ code: 'NOT_FOUND', message: '供应商不存在' }, 404);

  const seen = new Set<string>();
  for (const scope of parsed.data.scopes) {
    const key = `${scope.subjectType}:${scope.subjectId}`;
    if (seen.has(key)) {
      return c.json({ code: 'DUPLICATE_SCOPE', message: '同一供货主体不能重复提交' }, 400);
    }
    seen.add(key);
  }

  const shopIds = [...new Set(parsed.data.scopes.filter((s) => s.subjectType === 'shop').map((s) => s.subjectId))];
  const warehouseIds = [
    ...new Set(
      parsed.data.scopes.filter((s) => s.subjectType === 'warehouse').map((s) => s.subjectId)
    )
  ];

  const [shopRows, warehouseRows] = await Promise.all([
    shopIds.length
      ? db
          .select({ id: shops.id, name: shops.name, status: shops.status })
          .from(shops)
          .where(inArray(shops.id, shopIds))
      : Promise.resolve([] as { id: string; name: string; status: string }[]),
    warehouseIds.length
      ? db
          .select({ id: warehouses.id, name: warehouses.name, status: warehouses.status })
          .from(warehouses)
          .where(inArray(warehouses.id, warehouseIds))
      : Promise.resolve([] as { id: string; name: string; status: string }[])
  ]);

  const shopMap = new Map(shopRows.map((row) => [row.id, row]));
  const warehouseMap = new Map(warehouseRows.map((row) => [row.id, row]));
  const invalid: string[] = [];
  for (const scope of parsed.data.scopes) {
    if (scope.subjectType === 'shop') {
      const shop = shopMap.get(scope.subjectId);
      if (!shop) invalid.push(`门店 ${scope.subjectId} 不存在`);
      else if (shop.status !== 'open') invalid.push(`门店「${shop.name}」未启用`);
    } else {
      const warehouse = warehouseMap.get(scope.subjectId);
      if (!warehouse) invalid.push(`仓库 ${scope.subjectId} 不存在`);
      else if (warehouse.status !== 'active') invalid.push(`仓库「${warehouse.name}」未启用`);
    }
  }
  if (invalid.length > 0) {
    return c.json({ code: 'INVALID_SCOPE_SUBJECT', message: invalid[0] }, 400);
  }

  await db.transaction(async (tx) => {
    await tx.delete(supplierScopes).where(eq(supplierScopes.supplierId, id));
    if (parsed.data.scopes.length > 0) {
      await tx.insert(supplierScopes).values(
        parsed.data.scopes.map((scope) => ({
          supplierId: id,
          subjectType: scope.subjectType,
          subjectId: scope.subjectId,
          status: scope.status ?? 'active',
          isTest: supplier.isTest
        }))
      );
    }
    await tx
      .update(suppliers)
      .set({ updatedAt: new Date() })
      .where(eq(suppliers.id, id));
  });

  return c.json({
    items: parsed.data.scopes.map((scope) => ({
      subjectType: scope.subjectType,
      subjectId: scope.subjectId,
      subjectName:
        scope.subjectType === 'shop'
          ? (shopMap.get(scope.subjectId)?.name ?? '')
          : (warehouseMap.get(scope.subjectId)?.name ?? ''),
      status: scope.status ?? 'active'
    }))
  });
});

const purchaseItemInputSchema = z
  .object({
    /** 门店采购：门店 SKU */
    skuId: z.uuid('SKU ID 不合法').nullish(),
    /** 总部仓采购：总部规格 */
    catalogSkuId: z.uuid('总部规格 ID 不合法').nullish(),
    itemName: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantity: z.union([z.string(), z.number()]),
    unitCost: z.number().min(0, '进价不能为负').max(99999999)
  })
  .refine(
    (value) =>
      Boolean(value.skuId || value.catalogSkuId) || Boolean(value.itemName && value.unit),
    {
      message: '非 SKU 明细必须填写名称与单位'
    }
  )
  .refine((value) => !(value.skuId && value.catalogSkuId), {
    message: '门店 SKU 与总部规格只能二选一'
  });

const createPurchaseSchema = z
  .object({
    shopId: z.uuid('店铺 ID 不合法').nullish(),
    warehouseId: z.uuid('仓库 ID 不合法').nullish(),
    supplierId: z.uuid('供应商 ID 不合法').nullish(),
    supplierName: z.string().trim().min(1).max(100).nullish(),
    supplierPhone: z.string().trim().max(30).nullish(),
    /** 可选关联需求计划：从计划明细生成采购单时带入；手工采购保持为空 */
    demandPlanId: z.uuid('需求计划 ID 不合法').nullish(),
    expectedAt: z.string().trim().nullish(),
    remark: z.string().trim().max(500).nullish(),
    items: z.array(purchaseItemInputSchema).min(1, '至少一条采购明细').max(200)
  })
  .refine((value) => Boolean(value.shopId) !== Boolean(value.warehouseId), {
    message: '门店采购与总部仓采购必须二选一'
  });

type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;

type ResolvedPurchaseItem = {
  productSkuId: string | null;
  catalogSkuId: string | null;
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
  subject: { shopId: string | null; warehouseId: string | null },
  inputs: PurchaseItemInput[]
): Promise<ResolvedPurchaseItem[]> {
  const skuIds = [...new Set(inputs.map((item) => item.skuId).filter(Boolean) as string[])];
  const catalogSkuIds = [
    ...new Set(inputs.map((item) => item.catalogSkuId).filter(Boolean) as string[])
  ];
  if (skuIds.length !== inputs.filter((item) => item.skuId).length) {
    throw new PurchaseError('DUPLICATE_SKU', '同一 SKU 只能出现一次', 400);
  }
  if (catalogSkuIds.length !== inputs.filter((item) => item.catalogSkuId).length) {
    throw new PurchaseError('DUPLICATE_SKU', '同一总部规格只能出现一次', 400);
  }
  if (subject.warehouseId && skuIds.length > 0) {
    throw new PurchaseError('SKU_SUBJECT_MISMATCH', '总部仓采购请选择总部规格', 400);
  }
  if (subject.shopId && catalogSkuIds.length > 0) {
    throw new PurchaseError('SKU_SUBJECT_MISMATCH', '门店采购请选择门店 SKU', 400);
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
          .where(
            and(
              eq(productSkus.shopId, subject.shopId ?? ''),
              inArray(productSkus.id, skuIds)
            )
          );

  if (skuRows.length !== skuIds.length) {
    throw new PurchaseError('SKU_NOT_IN_SHOP', '存在不属于该门店的 SKU', 404);
  }
  const skuMap = new Map(skuRows.map((row) => [row.id, row]));

  const catalogRows =
    catalogSkuIds.length === 0
      ? []
      : await db
          .select({
            id: catalogSkus.id,
            productName: catalogProducts.name,
            specName: catalogSkus.specName,
            unit: catalogSkus.unit,
            quantityMode: catalogSkus.quantityMode,
            stockType: catalogSkus.stockType,
            status: catalogSkus.status
          })
          .from(catalogSkus)
          .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
          .where(inArray(catalogSkus.id, catalogSkuIds));

  if (catalogRows.length !== catalogSkuIds.length) {
    throw new PurchaseError('CATALOG_SKU_NOT_FOUND', '存在无效的总部规格', 404);
  }
  if (catalogRows.some((row) => row.status !== 'active')) {
    throw new PurchaseError('CATALOG_SKU_DISABLED', '总部规格已停用', 409);
  }
  const catalogMap = new Map(catalogRows.map((row) => [row.id, row]));

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
        catalogSkuId: null,
        itemName: `${sku.productName} ${sku.specName}`.trim(),
        unit: sku.unit,
        quantityMode: sku.quantityMode,
        quantity,
        unitCost,
        amount: roundAmount(quantity, unitCost),
        stockType: sku.stockType
      };
    }

    if (input.catalogSkuId) {
      const sku = catalogMap.get(input.catalogSkuId)!;
      const quantity = normalizeQuantity(input.quantity, sku.quantityMode);
      if (quantity === null || Number(quantity) <= 0) {
        throw new PurchaseError(
          'INVALID_QUANTITY_PRECISION',
          `${sku.productName} 的采购数量不符合其数量模式`,
          400
        );
      }
      return {
        productSkuId: null,
        catalogSkuId: sku.id,
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
      catalogSkuId: null,
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
  subject: { shopId: string | null; warehouseId: string | null },
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

  // 门店采购要求供应商已向该门店供货；总部仓采购要求供应商已绑定该仓库（supplier_scopes）。
  const conditions = [eq(suppliers.id, supplierId), eq(suppliers.status, 'active')];
  if (subject.shopId) {
    conditions.push(scopeExists('shop', subject.shopId));
  }
  if (subject.warehouseId) {
    conditions.push(scopeExists('warehouse', subject.warehouseId));
  }

  const [supplier] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone
    })
    .from(suppliers)
    .where(and(...conditions))
    .limit(1);
  if (!supplier) {
    throw new PurchaseError(
      'SUPPLIER_NOT_FOUND',
      subject.shopId
        ? '供应商不存在、已停用或未向该门店供货'
        : subject.warehouseId
          ? '供应商不存在、已停用或未绑定该仓库，请先在供应商档案中配置供货范围'
          : '供应商不存在或已停用',
      404
    );
  }
  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierPhone: supplier.phone
  };
}

/**
 * 需求计划关联校验：只允许关联当前版本；历史版本指向新计划由汇总流程负责。
 * 采购单按门店创建，计划是跨门店汇总，因此不强制校验门店是否在该计划明细中。
 */
async function resolveDemandPlanId(
  db: Awaited<ReturnType<typeof getDb>>,
  demandPlanId: string | null | undefined
) {
  if (!demandPlanId) return null;
  const [plan] = await db
    .select({ id: demandPlans.id, planNo: demandPlans.planNo, isCurrent: demandPlans.isCurrent })
    .from(demandPlans)
    .where(eq(demandPlans.id, demandPlanId))
    .limit(1);
  if (!plan) {
    throw new PurchaseError('DEMAND_PLAN_NOT_FOUND', '需求计划不存在', 404);
  }
  if (!plan.isCurrent) {
    throw new PurchaseError(
      'DEMAND_PLAN_SUPERSEDED',
      '该需求计划已被新版本替代，请使用当前版本',
      409
    );
  }
  return plan.id;
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
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  if (!shopId && !warehouseId) {
    return c.json({ code: 'INVALID_QUERY', message: 'shopId 或 warehouseId 必填' }, 400);
  }
  if (shopId && warehouseId) {
    return c.json({ code: 'INVALID_QUERY', message: 'shopId 与 warehouseId 只能二选一' }, 400);
  }
  const denied = shopId
    ? await guardPermission(c, 'purchases.read', { shopId })
    : await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const db = await getDb();
  const status = c.req.query('status')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [
    shopId ? eq(purchaseOrders.shopId, shopId) : eq(purchaseOrders.warehouseId, warehouseId)
  ];
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
        warehouseId: purchaseOrders.warehouseId,
        warehouseName: warehouses.name,
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
        demandPlanId: purchaseOrders.demandPlanId,
        demandPlanNo: demandPlans.planNo,
        createdAt: purchaseOrders.createdAt,
        itemCount: sql<number>`(
          select count(*) from purchase_order_items poi where poi.purchase_order_id = purchase_orders.id
        )::int`,
        /** 已有到货的明细行数：用于前端派生「部分入库」展示，不改变状态枚举 */
        receivedLineCount: sql<number>`(
          select count(*) from purchase_order_items poi
           where poi.purchase_order_id = purchase_orders.id
             and poi.received_quantity > 0
        )::int`
      })
      .from(purchaseOrders)
      .leftJoin(demandPlans, eq(demandPlans.id, purchaseOrders.demandPlanId))
      .leftJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(purchaseOrders).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

/** 总部仓采购可选规格：总部 SKU + 当前仓库库存 + 最近进价 */
purchaseRoutes.get('/purchases/catalog-suggestions', async (c) => {
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  if (!warehouseId) {
    return c.json({ code: 'INVALID_QUERY', message: 'warehouseId 必填' }, 400);
  }
  const denied = await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const db = await getDb();
  const [warehouse] = await db
    .select({ id: warehouses.id, isTest: warehouses.isTest })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) return c.json({ code: 'NOT_FOUND', message: '仓库不存在' }, 404);

  const conditions = [
    eq(catalogSkus.status, 'active'),
    eq(catalogProducts.isTest, warehouse.isTest)
  ];

  const rows = await db
    .select({
      id: catalogSkus.id,
      catalogProductId: catalogSkus.catalogProductId,
      productName: catalogProducts.name,
      specName: catalogSkus.specName,
      unit: catalogSkus.unit,
      quantityMode: catalogSkus.quantityMode,
      stockType: catalogSkus.stockType,
      quantity: sql<string>`coalesce(${warehouseStocks.quantity}, '0')`,
      lastUnitCost: sql<string | null>`(
        select sm.unit_cost
          from stock_movements sm
         where sm.catalog_sku_id = ${catalogSkus.id}
           and sm.location_type = 'warehouse'
           and sm.location_id = ${warehouseId}::uuid
           and sm.movement_type = 'purchase_in'
           and sm.unit_cost is not null
         order by sm.created_at desc
         limit 1
      )`
    })
    .from(catalogSkus)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
    .leftJoin(
      warehouseStocks,
      and(
        eq(warehouseStocks.skuId, catalogSkus.id),
        eq(warehouseStocks.warehouseId, warehouseId)
      )
    )
    .where(and(...conditions))
    .orderBy(asc(catalogProducts.name), asc(catalogSkus.sortOrder));

  return c.json({ items: rows });
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

  const denied = order.shopId
    ? await guardPermission(c, 'purchases.read', { shopId: order.shopId })
    : await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productSkuId: purchaseOrderItems.productSkuId,
      catalogSkuId: purchaseOrderItems.catalogSkuId,
      productId: productSkus.productId,
      productName: sql<string | null>`coalesce(${products.name}, ${catalogProducts.name})`,
      specName: sql<string | null>`coalesce(${productSkus.specName}, ${catalogSkus.specName})`,
      stockType: sql<'tracked' | 'untracked' | null>`coalesce(${productSkus.stockType}::text, ${catalogSkus.stockType}::text)`,
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
    .leftJoin(catalogSkus, eq(catalogSkus.id, purchaseOrderItems.catalogSkuId))
    .leftJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderItems.id));

  const [plan] = order.demandPlanId
    ? await db
        .select({ planNo: demandPlans.planNo })
        .from(demandPlans)
        .where(eq(demandPlans.id, order.demandPlanId))
        .limit(1)
    : [];
  const [warehouse] = order.warehouseId
    ? await db
        .select({ name: warehouses.name })
        .from(warehouses)
        .where(eq(warehouses.id, order.warehouseId))
        .limit(1)
    : [];

  // 入库质检记录：仓库采购的历史到货与拒收明细，供详情页展示与对账
  const receiptRows = await db
    .select({
      id: purchaseReceipts.id,
      receiptNo: purchaseReceipts.receiptNo,
      status: purchaseReceipts.status,
      receivedAt: purchaseReceipts.receivedAt,
      receivedAmount: purchaseReceipts.receivedAmount,
      remark: purchaseReceipts.remark
    })
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.purchaseOrderId, id))
    .orderBy(desc(purchaseReceipts.receivedAt));
  const receiptItemRows = receiptRows.length
    ? await db
        .select({
          id: purchaseReceiptItems.id,
          receiptId: purchaseReceiptItems.receiptId,
          purchaseOrderItemId: purchaseReceiptItems.purchaseOrderItemId,
          itemName: purchaseReceiptItems.itemName,
          unit: purchaseReceiptItems.unit,
          expectedQuantity: purchaseReceiptItems.expectedQuantity,
          receivedQuantity: purchaseReceiptItems.receivedQuantity,
          qualifiedQuantity: purchaseReceiptItems.qualifiedQuantity,
          rejectedQuantity: purchaseReceiptItems.rejectedQuantity,
          unitCost: purchaseReceiptItems.unitCost,
          amount: purchaseReceiptItems.amount,
          differenceReason: purchaseReceiptItems.differenceReason,
          remark: purchaseReceiptItems.remark
        })
        .from(purchaseReceiptItems)
        .where(
          inArray(
            purchaseReceiptItems.receiptId,
            receiptRows.map((row) => row.id)
          )
        )
    : [];
  const receipts = receiptRows.map((receipt) => ({
    ...receipt,
    items: receiptItemRows.filter((item) => item.receiptId === receipt.id)
  }));

  return c.json({
    item: {
      ...order,
      warehouseName: warehouse?.name ?? null,
      demandPlanNo: plan?.planNo ?? null,
      receivedLineCount: items.filter((item) => Number(item.receivedQuantity) > 0).length,
      items,
      receipts
    }
  });
});

purchaseRoutes.post('/purchases', async (c) => {
  const parsed = createPurchaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  }
  const data = parsed.data;
  const shopId = data.shopId ?? null;
  const warehouseId = data.warehouseId ?? null;
  const denied = shopId
    ? await guardPermission(c, 'purchases.write', { shopId })
    : await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  const db = await getDb();
  try {
    const subject = { shopId, warehouseId };
    const supplier = await resolveSupplierSnapshot(
      db,
      subject,
      data.supplierId,
      data.supplierName,
      data.supplierPhone
    );
    const items = await resolvePurchaseItems(db, subject, data.items);
    const demandPlanId = await resolveDemandPlanId(db, data.demandPlanId);
    const orderedAmount = addMoney(items.map((item) => item.amount));
    const admin = c.get('admin');
    const expectedAt = parseExpectedAt(data.expectedAt);
    // 测试门店/仓库下的采购单继承测试标记，便于整体清理
    const orderIsTest = shopId
      ? (
          await db
            .select({ isTest: shops.isTest })
            .from(shops)
            .where(eq(shops.id, shopId))
            .limit(1)
        )[0]?.isTest ?? false
      : (
          await db
            .select({ isTest: warehouses.isTest })
            .from(warehouses)
            .where(eq(warehouses.id, warehouseId!))
            .limit(1)
        )[0]?.isTest ?? false;

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          shopId,
          warehouseId,
          poNo: generatePoNo(warehouseId ? 'WH' : 'PO'),
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          supplierPhone: supplier.supplierPhone,
          demandPlanId,
          status: 'draft',
          orderedAmount,
          expectedAt,
          createdByAdminId: admin?.sub ?? null,
          remark: data.remark ?? null,
          isTest: orderIsTest
        })
        .returning({ id: purchaseOrders.id, poNo: purchaseOrders.poNo });

      await tx.insert(purchaseOrderItems).values(
        items.map((item) => ({
          purchaseOrderId: order.id,
          productSkuId: item.productSkuId,
          catalogSkuId: item.catalogSkuId,
          itemName: item.itemName,
          unit: item.unit,
          quantityMode: item.quantityMode,
          quantity: item.quantity,
          unitCost: item.unitCost,
          receivedQuantity: '0.00',
          amount: item.amount,
          isTest: orderIsTest
        }))
      );

      if (supplier.supplierId) {
        await tx
          .update(suppliers)
          .set({ lastPurchaseAt: new Date() })
          .where(eq(suppliers.id, supplier.supplierId));
      }

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
      warehouseId: purchaseOrders.warehouseId,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      supplierPhone: purchaseOrders.supplierPhone,
      isTest: purchaseOrders.isTest
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = current.shopId
    ? await guardPermission(c, 'purchases.write', { shopId: current.shopId })
    : await guardPermission(c, 'warehouse.write');
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
    const subject = { shopId: current.shopId, warehouseId: current.warehouseId };
    const supplier = supplierTouched
      ? await resolveSupplierSnapshot(
          db,
          subject,
          data.supplierId === undefined ? current.supplierId : data.supplierId,
          data.supplierName === undefined ? current.supplierName : data.supplierName,
          data.supplierPhone === undefined ? current.supplierPhone : data.supplierPhone
        )
      : null;
    const items = data.items
      ? await resolvePurchaseItems(db, subject, data.items)
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
            catalogSkuId: item.catalogSkuId,
            itemName: item.itemName,
            unit: item.unit,
            quantityMode: item.quantityMode,
            quantity: item.quantity,
            unitCost: item.unitCost,
            receivedQuantity: '0.00',
            amount: item.amount,
            isTest: current.isTest
          }))
        );
      }

      const effectiveSupplierId = supplier ? supplier.supplierId : current.supplierId;
      if (effectiveSupplierId) {
        await tx
          .update(suppliers)
          .set({ lastPurchaseAt: new Date() })
          .where(eq(suppliers.id, effectiveSupplierId));
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
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      warehouseId: purchaseOrders.warehouseId,
      status: purchaseOrders.status
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = current.shopId
    ? await guardPermission(c, 'purchases.write', { shopId: current.shopId })
    : await guardPermission(c, 'warehouse.write');
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
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      warehouseId: purchaseOrders.warehouseId,
      status: purchaseOrders.status
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!current) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  const denied = current.shopId
    ? await guardPermission(c, 'purchases.write', { shopId: current.shopId })
    : await guardPermission(c, 'warehouse.write');
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
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      warehouseId: purchaseOrders.warehouseId
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);
  if (order.warehouseId) {
    return c.json(
      {
        code: 'RECEIVE_REQUIRES_RECEIPT',
        message: '总部仓采购请使用「入库质检」，不支持直接入库'
      },
      409
    );
  }

  const denied = order.shopId
    ? await guardPermission(c, 'purchases.write', { shopId: order.shopId })
    : await guardPermission(c, 'warehouse.write');
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
          catalogSkuId: purchaseOrderItems.catalogSkuId,
          itemName: purchaseOrderItems.itemName,
          unit: purchaseOrderItems.unit,
          quantityMode: purchaseOrderItems.quantityMode,
          quantity: purchaseOrderItems.quantity,
          unitCost: purchaseOrderItems.unitCost,
          stockType: sql<'tracked' | 'untracked' | null>`coalesce(${productSkus.stockType}::text, ${catalogSkus.stockType}::text)`
        })
        .from(purchaseOrderItems)
        .leftJoin(productSkus, eq(productSkus.id, purchaseOrderItems.productSkuId))
        .leftJoin(catalogSkus, eq(catalogSkus.id, purchaseOrderItems.catalogSkuId))
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
            .select({ quantity: productSkuStocks.quantity, isTest: productSkuStocks.isTest })
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
          if (stock.isTest !== locked.isTest) {
            throw new PurchaseError(
              'TEST_DATA_MISMATCH',
              '测试采购单与库存行的测试标记不一致，请使用测试门店的库存行',
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
            shopId: locked.shopId!,
            locationType: 'shop',
            locationId: locked.shopId!,
            productSkuId: item.productSkuId,
            movementType: 'purchase_in',
            quantityChange: received,
            balanceAfter: after,
            unitCost,
            referenceType: 'purchase_order',
            referenceId: locked.id,
            operatorAdminId: admin?.sub ?? null,
            remark: `采购入库 ${locked.poNo}`,
            isTest: locked.isTest
          });
        }

        // 总部仓采购入库：写 warehouse_stocks（按 catalog_skus），流水 location_type = warehouse
        if (
          locked.warehouseId &&
          item.catalogSkuId &&
          item.stockType === 'tracked' &&
          Number(received) > 0
        ) {
          const [stock] = await tx
            .select({
              quantity: warehouseStocks.quantity,
              isTest: warehouseStocks.isTest
            })
            .from(warehouseStocks)
            .where(
              and(
                eq(warehouseStocks.warehouseId, locked.warehouseId),
                eq(warehouseStocks.skuId, item.catalogSkuId)
              )
            )
            .for('update');
          if (stock && stock.isTest !== locked.isTest) {
            throw new PurchaseError(
              'TEST_DATA_MISMATCH',
              '测试采购单与仓库库存行的测试标记不一致',
              409
            );
          }

          const afterCents =
            Math.round(Number(stock?.quantity ?? 0) * 100) +
            Math.round(Number(received) * 100);
          const after = (afterCents / 100).toFixed(2);

          if (stock) {
            await tx
              .update(warehouseStocks)
              .set({ quantity: after, updatedAt: new Date() })
              .where(
                and(
                  eq(warehouseStocks.warehouseId, locked.warehouseId),
                  eq(warehouseStocks.skuId, item.catalogSkuId)
                )
              );
          } else {
            await tx.insert(warehouseStocks).values({
              warehouseId: locked.warehouseId,
              skuId: item.catalogSkuId,
              quantity: after,
              isTest: locked.isTest
            });
          }

          await tx.insert(stockMovements).values({
            shopId: null,
            locationType: 'warehouse',
            locationId: locked.warehouseId,
            productSkuId: null,
            catalogSkuId: item.catalogSkuId,
            movementType: 'purchase_in',
            quantityChange: received,
            balanceAfter: after,
            unitCost,
            referenceType: 'purchase_order',
            referenceId: locked.id,
            operatorAdminId: admin?.sub ?? null,
            remark: `总部仓采购入库 ${locked.poNo}`,
            isTest: locked.isTest
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

/** 入库质检差异原因字典，与 purchase_receipt_items.difference_reason 约束一致 */
const RECEIPT_DIFFERENCE_REASONS = [
  'shortage',
  'damaged',
  'expired',
  'spec_mismatch',
  'other'
] as const;

const purchaseReceiptSchema = z.object({
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.uuid('采购明细 ID 不合法'),
        receivedQuantity: z.union([z.string(), z.number()]),
        /** 不传时按「全部合格」处理；传了则以传入为准 */
        qualifiedQuantity: z.union([z.string(), z.number()]).optional(),
        rejectedQuantity: z.union([z.string(), z.number()]).optional(),
        /** 本次到货实价，缺省沿用采购单价 */
        unitCost: z.number().min(0, '单价不能为负').max(99999999).optional(),
        differenceReason: z.enum(RECEIPT_DIFFERENCE_REASONS).nullish(),
        remark: z.string().trim().max(200).nullish()
      })
    )
    .min(1, '至少一条质检明细')
    .max(200),
  remark: z.string().trim().max(500).nullish(),
  /** 也支持通过 Idempotency-Key 请求头传入 */
  idempotencyKey: z.string().trim().max(120).nullish()
});

type ReceiptLine = {
  purchaseOrderItemId: string;
  itemName: string;
  unit: string;
  expectedQuantity: string;
  receivedQuantity: string;
  qualifiedQuantity: string;
  rejectedQuantity: string;
  unitCost: string;
  amount: string;
  differenceReason: string | null;
  remark: string | null;
};

/**
 * 总部仓采购入库质检：只把合格数量写入 warehouse_stocks 并生成仓库入库流水；
 * 不合格数量不增库存，作为拒收记录保留在 purchase_receipt_items。
 * 采购单状态不改枚举：全部收满转 received，否则保持 submitted，由明细已收数量派生「部分入库」。
 */
purchaseRoutes.post('/purchases/:id/receipts', async (c) => {
  const parsed = purchaseReceiptSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const id = c.req.param('id');
  const [order] = await db
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      warehouseId: purchaseOrders.warehouseId,
      poNo: purchaseOrders.poNo,
      status: purchaseOrders.status,
      isTest: purchaseOrders.isTest
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);

  if (!order.warehouseId) {
    return c.json(
      {
        code: 'RECEIPT_REQUIRES_WAREHOUSE',
        message: '入库质检仅支持总部仓采购，门店采购请使用「入库」'
      },
      409
    );
  }
  const denied = await guardPermission(c, 'warehouse.write');
  if (denied) return denied;

  // 幂等：优先用调用方传入的键，未传时按请求内容派生，保证同一笔提交重试不重复入库
  const requestHash = hashIdempotencyRequest({
    purchaseOrderId: id,
    items: parsed.data.items,
    remark: parsed.data.remark ?? null
  });
  const idempotencyKey =
    c.req.header('Idempotency-Key')?.trim() ||
    parsed.data.idempotencyKey?.trim() ||
    `auto-${requestHash.slice(0, 40)}`;
  const acquired = await acquireIdempotencyKey(db, {
    scope: 'purchase_receipt',
    key: idempotencyKey,
    requestHash
  });
  if (acquired.state === 'replayed') {
    return c.json(acquired.response ?? { ok: true, replayed: true });
  }
  if (acquired.state === 'conflict') {
    return c.json(
      {
        code: acquired.reason === 'in_progress' ? 'RECEIPT_IN_PROGRESS' : 'IDEMPOTENCY_CONFLICT',
        message:
          acquired.reason === 'in_progress'
            ? '该入库请求正在处理，请稍后重试'
            : '同一幂等键的请求内容不一致，请更换幂等键'
      },
      409
    );
  }

  const admin = c.get('admin');
  const inputMap = new Map(
    parsed.data.items.map((item) => [item.purchaseOrderItemId, item])
  );

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, id))
        .for('update');
      if (!locked) throw new PurchaseError('NOT_FOUND', '采购单不存在', 404);
      if (locked.status === 'received') {
        throw new PurchaseError('PURCHASE_ALREADY_RECEIVED', '该采购单已全部入库', 409);
      }
      if (locked.status !== 'submitted') {
        throw new PurchaseError('PURCHASE_NOT_EDITABLE', '只有已提交的采购单可入库质检', 409);
      }

      const items = await tx
        .select({
          id: purchaseOrderItems.id,
          catalogSkuId: purchaseOrderItems.catalogSkuId,
          itemName: purchaseOrderItems.itemName,
          unit: purchaseOrderItems.unit,
          quantityMode: purchaseOrderItems.quantityMode,
          quantity: purchaseOrderItems.quantity,
          unitCost: purchaseOrderItems.unitCost,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
          differenceReason: purchaseOrderItems.differenceReason,
          stockType: sql<'tracked' | 'untracked' | null>`${catalogSkus.stockType}::text`
        })
        .from(purchaseOrderItems)
        .leftJoin(catalogSkus, eq(catalogSkus.id, purchaseOrderItems.catalogSkuId))
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
      const itemMap = new Map(items.map((item) => [item.id, item]));

      const receiptLines: ReceiptLine[] = [];
      const stockUpdates: Array<{
        itemId: string;
        catalogSkuId: string;
        itemName: string;
        qualified: string;
        unitCost: string;
      }> = [];
      let hasInbound = false;

      for (const item of items) {
        const input = inputMap.get(item.id);
        const remainingCents =
          Math.round(Number(item.quantity) * 100) - Math.round(Number(item.receivedQuantity) * 100);
        const expectedQuantity = (Math.max(remainingCents, 0) / 100).toFixed(2);

        if (!input) {
          // 未提交的行按本次未到货记录，保留完整到货台账
          receiptLines.push({
            purchaseOrderItemId: item.id,
            itemName: item.itemName,
            unit: item.unit,
            expectedQuantity,
            receivedQuantity: '0.00',
            qualifiedQuantity: '0.00',
            rejectedQuantity: '0.00',
            unitCost: item.unitCost,
            amount: '0.00',
            differenceReason: null,
            remark: null
          });
          continue;
        }

        const received = normalizeQuantity(input.receivedQuantity, item.quantityMode);
        if (received === null) {
          throw new PurchaseError(
            'INVALID_QUANTITY_PRECISION',
            `${item.itemName} 的实收数量不符合其数量模式`,
            400
          );
        }
        if (Math.round(Number(received) * 100) > remainingCents) {
          throw new PurchaseError(
            'RECEIPT_EXCEEDS_ORDER',
            `${item.itemName} 实收 ${received} 超过应收 ${expectedQuantity}`,
            409
          );
        }

        // 合格/不合格缺省规则：都未传按全合格；只传不合格时合格 = 实收 - 不合格
        const qualifiedRaw =
          input.qualifiedQuantity !== undefined
            ? input.qualifiedQuantity
            : input.rejectedQuantity !== undefined
              ? (Math.round(Number(received) * 100) -
                  Math.round(Number(input.rejectedQuantity) * 100)) /
                100
              : received;
        const rejectedRaw =
          input.rejectedQuantity !== undefined
            ? input.rejectedQuantity
            : (Math.round(Number(received) * 100) -
                Math.round(Number(qualifiedRaw) * 100)) /
              100;

        const qualified = normalizeQuantity(qualifiedRaw, item.quantityMode);
        const rejected = normalizeQuantity(rejectedRaw, item.quantityMode);
        if (qualified === null || rejected === null) {
          throw new PurchaseError(
            'INVALID_QUANTITY_PRECISION',
            `${item.itemName} 的合格/不合格数量不符合其数量模式`,
            400
          );
        }
        if (
          Math.round(Number(qualified) * 100) + Math.round(Number(rejected) * 100) !==
          Math.round(Number(received) * 100)
        ) {
          throw new PurchaseError(
            'RECEIPT_QUANTITY_MISMATCH',
            `${item.itemName} 的合格 + 不合格必须等于实收数量`,
            400
          );
        }
        if (Number(rejected) > 0 && !input.differenceReason) {
          throw new PurchaseError(
            'RECEIPT_REASON_REQUIRED',
            `${item.itemName} 有不合格数量，请选择差异原因`,
            400
          );
        }

        const unitCost = (input.unitCost ?? Number(item.unitCost)).toFixed(2);
        const amount = roundAmount(qualified, unitCost);
        if (Number(qualified) > 0) hasInbound = true;

        receiptLines.push({
          purchaseOrderItemId: item.id,
          itemName: item.itemName,
          unit: item.unit,
          expectedQuantity,
          receivedQuantity: received,
          qualifiedQuantity: qualified,
          rejectedQuantity: rejected,
          unitCost,
          amount,
          differenceReason: input.differenceReason ?? null,
          remark: input.remark ?? null
        });

        if (Number(qualified) > 0 && item.catalogSkuId && item.stockType === 'tracked') {
          stockUpdates.push({
            itemId: item.id,
            catalogSkuId: item.catalogSkuId,
            itemName: item.itemName,
            qualified,
            unitCost
          });
        }
      }

      if (!hasInbound && !receiptLines.some((line) => Number(line.receivedQuantity) > 0)) {
        throw new PurchaseError('RECEIPT_EMPTY', '本次没有任何到货数量，无需生成质检单', 400);
      }

      const receiptNo = generateDocumentNo('PR');
      const receivedAmount = addMoney(receiptLines.map((line) => line.amount));

      const [receipt] = await tx
        .insert(purchaseReceipts)
        .values({
          receiptNo,
          purchaseOrderId: locked.id,
          warehouseId: locked.warehouseId!,
          status: 'posted',
          receivedAt: new Date(),
          receivedByAdminId: admin?.sub ?? null,
          receivedAmount,
          remark: parsed.data.remark ?? null,
          isTest: locked.isTest
        })
        .returning({
          id: purchaseReceipts.id,
          receiptNo: purchaseReceipts.receiptNo,
          status: purchaseReceipts.status,
          receivedAt: purchaseReceipts.receivedAt
        });

      await tx.insert(purchaseReceiptItems).values(
        receiptLines.map((line) => ({
          receiptId: receipt.id,
          purchaseOrderItemId: line.purchaseOrderItemId,
          catalogSkuId:
            itemMap.get(line.purchaseOrderItemId)?.catalogSkuId ?? null,
          itemName: line.itemName,
          unit: line.unit,
          quantityMode: itemMap.get(line.purchaseOrderItemId)!.quantityMode,
          expectedQuantity: line.expectedQuantity,
          receivedQuantity: line.receivedQuantity,
          qualifiedQuantity: line.qualifiedQuantity,
          rejectedQuantity: line.rejectedQuantity,
          unitCost: line.unitCost,
          amount: line.amount,
          differenceReason: line.differenceReason,
          remark: line.remark,
          isTest: locked.isTest
        }))
      );

      // 只对合格数量做仓库入库与移动加权成本
      for (const update of stockUpdates) {
        const [stock] = await tx
          .select({
            quantity: warehouseStocks.quantity,
            avgUnitCost: warehouseStocks.avgUnitCost,
            isTest: warehouseStocks.isTest
          })
          .from(warehouseStocks)
          .where(
            and(
              eq(warehouseStocks.warehouseId, locked.warehouseId!),
              eq(warehouseStocks.skuId, update.catalogSkuId)
            )
          )
          .for('update');
        if (stock && stock.isTest !== locked.isTest) {
          throw new PurchaseError(
            'TEST_DATA_MISMATCH',
            '测试采购单与仓库库存行的测试标记不一致',
            409
          );
        }

        const oldQty = Number(stock?.quantity ?? 0);
        const oldAvg = Number(stock?.avgUnitCost ?? 0);
        const addQty = Number(update.qualified);
        const newQty = oldQty + addQty;
        const newAvg =
          newQty > 0 ? (oldQty * oldAvg + addQty * Number(update.unitCost)) / newQty : oldAvg;
        const after = newQty.toFixed(2);
        const avgUnitCost = newAvg.toFixed(2);

        if (stock) {
          await tx
            .update(warehouseStocks)
            .set({ quantity: after, avgUnitCost, updatedAt: new Date() })
            .where(
              and(
                eq(warehouseStocks.warehouseId, locked.warehouseId!),
                eq(warehouseStocks.skuId, update.catalogSkuId)
              )
            );
        } else {
          await tx.insert(warehouseStocks).values({
            warehouseId: locked.warehouseId!,
            skuId: update.catalogSkuId,
            quantity: after,
            avgUnitCost,
            isTest: locked.isTest
          });
        }

        await tx.insert(stockMovements).values({
          shopId: null,
          locationType: 'warehouse',
          locationId: locked.warehouseId!,
          productSkuId: null,
          catalogSkuId: update.catalogSkuId,
          movementType: 'purchase_in',
          quantityChange: update.qualified,
          balanceAfter: after,
          unitCost: update.unitCost,
          referenceType: 'purchase_receipt',
          referenceId: receipt.id,
          operatorAdminId: admin?.sub ?? null,
          remark: `总部仓采购质检入库 ${locked.poNo} / ${receipt.receiptNo}`,
          isTest: locked.isTest
        });
      }

      // 累计已收数量与最近一次到货实价；差异原因按本次填写覆盖
      for (const line of receiptLines) {
        const item = itemMap.get(line.purchaseOrderItemId)!;
        const receivedTotalCents =
          Math.round(Number(item.receivedQuantity) * 100) +
          Math.round(Number(line.receivedQuantity) * 100);
        const receivedTotal = (receivedTotalCents / 100).toFixed(2);
        await tx
          .update(purchaseOrderItems)
          .set({
            receivedQuantity: receivedTotal,
            unitCost: line.unitCost,
            differenceReason: line.differenceReason ?? item.differenceReason
          })
          .where(eq(purchaseOrderItems.id, item.id));
      }

      const fullyReceived = items.every((item) => {
        const line = receiptLines.find((row) => row.purchaseOrderItemId === item.id)!;
        const totalCents =
          Math.round(Number(item.receivedQuantity) * 100) +
          Math.round(Number(line.receivedQuantity) * 100);
        return totalCents >= Math.round(Number(item.quantity) * 100);
      });
      const nextStatus = fullyReceived ? 'received' : 'submitted';
      const receivedAmountTotal = addMoney([locked.receivedAmount, receivedAmount]);

      await tx
        .update(purchaseOrders)
        .set({
          status: nextStatus,
          receivedAmount: receivedAmountTotal,
          receivedAt: fullyReceived ? new Date() : locked.receivedAt,
          receivedByAdminId: admin?.sub ?? null,
          updatedAt: new Date()
        })
        .where(eq(purchaseOrders.id, locked.id));

      await recordDocumentEvent(tx, {
        documentType: 'purchase_receipt',
        documentId: receipt.id,
        fromStatus: DOCUMENT_NEW_STATE,
        toStatus: 'posted',
        operatorAdminId: admin?.sub ?? null,
        payload: {
          receiptNo: receipt.receiptNo,
          purchaseOrderId: locked.id,
          poNo: locked.poNo,
          receivedAmount,
          partial: !fullyReceived,
          lines: receiptLines.map((line) => ({
            itemName: line.itemName,
            expectedQuantity: line.expectedQuantity,
            receivedQuantity: line.receivedQuantity,
            qualifiedQuantity: line.qualifiedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            differenceReason: line.differenceReason
          }))
        },
        isTest: locked.isTest
      });

      await recordDocumentEvent(tx, {
        documentType: 'purchase_order',
        documentId: locked.id,
        fromStatus: locked.status,
        toStatus: nextStatus,
        operatorAdminId: admin?.sub ?? null,
        reason: fullyReceived ? '质检入库完成' : '部分入库',
        payload: {
          poNo: locked.poNo,
          receiptNo: receipt.receiptNo,
          receivedAmount,
          partial: !fullyReceived
        },
        isTest: locked.isTest
      });

      const payload = {
        ok: true,
        item: {
          id: receipt.id,
          receiptNo: receipt.receiptNo,
          status: 'posted' as const,
          purchaseOrderId: locked.id,
          purchaseOrderStatus: nextStatus,
          partial: !fullyReceived,
          receivedAmount,
          receivedAmountTotal,
          receivedLineCount: receiptLines.filter(
            (line) => Number(line.receivedQuantity) > 0
          ).length,
          completedLineCount: items.filter((item) => {
            const line = receiptLines.find((row) => row.purchaseOrderItemId === item.id)!;
            return (
              Math.round(Number(item.receivedQuantity) * 100) +
                Math.round(Number(line.receivedQuantity) * 100) >=
              Math.round(Number(item.quantity) * 100)
            );
          }).length,
          itemCount: items.length,
          lines: receiptLines.map((line) => ({
            purchaseOrderItemId: line.purchaseOrderItemId,
            itemName: line.itemName,
            unit: line.unit,
            expectedQuantity: line.expectedQuantity,
            receivedQuantity: line.receivedQuantity,
            qualifiedQuantity: line.qualifiedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            unitCost: line.unitCost,
            amount: line.amount,
            differenceReason: line.differenceReason
          }))
        }
      };

      await completeIdempotencyKey(tx, acquired.key, payload);
      return payload;
    });

    return c.json(result);
  } catch (error) {
    await releaseIdempotencyKey(db, acquired.key);
    if (error instanceof PurchaseError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    if (isUniqueViolation(error)) {
      return c.json({ code: 'RECEIPT_NO_CONFLICT', message: '入库单号冲突，请重试' }, 409);
    }
    throw error;
  }
});

/** 采购单的入库质检记录（含拒收明细） */
purchaseRoutes.get('/purchases/:id/receipts', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [order] = await db
    .select({
      id: purchaseOrders.id,
      shopId: purchaseOrders.shopId,
      warehouseId: purchaseOrders.warehouseId
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return c.json({ code: 'NOT_FOUND', message: '采购单不存在' }, 404);
  const denied = order.shopId
    ? await guardPermission(c, 'purchases.read', { shopId: order.shopId })
    : await guardPermission(c, 'warehouse.read');
  if (denied) return denied;

  const rows = await db
    .select()
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.purchaseOrderId, id))
    .orderBy(desc(purchaseReceipts.receivedAt));
  const lineRows = rows.length
    ? await db
        .select()
        .from(purchaseReceiptItems)
        .where(
          inArray(
            purchaseReceiptItems.receiptId,
            rows.map((row) => row.id)
          )
        )
    : [];
  return c.json({
    items: rows.map((row) => ({
      ...row,
      items: lineRows.filter((line) => line.receiptId === row.id)
    }))
  });
});

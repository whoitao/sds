import { Hono } from 'hono';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminUserShops,
  adminUsers,
  catalogCategories,
  catalogProducts,
  catalogSkus,
  documentEvents,
  getDb,
  productSkuStocks,
  productSkus,
  products,
  shopRequisitionItems,
  shopRequisitions,
  shops
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds, canAccessShop, isSuperAdmin } from '../lib/shop-scope.js';
import {
  DOCUMENT_NEW_STATE,
  DocumentRuleError,
  assertTransition,
  generateDocumentNo,
  recordDocumentEvent
} from '../lib/documents.js';

/** 门店要货单：草稿 → 已提交 → 已审核 / 已撤回 */
export const requisitionRoutes = new Hono<AdminEnv>();

requisitionRoutes.use('*', requireAdmin);

const REQUISITION_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已审核',
  withdrawn: '已撤回'
};

const REQUISITION_MACHINE = {
  [DOCUMENT_NEW_STATE]: ['draft'],
  draft: ['submitted'],
  submitted: ['approved', 'withdrawn'],
  approved: [],
  withdrawn: []
} as const;

const TIME_WINDOWS = ['morning', 'afternoon', 'all_day'] as const;

const itemInputSchema = z.object({
  productSkuId: z.uuid('SKU ID 不合法'),
  requestedQty: z.union([z.string(), z.number()]),
  remark: z.string().trim().max(200).nullish()
});

const createSchema = z.object({
  shopId: z.uuid('门店 ID 不合法'),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '交付日期格式应为 YYYY-MM-DD'),
  timeWindow: z.enum(TIME_WINDOWS).optional(),
  remark: z.string().trim().max(500).nullish(),
  items: z.array(itemInputSchema).min(1, '至少需要一条要货明细').max(200)
});

const updateSchema = z
  .object({
    expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timeWindow: z.enum(TIME_WINDOWS).optional(),
    remark: z.string().trim().max(500).nullish(),
    items: z.array(itemInputSchema).min(1).max(200).optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const actionSchema = z.object({
  reason: z.string().trim().max(200).nullish()
});

const shopScopeSchema = z.object({
  shopIds: z.array(z.uuid('门店 ID 不合法')).max(200)
});

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

function normalizeQty(value: string | number) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new DocumentRuleError('INVALID_QUANTITY', '要货数量必须大于 0', 400);
  }
  if (qty > 999999999) {
    throw new DocumentRuleError('INVALID_QUANTITY', '要货数量过大', 400);
  }
  return qty.toFixed(2);
}

type ItemInput = z.infer<typeof itemInputSchema>;

/** 按门店 SKU 反查总部 SKU/商品/分类，快照落库，避免前端伪造名称或单位。 */
async function resolveItems(shopId: string, inputs: ItemInput[]) {
  const db = await getDb();
  const ids = [...new Set(inputs.map((item) => item.productSkuId))];
  if (ids.length !== inputs.length) {
    throw new DocumentRuleError('DUPLICATE_SKU', '同一规格不能重复添加', 400);
  }

  const rows = await db
    .select({
      id: productSkus.id,
      shopId: productSkus.shopId,
      catalogSkuId: productSkus.catalogSkuId,
      stockType: productSkus.stockType,
      specName: productSkus.specName,
      unit: productSkus.unit,
      productName: products.name,
      catalogProductName: catalogProducts.name,
      catalogSpecName: catalogSkus.specName,
      catalogUnit: catalogSkus.unit,
      categoryId: catalogProducts.categoryId,
      categoryName: catalogCategories.name
    })
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .leftJoin(catalogSkus, eq(catalogSkus.id, productSkus.catalogSkuId))
    .leftJoin(catalogProducts, eq(catalogProducts.id, catalogSkus.catalogProductId))
    .leftJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
    .where(inArray(productSkus.id, ids));

  if (rows.length !== ids.length) {
    throw new DocumentRuleError('SKU_NOT_FOUND', '包含不存在的商品规格', 400);
  }

  return inputs.map((input) => {
    const sku = rows.find((row) => row.id === input.productSkuId)!;
    if (sku.shopId !== shopId) {
      throw new DocumentRuleError('SKU_NOT_IN_SHOP', '商品规格不属于该门店', 400);
    }
    if (sku.stockType !== 'tracked') {
      throw new DocumentRuleError('SKU_NOT_TRACKED', '只有库存规格才能要货', 400);
    }
    if (!sku.catalogSkuId) {
      throw new DocumentRuleError(
        'SKU_WITHOUT_CATALOG',
        '该规格未关联总部 SKU，暂不能要货，请先在店铺商品中关联总部规格',
        400
      );
    }
    return {
      productSkuId: sku.id,
      catalogSkuId: sku.catalogSkuId,
      itemName: sku.catalogProductName ?? sku.productName,
      specName: sku.catalogSpecName ?? sku.specName,
      categoryId: sku.categoryId,
      categoryName: sku.categoryName,
      unit: sku.catalogUnit ?? sku.unit,
      requestedQty: normalizeQty(input.requestedQty),
      remark: input.remark?.trim() || null
    };
  });
}

async function loadRequisitionDetail(id: string) {
  const db = await getDb();
  const [requisition] = await db
    .select({
      id: shopRequisitions.id,
      requisitionNo: shopRequisitions.requisitionNo,
      shopId: shopRequisitions.shopId,
      shopName: shops.name,
      expectedDate: shopRequisitions.expectedDate,
      timeWindow: shopRequisitions.timeWindow,
      status: shopRequisitions.status,
      remark: shopRequisitions.remark,
      submittedByAdminId: shopRequisitions.submittedByAdminId,
      submittedAt: shopRequisitions.submittedAt,
      reviewedByAdminId: shopRequisitions.reviewedByAdminId,
      reviewedAt: shopRequisitions.reviewedAt,
      reviewNote: shopRequisitions.reviewNote,
      createdByAdminId: shopRequisitions.createdByAdminId,
      isTest: shopRequisitions.isTest,
      createdAt: shopRequisitions.createdAt,
      updatedAt: shopRequisitions.updatedAt
    })
    .from(shopRequisitions)
    .innerJoin(shops, eq(shops.id, shopRequisitions.shopId))
    .where(eq(shopRequisitions.id, id))
    .limit(1);
  if (!requisition) return null;

  const [items, events] = await Promise.all([
    db
      .select()
      .from(shopRequisitionItems)
      .where(eq(shopRequisitionItems.requisitionId, id))
      .orderBy(asc(shopRequisitionItems.categoryName), asc(shopRequisitionItems.itemName)),
    db
      .select()
      .from(documentEvents)
      .where(
        and(
          eq(documentEvents.documentType, 'shop_requisition'),
          eq(documentEvents.documentId, id)
        )
      )
      .orderBy(asc(documentEvents.createdAt))
  ]);

  return { ...requisition, statusLabel: REQUISITION_STATUS_LABELS[requisition.status], items, events };
}

requisitionRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'requisitions.read');
  if (denied) return denied;

  const admin = c.get('admin');
  const db = await getDb();
  const shopId = c.req.query('shopId')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const expectedDate = c.req.query('expectedDate')?.trim() ?? '';
  const keyword = c.req.query('keyword')?.trim() ?? '';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [];
  if (shopId) {
    if (!(await canAccessShop(admin.sub, shopId))) {
      return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
    }
    conditions.push(eq(shopRequisitions.shopId, shopId));
  } else {
    const ids = await accessibleShopIds(admin.sub);
    if (ids !== null) {
      if (ids.length === 0) {
        return c.json({ items: [], total: 0, page, pageSize });
      }
      conditions.push(inArray(shopRequisitions.shopId, ids));
    }
  }
  if (status && status in REQUISITION_STATUS_LABELS) {
    conditions.push(eq(shopRequisitions.status, status));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    conditions.push(eq(shopRequisitions.expectedDate, expectedDate));
  }
  if (keyword) {
    conditions.push(
      or(
        ilike(shopRequisitions.requisitionNo, `%${keyword}%`),
        ilike(shops.name, `%${keyword}%`)
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: shopRequisitions.id,
        requisitionNo: shopRequisitions.requisitionNo,
        shopId: shopRequisitions.shopId,
        shopName: shops.name,
        expectedDate: shopRequisitions.expectedDate,
        timeWindow: shopRequisitions.timeWindow,
        status: shopRequisitions.status,
        remark: shopRequisitions.remark,
        submittedAt: shopRequisitions.submittedAt,
        reviewedAt: shopRequisitions.reviewedAt,
        createdAt: shopRequisitions.createdAt,
        updatedAt: shopRequisitions.updatedAt,
        itemCount: sql<number>`(
          select count(*) from shop_requisition_items i
          where i.requisition_id = shop_requisitions.id
        )::int`
      })
      .from(shopRequisitions)
      .innerJoin(shops, eq(shops.id, shopRequisitions.shopId))
      .where(where)
      .orderBy(desc(shopRequisitions.expectedDate), desc(shopRequisitions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(shopRequisitions)
      .innerJoin(shops, eq(shops.id, shopRequisitions.shopId))
      .where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

/** 低库存建议：只返回已关联总部 SKU、且被追踪库存的门店规格。 */
requisitionRoutes.get('/suggestions', async (c) => {
  const shopId = c.req.query('shopId')?.trim() ?? '';
  if (!shopId) return c.json({ code: 'INVALID_QUERY', message: 'shopId 必填' }, 400);
  const denied = await guardPermission(c, 'requisitions.read', { shopId });
  if (denied) return denied;

  const admin = c.get('admin');
  if (!(await canAccessShop(admin.sub, shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
  }

  const db = await getDb();
  const result = await db.execute(sql`
    select
      ps.id as "skuId",
      ps.catalog_sku_id as "catalogSkuId",
      p.name as "productName",
      ps.spec_name as "specName",
      ps.unit,
      st.quantity,
      st.min_threshold as "minThreshold",
      st.max_threshold as "maxThreshold",
      greatest(coalesce(st.max_threshold, st.min_threshold * 2) - st.quantity, 0) as "suggestedQuantity",
      cp.category_id as "categoryId",
      cc.name as "categoryName"
    from product_skus ps
    join products p on p.id = ps.product_id
    join product_sku_stocks st on st.product_sku_id = ps.id
    left join catalog_products cp on cp.id = (
      select cs.catalog_product_id from catalog_skus cs where cs.id = ps.catalog_sku_id
    )
    left join catalog_categories cc on cc.id = cp.category_id
    where ps.shop_id = ${shopId}::uuid
      and ps.stock_type = 'tracked'
      and ps.catalog_sku_id is not null
      and st.quantity <= st.min_threshold
    order by (st.quantity - st.min_threshold) asc, p.name asc
    limit 200
  `);

  return c.json({ items: result.rows });
});

/** 门店范围管理：仅 super_admin 可查看和调整。 */
requisitionRoutes.get('/shop-scope', async (c) => {
  const admin = c.get('admin');
  if (!(await isSuperAdmin(admin.sub))) {
    return c.json({ code: 'FORBIDDEN', message: '只有超级管理员可以管理门店范围' }, 403);
  }

  const db = await getDb();
  const [admins, shopRows, bindings] = await Promise.all([
    db
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
        displayName: adminUsers.displayName,
        status: adminUsers.status
      })
      .from(adminUsers)
      .where(eq(adminUsers.status, 1))
      .orderBy(asc(adminUsers.username)),
    db
      .select({ id: shops.id, name: shops.name, status: shops.status })
      .from(shops)
      .orderBy(asc(shops.name)),
    db
      .select({ adminUserId: adminUserShops.adminUserId, shopId: adminUserShops.shopId })
      .from(adminUserShops)
  ]);

  return c.json({
    admins,
    shops: shopRows,
    items: admins.map((row) => ({
      ...row,
      shopIds: bindings.filter((bind) => bind.adminUserId === row.id).map((bind) => bind.shopId)
    }))
  });
});

requisitionRoutes.put('/shop-scope/:adminId', async (c) => {
  const admin = c.get('admin');
  if (!(await isSuperAdmin(admin.sub))) {
    return c.json({ code: 'FORBIDDEN', message: '只有超级管理员可以管理门店范围' }, 403);
  }

  const parsed = shopScopeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const targetAdminId = c.req.param('adminId');
  const [target] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.id, targetAdminId))
    .limit(1);
  if (!target) return c.json({ code: 'NOT_FOUND', message: '管理员不存在' }, 404);

  const shopIds = [...new Set(parsed.data.shopIds)];
  if (shopIds.length > 0) {
    const found = await db
      .select({ id: shops.id })
      .from(shops)
      .where(inArray(shops.id, shopIds));
    if (found.length !== shopIds.length) {
      return c.json({ code: 'SHOP_NOT_FOUND', message: '包含不存在的门店' }, 400);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(adminUserShops).where(eq(adminUserShops.adminUserId, targetAdminId));
    if (shopIds.length > 0) {
      await tx
        .insert(adminUserShops)
        .values(shopIds.map((shopId) => ({ adminUserId: targetAdminId, shopId })));
    }
  });

  return c.json({ item: { adminUserId: targetAdminId, shopIds } });
});

requisitionRoutes.get('/:id', async (c) => {
  const detail = await loadRequisitionDetail(c.req.param('id'));
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '要货单不存在' }, 404);

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.read', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的查看权限' }, 403);
  }

  return c.json({ item: detail });
});

requisitionRoutes.post('/', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.write', { shopId: parsed.data.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, parsed.data.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的维护权限' }, 403);
  }

  const db = await getDb();
  const [shop] = await db
    .select({ id: shops.id, name: shops.name, isTest: shops.isTest })
    .from(shops)
    .where(eq(shops.id, parsed.data.shopId))
    .limit(1);
  if (!shop) return c.json({ code: 'SHOP_NOT_FOUND', message: '门店不存在' }, 404);

  const items = await resolveItems(parsed.data.shopId, parsed.data.items);

  const detail = await db.transaction(async (tx) => {
    const [header] = await tx
      .insert(shopRequisitions)
      .values({
        requisitionNo: generateDocumentNo('RQ'),
        shopId: parsed.data.shopId,
        expectedDate: parsed.data.expectedDate,
        timeWindow: parsed.data.timeWindow ?? 'all_day',
        status: 'draft',
        remark: parsed.data.remark?.trim() || null,
        createdByAdminId: admin.sub,
        isTest: shop.isTest
      })
      .returning();
    await tx
      .insert(shopRequisitionItems)
      .values(items.map((item) => ({ ...item, requisitionId: header.id, isTest: header.isTest })));
    await recordDocumentEvent(tx, {
      documentType: 'shop_requisition',
      documentId: header.id,
      fromStatus: null,
      toStatus: 'draft',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      isTest: shop.isTest,
      payload: { requisitionNo: header.requisitionNo, shopId: header.shopId }
    });
    return header;
  });

  const created = await loadRequisitionDetail(detail.id);
  return c.json({ item: created }, 201);
});

requisitionRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const detail = await loadRequisitionDetail(id);
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '要货单不存在' }, 404);

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.write', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的维护权限' }, 403);
  }
  if (detail.status !== 'draft') {
    return c.json({ code: 'INVALID_STATUS', message: '只有草稿状态的要货单可以编辑' }, 409);
  }

  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const items = parsed.data.items
    ? await resolveItems(detail.shopId, parsed.data.items)
    : null;

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(shopRequisitions)
      .set({
        ...(parsed.data.expectedDate === undefined
          ? {}
          : { expectedDate: parsed.data.expectedDate }),
        ...(parsed.data.timeWindow === undefined ? {} : { timeWindow: parsed.data.timeWindow }),
        ...(parsed.data.remark === undefined
          ? {}
          : { remark: parsed.data.remark?.trim() || null }),
        updatedAt: new Date()
      })
      .where(eq(shopRequisitions.id, id));

    if (items) {
      await tx
        .delete(shopRequisitionItems)
        .where(eq(shopRequisitionItems.requisitionId, id));
      await tx
        .insert(shopRequisitionItems)
        .values(items.map((item) => ({ ...item, requisitionId: id, isTest: detail.isTest })));
    }
  });

  return c.json({ item: await loadRequisitionDetail(id) });
});

requisitionRoutes.post('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const detail = await loadRequisitionDetail(id);
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '要货单不存在' }, 404);

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.write', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的维护权限' }, 403);
  }

  // 重复提交同一张单：直接返回当前状态，保持幂等
  if (detail.status === 'submitted' || detail.status === 'approved') {
    return c.json({ item: detail, deduplicated: true });
  }
  if (detail.items.length === 0) {
    return c.json({ code: 'EMPTY_REQUISITION', message: '要货单没有明细，不能提交' }, 400);
  }
  assertTransition(REQUISITION_MACHINE, {
    documentType: '要货单',
    from: detail.status,
    to: 'submitted'
  });

  const db = await getDb();
  // 同门店同交付日已有生效单据时，返回那张单据，避免重复提交制造两张有效单
  const [existing] = await db
    .select({ id: shopRequisitions.id })
    .from(shopRequisitions)
    .where(
      and(
        eq(shopRequisitions.shopId, detail.shopId),
        eq(shopRequisitions.expectedDate, detail.expectedDate),
        inArray(shopRequisitions.status, ['submitted', 'approved']),
        ne(shopRequisitions.id, id)
      )
    )
    .limit(1);
  if (existing) {
    return c.json({ item: await loadRequisitionDetail(existing.id), deduplicated: true });
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(shopRequisitions)
        .set({
          status: 'submitted',
          submittedByAdminId: admin.sub,
          submittedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(shopRequisitions.id, id));
      await recordDocumentEvent(tx, {
        documentType: 'shop_requisition',
        documentId: id,
        fromStatus: detail.status,
        toStatus: 'submitted',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        isTest: detail.isTest,
        payload: {
          requisitionNo: detail.requisitionNo,
          shopId: detail.shopId,
          expectedDate: detail.expectedDate
        }
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [active] = await db
        .select({ id: shopRequisitions.id })
        .from(shopRequisitions)
        .where(
          and(
            eq(shopRequisitions.shopId, detail.shopId),
            eq(shopRequisitions.expectedDate, detail.expectedDate),
            inArray(shopRequisitions.status, ['submitted', 'approved'])
          )
        )
        .limit(1);
      if (active) {
        return c.json({ item: await loadRequisitionDetail(active.id), deduplicated: true });
      }
    }
    throw error;
  }

  return c.json({ item: await loadRequisitionDetail(id) });
});

requisitionRoutes.post('/:id/withdraw', async (c) => {
  const id = c.req.param('id');
  const detail = await loadRequisitionDetail(id);
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '要货单不存在' }, 404);

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.write', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的维护权限' }, 403);
  }

  assertTransition(REQUISITION_MACHINE, {
    documentType: '要货单',
    from: detail.status,
    to: 'withdrawn'
  });
  const parsed = actionSchema.safeParse(await c.req.json().catch(() => ({})));

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(shopRequisitions)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(eq(shopRequisitions.id, id));
    await recordDocumentEvent(tx, {
      documentType: 'shop_requisition',
      documentId: id,
      fromStatus: detail.status,
      toStatus: 'withdrawn',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      isTest: detail.isTest,
      reason: parsed.success ? parsed.data.reason?.trim() || null : null,
      payload: { requisitionNo: detail.requisitionNo, shopId: detail.shopId }
    });
  });

  return c.json({ item: await loadRequisitionDetail(id) });
});

requisitionRoutes.post('/:id/review', async (c) => {
  const id = c.req.param('id');
  const detail = await loadRequisitionDetail(id);
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '要货单不存在' }, 404);

  const admin = c.get('admin');
  const denied = await guardPermission(c, 'requisitions.review', { shopId: detail.shopId });
  if (denied) return denied;
  if (!(await canAccessShop(admin.sub, detail.shopId))) {
    return c.json({ code: 'FORBIDDEN', message: '没有该门店的审核权限' }, 403);
  }

  if (detail.status === 'approved') {
    return c.json({ item: detail, deduplicated: true });
  }
  assertTransition(REQUISITION_MACHINE, {
    documentType: '要货单',
    from: detail.status,
    to: 'approved'
  });
  const parsed = actionSchema.safeParse(await c.req.json().catch(() => ({})));

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(shopRequisitions)
      .set({
        status: 'approved',
        reviewedByAdminId: admin.sub,
        reviewedAt: new Date(),
        reviewNote: parsed.success ? parsed.data.reason?.trim() || null : null,
        updatedAt: new Date()
      })
      .where(eq(shopRequisitions.id, id));
    // 审核通过时把申请数量固化为审核数量；后续汇总以 approved_qty 为准
    await tx
      .update(shopRequisitionItems)
      .set({ approvedQty: sql`coalesce(${shopRequisitionItems.approvedQty}, ${shopRequisitionItems.requestedQty})` })
      .where(eq(shopRequisitionItems.requisitionId, id));
    await recordDocumentEvent(tx, {
      documentType: 'shop_requisition',
      documentId: id,
      fromStatus: detail.status,
      toStatus: 'approved',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      isTest: detail.isTest,
      reason: parsed.success ? parsed.data.reason?.trim() || null : null,
      payload: { requisitionNo: detail.requisitionNo, shopId: detail.shopId }
    });
  });

  return c.json({ item: await loadRequisitionDetail(id) });
});

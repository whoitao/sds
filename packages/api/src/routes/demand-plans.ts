import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  demandPlanItems,
  demandPlans,
  documentEvents,
  getDb,
  purchaseOrders,
  shopRequisitionItems,
  shopRequisitions,
  shops,
  warehouses,
  type DemandPlanShopBreakdown
} from '@sds/db';
import { requireAdmin, type AdminEnv } from '../middleware/admin-auth.js';
import { guardPermission } from '../lib/admin-access.js';
import { accessibleShopIds } from '../lib/shop-scope.js';
import {
  DOCUMENT_NEW_STATE,
  DocumentRuleError,
  assertTransition,
  generateDocumentNo,
  recordDocumentEvent
} from '../lib/documents.js';

/** 需求汇总工作台：交付日 + 仓库 + SKU 合并门店已审核要货 */
export const demandPlanRoutes = new Hono<AdminEnv>();

demandPlanRoutes.use('*', requireAdmin);

const PLAN_STATUS_LABELS: Record<string, string> = {
  collecting: '汇总中',
  decided: '已定稿',
  superseded: '已被新版本替代'
};

const PURCHASE_PATHS = ['centralized', 'central_kitchen', 'regional_whitelist'] as const;

const PLAN_MACHINE = {
  [DOCUMENT_NEW_STATE]: ['collecting'],
  collecting: ['decided'],
  decided: [],
  superseded: []
} as const;

const collectSchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '交付日期格式应为 YYYY-MM-DD'),
  warehouseId: z.uuid('仓库 ID 不合法'),
  remark: z.string().trim().max(500).nullish()
});

const itemUpdateSchema = z
  .object({
    finalQty: z.union([z.string(), z.number()]).optional(),
    purchasePath: z.enum(PURCHASE_PATHS).optional(),
    decisionNote: z.string().trim().max(500).nullish()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

const decideSchema = z.object({
  remark: z.string().trim().max(500).nullish()
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

function normalizeAmount(value: string | number, field: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new DocumentRuleError('INVALID_AMOUNT', `${field}必须是非负数字`, 400);
  }
  return amount.toFixed(2);
}

async function planReferencedByPurchase(planId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: purchaseOrders.id, poNo: purchaseOrders.poNo, shopId: purchaseOrders.shopId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.demandPlanId, planId))
    .limit(20);
  return rows;
}

async function loadPlanDetail(id: string) {
  const db = await getDb();
  const [plan] = await db
    .select({
      id: demandPlans.id,
      planNo: demandPlans.planNo,
      deliveryDate: demandPlans.deliveryDate,
      warehouseId: demandPlans.warehouseId,
      warehouseName: warehouses.name,
      version: demandPlans.version,
      status: demandPlans.status,
      isCurrent: demandPlans.isCurrent,
      totalSkus: demandPlans.totalSkus,
      totalRequestedQty: demandPlans.totalRequestedQty,
      remark: demandPlans.remark,
      decidedByAdminId: demandPlans.decidedByAdminId,
      decidedAt: demandPlans.decidedAt,
      createdByAdminId: demandPlans.createdByAdminId,
      createdAt: demandPlans.createdAt,
      updatedAt: demandPlans.updatedAt
    })
    .from(demandPlans)
    .innerJoin(warehouses, eq(warehouses.id, demandPlans.warehouseId))
    .where(eq(demandPlans.id, id))
    .limit(1);
  if (!plan) return null;

  const [items, references, events] = await Promise.all([
    db
      .select()
      .from(demandPlanItems)
      .where(eq(demandPlanItems.demandPlanId, id))
      .orderBy(asc(demandPlanItems.categoryName), asc(demandPlanItems.itemName)),
    planReferencedByPurchase(id),
    db
      .select()
      .from(documentEvents)
      .where(
        and(eq(documentEvents.documentType, 'demand_plan'), eq(documentEvents.documentId, id))
      )
      .orderBy(asc(documentEvents.createdAt))
  ]);

  return {
    ...plan,
    statusLabel: PLAN_STATUS_LABELS[plan.status],
    items,
    referencedOrders: references,
    referenced: references.length > 0,
    events
  };
}

demandPlanRoutes.get('/', async (c) => {
  const denied = await guardPermission(c, 'demand.read');
  if (denied) return denied;

  const db = await getDb();
  const deliveryDate = c.req.query('deliveryDate')?.trim() ?? '';
  const warehouseId = c.req.query('warehouseId')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const includeSuperseded = c.req.query('includeSuperseded') === 'true';
  const { page, pageSize, offset } = parsePaging({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize')
  });

  const conditions = [];
  if (!includeSuperseded) conditions.push(eq(demandPlans.isCurrent, true));
  if (/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    conditions.push(eq(demandPlans.deliveryDate, deliveryDate));
  }
  if (warehouseId) conditions.push(eq(demandPlans.warehouseId, warehouseId));
  if (status && status in PLAN_STATUS_LABELS) {
    conditions.push(eq(demandPlans.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select({
        id: demandPlans.id,
        planNo: demandPlans.planNo,
        deliveryDate: demandPlans.deliveryDate,
        warehouseId: demandPlans.warehouseId,
        warehouseName: warehouses.name,
        version: demandPlans.version,
        status: demandPlans.status,
        isCurrent: demandPlans.isCurrent,
        totalSkus: demandPlans.totalSkus,
        totalRequestedQty: demandPlans.totalRequestedQty,
        decidedAt: demandPlans.decidedAt,
        createdAt: demandPlans.createdAt,
        updatedAt: demandPlans.updatedAt
      })
      .from(demandPlans)
      .innerJoin(warehouses, eq(warehouses.id, demandPlans.warehouseId))
      .where(where)
      .orderBy(desc(demandPlans.deliveryDate), desc(demandPlans.version))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(demandPlans).where(where)
  ]);

  return c.json({ items, total: totalRows[0]?.total ?? 0, page, pageSize });
});

demandPlanRoutes.get('/:id', async (c) => {
  const denied = await guardPermission(c, 'demand.read');
  if (denied) return denied;
  const detail = await loadPlanDetail(c.req.param('id'));
  if (!detail) return c.json({ code: 'NOT_FOUND', message: '需求计划不存在' }, 404);
  return c.json({ item: detail });
});

demandPlanRoutes.post('/collect', async (c) => {
  const denied = await guardPermission(c, 'demand.write');
  if (denied) return denied;

  const parsed = collectSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const admin = c.get('admin');
  const db = await getDb();
  const { deliveryDate, warehouseId } = parsed.data;

  const [warehouse] = await db
    .select({ id: warehouses.id, name: warehouses.name, isTest: warehouses.isTest })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) return c.json({ code: 'WAREHOUSE_NOT_FOUND', message: '仓库不存在' }, 404);

  const [current] = await db
    .select({
      id: demandPlans.id,
      version: demandPlans.version,
      planNo: demandPlans.planNo
    })
    .from(demandPlans)
    .where(
      and(
        eq(demandPlans.deliveryDate, deliveryDate),
        eq(demandPlans.warehouseId, warehouseId),
        eq(demandPlans.isCurrent, true)
      )
    )
    .limit(1);

  if (current) {
    const referenced = await planReferencedByPurchase(current.id);
    if (referenced.length > 0) {
      return c.json(
        {
          code: 'PLAN_REFERENCED',
          message: `计划 ${current.planNo} 已被采购单引用，不能重新汇总覆盖；请换交付日或先处理采购单`
        },
        409
      );
    }
  }

  const shopIds = await accessibleShopIds(admin.sub);
  const shopConditions = [];
  shopConditions.push(eq(shopRequisitions.status, 'approved'));
  shopConditions.push(eq(shopRequisitions.expectedDate, deliveryDate));
  if (shopIds !== null) {
    if (shopIds.length === 0) {
      return c.json(
        {
          code: 'NO_SHOP_SCOPE',
          message: '当前账号未绑定门店，无法汇总需求计划，请联系超级管理员分配门店范围'
        },
        403
      );
    }
    shopConditions.push(inArray(shopRequisitions.shopId, shopIds));
  }

  const sourceItems = await db
    .select({
      requisitionId: shopRequisitions.id,
      requisitionNo: shopRequisitions.requisitionNo,
      shopId: shopRequisitions.shopId,
      shopName: shops.name,
      catalogSkuId: shopRequisitionItems.catalogSkuId,
      itemName: shopRequisitionItems.itemName,
      specName: shopRequisitionItems.specName,
      unit: shopRequisitionItems.unit,
      categoryId: shopRequisitionItems.categoryId,
      categoryName: shopRequisitionItems.categoryName,
      requestedQty: shopRequisitionItems.requestedQty,
      approvedQty: shopRequisitionItems.approvedQty,
      isTest: shopRequisitions.isTest
    })
    .from(shopRequisitionItems)
    .innerJoin(shopRequisitions, eq(shopRequisitions.id, shopRequisitionItems.requisitionId))
    .innerJoin(shops, eq(shops.id, shopRequisitions.shopId))
    .where(and(...shopConditions));

  const grouped = new Map<
    string,
    {
      catalogSkuId: string;
      itemName: string;
      specName: string | null;
      unit: string;
      categoryId: string | null;
      categoryName: string | null;
      total: number;
      breakdown: DemandPlanShopBreakdown[];
    }
  >();

  for (const row of sourceItems) {
    if (!row.catalogSkuId) continue;
    const approved = Number(row.approvedQty ?? row.requestedQty);
    if (!Number.isFinite(approved) || approved <= 0) continue;
    const existing = grouped.get(row.catalogSkuId);
    if (existing) {
      existing.total += approved;
      existing.breakdown.push({
        shopId: row.shopId,
        shopName: row.shopName,
        requisitionId: row.requisitionId,
        requisitionNo: row.requisitionNo,
        requestedQty: row.requestedQty,
        approvedQty: row.approvedQty ?? row.requestedQty
      });
    } else {
      grouped.set(row.catalogSkuId, {
        catalogSkuId: row.catalogSkuId,
        itemName: row.itemName,
        specName: row.specName,
        unit: row.unit,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        total: approved,
        breakdown: [
          {
            shopId: row.shopId,
            shopName: row.shopName,
            requisitionId: row.requisitionId,
            requisitionNo: row.requisitionNo,
            requestedQty: row.requestedQty,
            approvedQty: row.approvedQty ?? row.requestedQty
          }
        ]
      });
    }
  }

  const groups = [...grouped.values()];
  if (groups.length === 0) {
    return c.json({ code: 'NO_REQUISITIONS', message: '该交付日没有可汇总的已审核要货' }, 400);
  }

  const totalQty = groups.reduce((sum, group) => sum + group.total, 0);
  const nextVersion = (current?.version ?? 0) + 1;
  // 仓库或任一来源要货单是测试数据，则新计划整体视为测试数据
  const planIsTest = warehouse.isTest || sourceItems.some((row) => row.isTest);

  let planId = '';
  try {
    planId = await db.transaction(async (tx) => {
      if (current) {
        await tx
          .update(demandPlans)
          .set({ isCurrent: false, status: 'superseded', updatedAt: new Date() })
          .where(eq(demandPlans.id, current.id));
      }

      const [plan] = await tx
        .insert(demandPlans)
        .values({
          planNo: generateDocumentNo('DP'),
          deliveryDate,
          warehouseId,
          version: nextVersion,
          status: 'collecting',
          isCurrent: true,
          totalSkus: groups.length,
          totalRequestedQty: totalQty.toFixed(2),
          remark: parsed.data.remark?.trim() || null,
          createdByAdminId: admin.sub,
          isTest: planIsTest
        })
        .returning();

      await tx.insert(demandPlanItems).values(
        groups.map((group) => ({
          demandPlanId: plan.id,
          catalogSkuId: group.catalogSkuId,
          itemName: group.itemName,
          specName: group.specName,
          unit: group.unit,
          categoryId: group.categoryId,
          categoryName: group.categoryName,
          totalRequestedQty: group.total.toFixed(2),
          finalQty: group.total.toFixed(2),
          purchasePath: 'centralized',
          shopBreakdown: group.breakdown,
          isTest: plan.isTest
        }))
      );

      await recordDocumentEvent(tx, {
        documentType: 'demand_plan',
        documentId: plan.id,
        fromStatus: null,
        toStatus: 'collecting',
        operatorAdminId: admin.sub,
        operatorName: admin.username,
        isTest: plan.isTest,
        payload: {
          planNo: plan.planNo,
          deliveryDate,
          warehouseId,
          version: nextVersion,
          supersededPlanId: current?.id ?? null
        }
      });

      return plan.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json(
        { code: 'PLAN_CONFLICT', message: '该交付日与仓库正在被其他人汇总，请刷新后重试' },
        409
      );
    }
    throw error;
  }

  return c.json({ item: await loadPlanDetail(planId) }, 201);
});

demandPlanRoutes.patch('/:id/items/:itemId', async (c) => {
  const denied = await guardPermission(c, 'demand.write');
  if (denied) return denied;

  const parsed = itemUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const planId = c.req.param('id');
  const [plan] = await db
    .select({
      id: demandPlans.id,
      status: demandPlans.status,
      isCurrent: demandPlans.isCurrent
    })
    .from(demandPlans)
    .where(eq(demandPlans.id, planId))
    .limit(1);
  if (!plan) return c.json({ code: 'NOT_FOUND', message: '需求计划不存在' }, 404);
  if (!plan.isCurrent || plan.status !== 'collecting') {
    return c.json({ code: 'INVALID_STATUS', message: '只有汇总中的当前版本可以调整' }, 409);
  }
  const referenced = await planReferencedByPurchase(planId);
  if (referenced.length > 0) {
    return c.json(
      { code: 'PLAN_REFERENCED', message: '该计划已被采购单引用，不能再修改明细' },
      409
    );
  }

  const [item] = await db
    .select({ id: demandPlanItems.id })
    .from(demandPlanItems)
    .where(
      and(
        eq(demandPlanItems.id, c.req.param('itemId')),
        eq(demandPlanItems.demandPlanId, planId)
      )
    )
    .limit(1);
  if (!item) return c.json({ code: 'NOT_FOUND', message: '需求明细不存在' }, 404);

  await db.transaction(async (tx) => {
    await tx
      .update(demandPlanItems)
      .set({
        ...(parsed.data.finalQty === undefined
          ? {}
          : { finalQty: normalizeAmount(parsed.data.finalQty, '采纳数量') }),
        ...(parsed.data.purchasePath === undefined
          ? {}
          : { purchasePath: parsed.data.purchasePath }),
        ...(parsed.data.decisionNote === undefined
          ? {}
          : { decisionNote: parsed.data.decisionNote?.trim() || null }),
        updatedAt: new Date()
      })
      .where(eq(demandPlanItems.id, item.id));
    await tx
      .update(demandPlans)
      .set({ updatedAt: new Date() })
      .where(eq(demandPlans.id, planId));
  });

  return c.json({ item: await loadPlanDetail(planId) });
});

demandPlanRoutes.post('/:id/decide', async (c) => {
  const denied = await guardPermission(c, 'demand.write');
  if (denied) return denied;

  const planId = c.req.param('id');
  const [plan] = await dbSelectPlan(planId);
  if (!plan) return c.json({ code: 'NOT_FOUND', message: '需求计划不存在' }, 404);
  if (!plan.isCurrent || plan.status !== 'collecting') {
    return c.json({ code: 'INVALID_STATUS', message: '只有汇总中的当前版本可以确认' }, 409);
  }

  const parsed = decideSchema.safeParse(await c.req.json().catch(() => ({})));
  assertTransition(PLAN_MACHINE, {
    documentType: '需求计划',
    from: plan.status,
    to: 'decided'
  });

  const admin = c.get('admin');
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(demandPlans)
      .set({
        status: 'decided',
        decidedByAdminId: admin.sub,
        decidedAt: new Date(),
        ...(parsed.success && parsed.data.remark?.trim()
          ? { remark: parsed.data.remark.trim() }
          : {}),
        updatedAt: new Date()
      })
      .where(eq(demandPlans.id, planId));
    await recordDocumentEvent(tx, {
      documentType: 'demand_plan',
      documentId: planId,
      fromStatus: plan.status,
      toStatus: 'decided',
      operatorAdminId: admin.sub,
      operatorName: admin.username,
      isTest: plan.isTest,
      payload: { planNo: plan.planNo }
    });
  });

  return c.json({ item: await loadPlanDetail(planId) });
});

async function dbSelectPlan(planId: string) {
  const db = await getDb();
  return db
    .select({
      id: demandPlans.id,
      planNo: demandPlans.planNo,
      status: demandPlans.status,
      isCurrent: demandPlans.isCurrent,
      isTest: demandPlans.isTest
    })
    .from(demandPlans)
    .where(eq(demandPlans.id, planId))
    .limit(1);
}

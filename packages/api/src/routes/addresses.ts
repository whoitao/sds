import { Hono, type Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { addresses, getDb } from '@sds/db';
import { resolveRegionPath } from '@sds/shared';
import { findCustomerSession, tokenFromHeader } from '../lib/customer-session';
import { loadRegions } from '../lib/regions';

/**
 * 顾客收货地址（Bearer 顾客会话）。
 * 一个顾客可有多条，默认地址唯一；首条自动设默认，删掉默认时自动补一条。
 *
 * 省/市/区县以区划编码关联 regions 表，名称由服务端按编码查出后写回，
 * 既方便按区划聚合统计，也保留展示用的名称快照。
 */
export const addressRoutes = new Hono();

const phoneSchema = z.string().trim().regex(/^1[3-9]\d{9}$/, '请输入 11 位手机号');
// 民政部编码：省 2 位、市 4 位、区县 6 位（省直辖县等以数据为准）
const regionCodeSchema = z.string().trim().regex(/^\d{2,12}$/, '区划编码不合法');

const addressFields = {
  contactName: z.string().trim().min(1, '请填写联系人').max(50),
  contactPhone: phoneSchema,
  detail: z.string().trim().min(5, '请填写详细地址').max(200),
  provinceCode: regionCodeSchema,
  cityCode: regionCodeSchema,
  districtCode: regionCodeSchema,
  remark: z.string().trim().max(500).nullable().optional()
};

const createSchema = z.object({ ...addressFields, isDefault: z.boolean().optional() });

const updateSchema = z
  .object({
    contactName: addressFields.contactName.optional(),
    contactPhone: phoneSchema.optional(),
    detail: addressFields.detail.optional(),
    provinceCode: regionCodeSchema.optional(),
    cityCode: regionCodeSchema.optional(),
    districtCode: regionCodeSchema.optional(),
    remark: addressFields.remark,
    isDefault: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要一个字段');

/** 校验区划编码路径，并从 regions 表取出对应的省/市/区县名称 */
async function resolveRegion(codes: {
  provinceCode: string;
  cityCode: string;
  districtCode: string;
}) {
  const { index } = await loadRegions();
  const path = resolveRegionPath(index, codes);
  if (!path) return null;
  return {
    provinceCode: path.province.code,
    province: path.province.name,
    cityCode: path.city.code,
    city: path.city.name,
    districtCode: path.district.code,
    district: path.district.name
  };
}

async function resolveCustomer(c: Context) {
  const token = tokenFromHeader(c.req.header('authorization'));
  return findCustomerSession(token);
}

function addressPayload(row: typeof addresses.$inferSelect) {
  return {
    id: row.id,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    provinceCode: row.provinceCode,
    province: row.province,
    cityCode: row.cityCode,
    city: row.city,
    districtCode: row.districtCode,
    district: row.district,
    detail: row.detail,
    remark: row.remark,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function listAddresses(customerId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, customerId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
  return rows.map(addressPayload);
}

addressRoutes.get('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);
  return c.json({ items: await listAddresses(session.customerId) });
});

addressRoutes.post('/', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const region = await resolveRegion(parsed.data);
  if (!region) {
    return c.json({ code: 'INVALID_REGION', message: '请选择有效的省/市/区县' }, 400);
  }

  const existing = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.customerId, session.customerId));
  const isFirst = existing.length === 0;
  const makeDefault = isFirst || parsed.data.isDefault === true;

  const row = await db.transaction(async (tx) => {
    if (makeDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(addresses.customerId, session.customerId), eq(addresses.isDefault, true)));
    }
    const [inserted] = await tx
      .insert(addresses)
      .values({
        customerId: session.customerId,
        contactName: parsed.data.contactName,
        contactPhone: parsed.data.contactPhone,
        detail: parsed.data.detail,
        ...region,
        remark: parsed.data.remark ?? null,
        isDefault: makeDefault
      })
      .returning();
    return inserted;
  });

  return c.json({ address: addressPayload(row) }, 201);
});

addressRoutes.patch('/:id', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? '参数不合法' },
      400
    );
  }

  const db = await getDb();
  const [existing] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(and(eq(addresses.id, c.req.param('id')), eq(addresses.customerId, session.customerId)))
    .limit(1);
  if (!existing) return c.json({ code: 'ADDRESS_NOT_FOUND', message: '地址不存在' }, 404);

  const { isDefault, provinceCode, cityCode, districtCode, ...fields } = parsed.data;
  let region: Awaited<ReturnType<typeof resolveRegion>> = null;
  if (provinceCode || cityCode || districtCode) {
    if (!provinceCode || !cityCode || !districtCode) {
      return c.json({ code: 'INVALID_REGION', message: '请完整选择省/市/区县' }, 400);
    }
    region = await resolveRegion({ provinceCode, cityCode, districtCode });
    if (!region) {
      return c.json({ code: 'INVALID_REGION', message: '请选择有效的省/市/区县' }, 400);
    }
  }

  const row = await db.transaction(async (tx) => {
    if (isDefault === true) {
      await tx
        .update(addresses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(addresses.customerId, session.customerId), eq(addresses.isDefault, true)));
    }
    const [updated] = await tx
      .update(addresses)
      .set({
        ...fields,
        ...(region ?? {}),
        ...(isDefault === undefined ? {} : { isDefault }),
        updatedAt: new Date()
      })
      .where(eq(addresses.id, existing.id))
      .returning();
    return updated;
  });

  return c.json({ address: addressPayload(row) });
});

addressRoutes.patch('/:id/default', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const db = await getDb();
  const [existing] = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(and(eq(addresses.id, c.req.param('id')), eq(addresses.customerId, session.customerId)))
    .limit(1);
  if (!existing) return c.json({ code: 'ADDRESS_NOT_FOUND', message: '地址不存在' }, 404);

  await db.transaction(async (tx) => {
    await tx
      .update(addresses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(addresses.customerId, session.customerId), eq(addresses.isDefault, true)));
    await tx
      .update(addresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(addresses.id, existing.id));
  });

  return c.json({ items: await listAddresses(session.customerId) });
});

addressRoutes.delete('/:id', async (c) => {
  const session = await resolveCustomer(c);
  if (!session) return c.json({ code: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const db = await getDb();
  const [existing] = await db
    .select({ id: addresses.id, isDefault: addresses.isDefault })
    .from(addresses)
    .where(and(eq(addresses.id, c.req.param('id')), eq(addresses.customerId, session.customerId)))
    .limit(1);
  if (!existing) return c.json({ code: 'ADDRESS_NOT_FOUND', message: '地址不存在' }, 404);

  await db.transaction(async (tx) => {
    await tx.delete(addresses).where(eq(addresses.id, existing.id));
    if (existing.isDefault) {
      const [fallback] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.customerId, session.customerId))
        .orderBy(desc(addresses.createdAt))
        .limit(1);
      if (fallback) {
        await tx
          .update(addresses)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(addresses.id, fallback.id));
      }
    }
  });

  return c.json({ ok: true, items: await listAddresses(session.customerId) });
});

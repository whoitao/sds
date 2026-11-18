import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  documentEvents,
  getDb,
  idempotencyKeys,
  type DocumentEvent
} from '@sds/db';

type Db = Awaited<ReturnType<typeof getDb>>;
/** 事务对象与连接对象在本文件只用 insert/select/update/delete，统一按连接类型使用 */
type DbLike = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** 新建单据在状态机里的虚拟起点 */
export const DOCUMENT_NEW_STATE = '__new__';

export class DocumentRuleError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 403 | 404 | 409 = 409
  ) {
    super(message);
  }
}

/**
 * 单号生成约定：`前缀 + yyyymmdd + base36 时间戳 + 4 位随机`，最长 32 位。
 * 例：PO20261118M1K2J3AB7X9Q。
 * 并发下仍可能重复，落库时依赖各单据自身的唯一索引兜底重试。
 */
export function generateDocumentNo(prefix: string, now = new Date()): string {
  const cleanPrefix = prefix.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 8);
  if (!cleanPrefix) {
    throw new DocumentRuleError('INVALID_DOCUMENT_PREFIX', '单号前缀不能为空', 400);
  }
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = now.getTime().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${cleanPrefix}${date}${time}${random}`.slice(0, 32);
}

/**
 * 单据状态机：key 为当前状态，value 为允许流转到的状态。
 * 新建（无状态）使用 DOCUMENT_NEW_STATE 作为 key。
 */
export type DocumentStateMachine = Readonly<Record<string, readonly string[]>>;

export function canTransition(
  machine: DocumentStateMachine,
  from: string | null | undefined,
  to: string
): boolean {
  return Boolean(machine[from ?? DOCUMENT_NEW_STATE]?.includes(to));
}

export function assertTransition(
  machine: DocumentStateMachine,
  params: { documentType: string; from?: string | null; to: string }
): void {
  const { documentType, from, to } = params;
  if (canTransition(machine, from, to)) return;
  throw new DocumentRuleError(
    'INVALID_DOCUMENT_TRANSITION',
    `${documentType} 不允许从「${from || '新建'}」变更为「${to}」`
  );
}

export type DocumentEventInput = {
  documentType: string;
  documentId: string;
  fromStatus?: string | null;
  toStatus: string;
  operatorAdminId?: string | null;
  operatorName?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
  /** 继承主单据的测试标记，便于按测试数据整体清理 */
  isTest?: boolean;
};

/** 写一条单据状态流水；可在事务中调用，与业务更新一起提交或回滚。 */
export async function recordDocumentEvent(
  db: DbLike,
  input: DocumentEventInput
): Promise<DocumentEvent> {
  const [row] = await (db as Db)
    .insert(documentEvents)
    .values({
      documentType: input.documentType,
      documentId: input.documentId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      operatorAdminId: input.operatorAdminId ?? null,
      operatorName: input.operatorName ?? null,
      reason: input.reason ?? null,
      payload: input.payload ?? {},
      isTest: input.isTest ?? false
    })
    .returning();
  return row;
}

/** 幂等键规范化：`scope:key`，最长 120，空值直接拒绝。 */
export function normalizeIdempotencyKey(scope: string, key: string): string {
  const cleanScope = scope.trim();
  const cleanKey = key.trim();
  if (!cleanScope || !cleanKey) {
    throw new DocumentRuleError('INVALID_IDEMPOTENCY_KEY', '幂等键不能为空', 400);
  }
  const normalized = `${cleanScope}:${cleanKey}`;
  if (normalized.length > 120) {
    throw new DocumentRuleError('INVALID_IDEMPOTENCY_KEY', '幂等键长度不能超过 120', 400);
  }
  return normalized;
}

/** 请求体摘要：调用方按业务字段组装 payload 后固定顺序 JSON 序列化。 */
export function hashIdempotencyRequest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export type AcquireIdempotencyResult = {
  key: string;
  state: 'acquired' | 'replayed' | 'conflict';
  reason?: 'hash_mismatch' | 'in_progress';
  response?: unknown;
};

/**
 * 获取幂等执行权：
 * - acquired：首次请求，可以继续执行业务；
 * - replayed：已完成，直接返回上次的响应；
 * - conflict：请求摘要不一致（hash_mismatch）或上一次仍在处理中（in_progress）。
 * 处理失败时调用 releaseIdempotencyKey 释放，避免卡死。
 */
export async function acquireIdempotencyKey(
  db: DbLike,
  params: {
    scope: string;
    key: string;
    requestHash?: string;
    /** 处理中与完成结果的保留时长，默认 24 小时 */
    ttlSeconds?: number;
  }
): Promise<AcquireIdempotencyResult> {
  const dbc = db as Db;
  const normalized = normalizeIdempotencyKey(params.scope, params.key);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlSeconds ?? 86400) * 1000);

  const [inserted] = await dbc
    .insert(idempotencyKeys)
    .values({
      key: normalized,
      scope: params.scope.trim(),
      requestHash: params.requestHash ?? null,
      status: 'processing',
      expiresAt
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted) return { key: normalized, state: 'acquired' };

  const [row] = await dbc
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, normalized))
    .limit(1);
  if (!row) return { key: normalized, state: 'acquired' };

  if (params.requestHash && row.requestHash && row.requestHash !== params.requestHash) {
    return { key: normalized, state: 'conflict', reason: 'hash_mismatch' };
  }
  if (row.status === 'completed') {
    return { key: normalized, state: 'replayed', response: row.responsePayload };
  }
  // 处理中的记录过期后允许接管，避免进程崩溃导致永久卡住
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await dbc
      .update(idempotencyKeys)
      .set({
        requestHash: params.requestHash ?? null,
        status: 'processing',
        responsePayload: null,
        createdAt: now,
        expiresAt
      })
      .where(eq(idempotencyKeys.key, normalized));
    return { key: normalized, state: 'acquired' };
  }
  return { key: normalized, state: 'conflict', reason: 'in_progress' };
}

/** 标记幂等键处理完成，并保存可直接回放的响应体。 */
export async function completeIdempotencyKey(
  db: DbLike,
  key: string,
  response: unknown,
  ttlSeconds = 86400
): Promise<void> {
  await (db as Db)
    .update(idempotencyKeys)
    .set({
      status: 'completed',
      responsePayload: response ?? null,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    })
    .where(eq(idempotencyKeys.key, key));
}

/** 业务失败时释放处理中的幂等键，允许调用方重试。 */
export async function releaseIdempotencyKey(db: DbLike, key: string): Promise<void> {
  await (db as Db)
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.status, 'processing')));
}

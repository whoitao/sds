import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { adminUsers } from './admin-users.ts';

/**
 * 单据状态流水（迁移 0022）。
 * 所有业务单据（采购、入库、分拨、盘点等）共用，按 document_type + document_id 归档。
 */
export const documentEvents = pgTable(
  'document_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentType: varchar('document_type', { length: 32 }).notNull(),
    documentId: uuid('document_id').notNull(),
    fromStatus: varchar('from_status', { length: 24 }),
    toStatus: varchar('to_status', { length: 24 }).notNull(),
    operatorAdminId: uuid('operator_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null'
    }),
    operatorName: varchar('operator_name', { length: 50 }),
    reason: text('reason'),
    /** 事件附加信息：单号、来源、差异原因等，结构由各单据自定义 */
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isTest: boolean('is_test').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    docIdx: index('document_events_doc_idx').on(t.documentType, t.documentId, t.createdAt),
    createdIdx: index('document_events_created_idx').on(t.createdAt)
  })
);

/**
 * 幂等键（迁移 0022）。
 * 约定：同一个 scope 下的同一个 key 只允许成功处理一次；
 * 请求体摘要不一致视为冲突，处理中重复提交视为进行中。
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** 规范化后的键：`${scope}:${key}`，最长 120 */
    key: varchar('key', { length: 120 }).primaryKey(),
    scope: varchar('scope', { length: 64 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }),
    status: varchar('status', { length: 16 }).notNull().default('processing'),
    responsePayload: jsonb('response_payload').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (t) => ({
    expiresIdx: index('idempotency_keys_expires_idx').on(t.expiresAt),
    scopeIdx: index('idempotency_keys_scope_idx').on(t.scope)
  })
);

export type DocumentEvent = typeof documentEvents.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

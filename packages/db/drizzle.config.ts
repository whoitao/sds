import { defineConfig } from 'drizzle-kit';

/**
 * 本轮只做 schema 定义与目录规划，不连接数据库、不执行迁移。
 * 接入 Supabase 后可通过 DATABASE_URL 执行 drizzle-kit generate / migrate。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema/index.ts'],
  out: './drizzle'
});

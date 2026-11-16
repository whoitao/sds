import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

type Database = NodePgDatabase<typeof schema>;

let pool: { end: () => Promise<void> } | null = null;
let database: Database | null = null;

/**
 * 懒加载数据库连接：
 * - 未配置 DATABASE_URL 或未安装驱动时，服务仍能启动（健康检查可用），
 *   只有真正访问数据库的接口会失败并返回明确错误。
 */
export async function getDb(): Promise<Database> {
  if (database) return database;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL 未配置：请在环境变量中提供 Supabase PostgreSQL 连接串');
  }

  let pgModule: typeof import('pg');
  let ormModule: typeof import('drizzle-orm/node-postgres');
  let schemaModule: typeof import('./schema');
  try {
    [pgModule, ormModule, schemaModule] = await Promise.all([
      import('pg'),
      import('drizzle-orm/node-postgres'),
      import('./schema')
    ]);
  } catch {
    throw new Error('数据库驱动未安装：请先执行 pnpm install');
  }

  pool = new pgModule.Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX ?? 5)
  });
  database = ormModule.drizzle(pool as unknown as InstanceType<typeof pgModule.Pool>, {
    schema: schemaModule
  }) as unknown as Database;
  return database;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

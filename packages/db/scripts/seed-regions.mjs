#!/usr/bin/env node
/**
 * 行政区划字典初始化 / 更新。
 *
 * 数据来源：china-division@2.7.0（基于民政部行政区划整理），
 * 已裁剪到省/市/区县三级并保留官方编码，存于 packages/db/data/regions.json。
 *
 * 用法：
 *   node packages/db/scripts/seed-regions.mjs           # 只打印将要写入的数量，回滚
 *   node packages/db/scripts/seed-regions.mjs --apply   # 真正写入
 *
 * 区划调整时的口径：
 * - 新增/改名：按 code upsert，名称与父级跟着更新；
 * - 撤销/合并：数据集中不存在的 code 不删除，只置 is_active=false，
 *   保证历史地址的外键与统计不丢；新地址校验只认 is_active=true；
 * - 名称快照：addresses 里的省/市/区县名称保持写入时值，便于历史展示；
 * - 回填：给只有名称、没有编码的旧地址按「省名 + 市名 + 区县名」补齐编码。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const APPLY = process.argv.includes('--apply');

function loadRootEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      /* 走下面的兜底解析 */
    }
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadRootEnv();

const rowsPath = join(ROOT, 'packages/db/data/regions.json');
const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
const byLevel = rows.reduce((acc, row) => {
  acc[row.level] = (acc[row.level] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `区划数据：省 ${byLevel[1] ?? 0} / 市 ${byLevel[2] ?? 0} / 区县 ${byLevel[3] ?? 0}，共 ${rows.length} 条`
);
if (!APPLY) {
  console.log('dry-run：未写入。加 --apply 执行。');
  process.exit(0);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});
await client.connect();
try {
  await client.query('begin');

  // 1) 按 code upsert 名称/层级/父级/排序，并重新激活
  for (const row of rows) {
    await client.query(
      `insert into regions (code, name, level, parent_code, sort_order, is_active, updated_at)
       values ($1, $2, $3, $4, $5, true, now())
       on conflict (code) do update
         set name = excluded.name,
             level = excluded.level,
             parent_code = excluded.parent_code,
             sort_order = excluded.sort_order,
             is_active = true,
             updated_at = now()`,
      [row.code, row.name, row.level, row.parentCode, row.sortOrder]
    );
  }

  // 2) 数据集里已不存在的 code 置为停用，不删除，保历史地址与统计
  const codes = rows.map((row) => row.code);
  const deactivated = await client.query(
    `update regions set is_active = false, updated_at = now()
      where not (code = any($1::varchar[])) and is_active`,
    [codes]
  );

  // 3) 旧地址只有名称时按名称三元组回填编码
  const backfilled = await client.query(
    `update addresses a
        set province_code = p.code, city_code = c.code, district_code = d.code
       from regions p
       join regions c on c.parent_code = p.code
       join regions d on d.parent_code = c.code
      where a.province_code is null
        and p.level = 1 and c.level = 2 and d.level = 3
        and p.name = a.province and c.name = a.city and d.name = a.district`
  );

  await client.query('commit');
  console.log(`已写入/更新 ${rows.length} 条；停用 ${deactivated.rowCount} 条；回填地址 ${backfilled.rowCount} 条。`);
} catch (error) {
  await client.query('rollback');
  console.error('写入失败，已回滚：', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

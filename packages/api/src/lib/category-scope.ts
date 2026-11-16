import { eq } from 'drizzle-orm';
import { categories, getDb } from '@sds/db';

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * 分类筛选口径：默认返回「该分类 + 全部子分类」，includeDescendants=false 时只返回自身。
 * 分类固定两级，一次查询即可；分类不存在也返回 [categoryId]，让筛选得到空集而不是报错。
 */
export async function resolveCategoryScope(
  db: Db,
  categoryId: string,
  options: { includeDescendants?: boolean } = {}
): Promise<string[]> {
  if (options.includeDescendants === false) return [categoryId];

  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.parentId, categoryId));

  return [categoryId, ...children.map((row) => row.id)];
}

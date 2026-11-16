import type { AdminPreferences } from '@sds/db';

/** 每页条数可选值，前后端共用同一口径 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

/** 展示效果可选值，前后端共用同一口径 */
export const DISPLAY_DENSITIES = ['compact', 'standard', 'relaxed'] as const;

export const DEFAULT_PREFERENCES: Required<AdminPreferences> = {
  theme: 'system',
  pageSize: 20,
  displayDensity: 'standard'
};

/** 把库里的 jsonb 收敛成合法值，避免脏数据影响前端 */
export function normalizePreferences(raw: AdminPreferences | null | undefined): Required<AdminPreferences> {
  const theme = raw?.theme === 'light' || raw?.theme === 'dark' ? raw.theme : 'system';
  const pageSize =
    typeof raw?.pageSize === 'number' && (PAGE_SIZES as readonly number[]).includes(raw.pageSize)
      ? raw.pageSize
      : 20;
  const displayDensity =
    typeof raw?.displayDensity === 'string' &&
    (DISPLAY_DENSITIES as readonly string[]).includes(raw.displayDensity)
      ? raw.displayDensity
      : 'standard';
  return { theme, pageSize, displayDensity };
}

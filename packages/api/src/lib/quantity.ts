export type QuantityMode = 'integer' | 'decimal_2';

const SIGNED_QUANTITY_RE = /^-?\d+(?:\.\d{1,2})?$/;

/** 单位推断数量模式：称重/计量单位使用两位小数，其余按整数 */
export function inferQuantityMode(unit: string | null | undefined): QuantityMode {
  const normalized = (unit ?? '').trim().toLowerCase();
  if (['斤', 'kg', '千克', 'l', '升', 'ml', '毫升'].includes(normalized)) {
    return 'decimal_2';
  }
  return 'integer';
}

/**
 * 把任意输入规范成 numeric(12,2) 字符串。
 * integer 模式只接受整数值；decimal_2 超过两位小数直接拒绝，不做静默四舍五入。
 */
export function normalizeSignedQuantity(
  value: unknown,
  mode: QuantityMode
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const raw = String(value).trim();
  if (!SIGNED_QUANTITY_RE.test(raw)) return null;

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const frac = (fracRaw + '00').slice(0, 2);

  if (mode === 'integer' && frac !== '00') return null;
  const normalized = `${intPart}.${frac}`;
  if (normalized === '0.00') return '0.00';
  return negative ? `-${normalized}` : normalized;
}

/** 只接受非负数量；库存调整的负数增量请使用 normalizeSignedQuantity */
export function normalizeQuantity(
  value: unknown,
  mode: QuantityMode
): string | null {
  const normalized = normalizeSignedQuantity(value, mode);
  return normalized && !normalized.startsWith('-') ? normalized : null;
}

export function quantityNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(value);
}

/** 展示用：整数模式去掉 .00，小数模式保留两位 */
export function formatQuantity(
  value: string | number | null | undefined,
  mode: QuantityMode
) {
  const normalized = normalizeQuantity(value, mode);
  if (normalized === null) return '0';
  if (mode === 'integer') return String(Number(normalized));
  return normalized;
}

export function stepForMode(mode: QuantityMode) {
  return mode === 'integer' ? 1 : 0.01;
}

/** 金额：数量 × 单价，保留两位 */
export function roundAmount(quantity: string, unitCost: string) {
  const cents = Math.round(Number(quantity) * Number(unitCost) * 100);
  return (cents / 100).toFixed(2);
}

export function addMoney(values: string[]) {
  const cents = values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
  return (cents / 100).toFixed(2);
}

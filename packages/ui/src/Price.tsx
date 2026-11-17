import type { CSSProperties, ReactNode } from 'react';

/** 主题色 token：映射到 web 的 CSS 变量，变量缺失时回落到浅色主题值 */
const COLOR_TOKENS: Record<string, string> = {
  brand: 'rgb(var(--brand-700, 47 107 71))',
  'brand-500': 'rgb(var(--brand-500, 76 154 106))',
  'brand-700': 'rgb(var(--brand-700, 47 107 71))',
  primary: 'rgb(var(--primary, 47 107 71))',
  ink: 'rgb(var(--ink, 30 42 34))',
  'ink-2': 'rgb(var(--ink-2, 85 101 90))',
  'ink-3': 'rgb(var(--ink-3, 138 150 144))',
  amber: 'rgb(var(--amber, 201 133 43))',
  danger: 'rgb(var(--danger, 180 83 74))'
};

/** 默认价格色：酒红（只在调用方不传 color 时使用） */
const DEFAULT_COLOR = '#8E2F3D';

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  RMB: '¥',
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  HKD: 'HK$',
  KRW: '₩'
};

export type PriceColor = string;

export interface PriceProps {
  /** 金额：数字或字符串都可，null/undefined/非法值按 0 处理 */
  value: number | string | null | undefined;
  /** 币种代码，默认人民币 CNY */
  currency?: string;
  /** 字体颜色：支持主题 token（brand / ink / ink-2 / ink-3 / primary / amber / danger）或任意 CSS 色值，默认酒红 */
  color?: PriceColor;
  /** 小数位数，默认两位 */
  decimals?: number;
  /** 金额字号：数字按 px 处理，也可传 '15px' 这类字符串；不传则继承父级 */
  size?: number | string;
  /** 金额字重，默认 700 */
  weight?: number | string;
  /** 货币符号字号，默认 0.72em（跟随金额字号缩放） */
  symbolSize?: number | string;
  /** 货币符号字重，默认跟随金额字重 */
  symbolWeight?: number | string;
  /** 是否显示货币符号，默认显示 */
  showSymbol?: boolean;
  /** 是否使用千分位，默认不使用 */
  thousands?: boolean;
  /** 渲染成什么标签，默认 span */
  as?: 'span' | 'b' | 'strong' | 'em' | 'div';
  className?: string;
  style?: CSSProperties;
  title?: string;
  'aria-label'?: string;
}

function cssValue(value?: number | string): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

function parseNumber(value: number | string | null | undefined): number {
  const numeric =
    typeof value === 'string' ? Number(value.replace(/[^\d.eE+-]/g, '')) : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** 金额格式化：固定小数位、可选千分位，非法值按 0 输出，不会出现 NaN */
export function formatAmount(
  value: number | string | null | undefined,
  decimals = 2,
  thousands = false
): string {
  const digits = Math.min(20, Math.max(0, Math.trunc(decimals)));
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: thousands
  }).format(parseNumber(value));
}

/** 颜色解析：主题 token 优先，其余按 CSS 色值原样透传 */
export function resolvePriceColor(color?: PriceColor): string {
  if (!color) return DEFAULT_COLOR;
  return COLOR_TOKENS[color] ?? color;
}

export function Price({
  value,
  currency = 'CNY',
  color,
  decimals = 2,
  size,
  weight = 700,
  symbolSize = '0.72em',
  symbolWeight,
  showSymbol = true,
  thousands = false,
  as: Tag = 'span',
  className,
  style,
  title,
  'aria-label': ariaLabel
}: PriceProps) {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const symbolNode: ReactNode = showSymbol ? (
    <em
      style={{
        fontStyle: 'normal',
        fontSize: cssValue(symbolSize),
        fontWeight: symbolWeight ?? weight,
        marginRight: 2
      }}
    >
      {symbol}
    </em>
  ) : null;

  return (
    <Tag
      className={className}
      title={title}
      aria-label={ariaLabel}
      style={{
        color: resolvePriceColor(color),
        fontWeight: weight,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...(size === undefined ? null : { fontSize: cssValue(size) }),
        ...style
      }}
    >
      {symbolNode}
      {formatAmount(value, decimals, thousands)}
    </Tag>
  );
}

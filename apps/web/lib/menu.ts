/** GET /api/mobile/shops/:id/home 与 /products 的返回结构 */

import { formatMessage } from '@/lib/i18n/config';
import type { Messages } from '@/lib/i18n/messages';

export type MenuShop = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  status: 'open' | 'closed';
  coverUrl: string | null;
  businessHours: Record<string, { open: string; close: string }> | null;
  announcement: string | null;
};

export type MenuCategory = {
  id: string;
  name: string;
  iconUrl: string | null;
  productCount: number;
  children: { id: string; name: string; iconUrl: string | null; productCount: number }[];
};

export type ShopHomePayload = {
  shop: MenuShop;
  categories: MenuCategory[];
};

export type MenuSku = {
  skuId: string;
  productId: string;
  specName: string;
  barcode: string | null;
  unit: string;
  quantityMode: 'integer' | 'decimal_2';
  stockType: 'tracked' | 'untracked';
  isDefault: boolean;
  price: string | null;
  stockQuantity: string;
  soldOut: boolean;
};

export type MenuProduct = {
  id: string;
  catalogProductId: string | null;
  name: string;
  imageUrl: string | null;
  unit: string;
  price: string | null;
  categoryId: string | null;
  defaultSkuId: string | null;
  priceFrom: string | null;
  priceTo: string | null;
  soldOut: boolean;
  skus: MenuSku[];
};

export type MenuProductPage = {
  items: MenuProduct[];
  total: number;
  page: number;
  pageSize: number;
};

/** 一行商品的计价规格：优先默认规格，缺货时也保留展示 */
export function defaultSkuOf(product: MenuProduct): MenuSku | null {
  return product.skus.find((sku) => sku.skuId === product.defaultSkuId) ?? product.skus[0] ?? null;
}

/** 多规格商品：>1 个可售规格时，加购前必须先选规格 */
export function hasMultipleSkus(product: MenuProduct): boolean {
  return product.skus.length > 1;
}

/** 未售罄的规格；整行是否可买只看这个集合 */
export function sellableSkusOf(product: MenuProduct): MenuSku[] {
  return product.skus.filter((sku) => !sku.soldOut);
}

/** 售罄判定落到规格粒度：全部规格都售罄（或没有规格）才算整行卖完 */
export function isProductSoldOut(product: MenuProduct): boolean {
  return product.skus.length === 0 || product.skus.every((sku) => sku.soldOut);
}

/** 多规格展示价：取可售规格的最低价与最高价，全部售罄时退回菜单价格 */
export function priceRangeOf(product: MenuProduct): { from: string; to: string } {
  const prices = sellableSkusOf(product)
    .map((sku) => Number(sku.price))
    .filter((price) => Number.isFinite(price));
  if (prices.length === 0) {
    const fallback = product.priceFrom ?? product.price ?? '0.00';
    return { from: fallback, to: product.priceTo ?? fallback };
  }
  return {
    from: Math.min(...prices).toFixed(2),
    to: Math.max(...prices).toFixed(2)
  };
}

/** 列表副标题：单规格显示规格与单位，多规格显示规格数量与可售数 */
export function specsSummaryOf(product: MenuProduct, messages: Messages): string {
  if (!hasMultipleSkus(product)) return specTextOf(product);
  const sellable = sellableSkusOf(product).length;
  return formatMessage(messages.menu.specsSummary, {
    total: product.skus.length,
    sellable
  });
}

export function specTextOf(product: MenuProduct): string {
  const sku = defaultSkuOf(product);
  const parts = [sku?.specName, sku?.unit || product.unit].filter(Boolean) as string[];
  return parts.join(' · ');
}

export function priceOf(product: MenuProduct): string {
  const sku = defaultSkuOf(product);
  return (sku?.price ?? product.price ?? '0.00').toString();
}

/** 数量步进：按斤/升等计量单位走 0.5，其余按整数 */
export function stepOf(mode: 'integer' | 'decimal_2'): number {
  return mode === 'integer' ? 1 : 0.5;
}

export function quantityText(quantity: number, mode: 'integer' | 'decimal_2'): string {
  if (mode === 'integer') return String(Math.round(quantity));
  return String(Number(quantity.toFixed(2)));
}

/** GET /api/mobile/shops/:id/home 与 /products 的返回结构 */

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

/**
 * 购物车数据模型与纯展示逻辑。
 * 这里不依赖请求上下文（无 cookies / next/headers / server-only），
 * 客户端组件与服务端组件都可以安全引用。
 * 需要读会话、调用接口时请使用 lib/cart.ts。
 */

/** 与 packages/api 的 GET /api/mobile/cart 返回结构一致 */
export type CartItem = {
  id: string;
  productId: string;
  skuId: string;
  specName: string | null;
  name: string;
  imageUrl: string | null;
  unit: string;
  unitPrice: string;
  quantity: number;
  quantityText: string;
  quantityMode: 'integer' | 'decimal_2';
  stockQuantity: number;
  soldOut: boolean;
  /** 已下架：门店停售、总部强制下架或目录规格停用；与售罄分开提示 */
  offShelf: boolean;
  subtotal: string;
};

export type CartGroup = {
  id: string;
  shopId: string;
  shopName: string;
  remark: string;
  updatedAt: string;
  itemCount: number;
  totalAmount: string;
  items: CartItem[];
};

export type CartPayload = {
  carts: CartGroup[];
  itemCount: number;
  totalAmount: string;
};

export function cartGroupOf(payload: CartPayload | null, shopId: string): CartGroup | null {
  if (!payload) return null;
  return payload.carts.find((group) => group.shopId === shopId) ?? null;
}

/** 顶栏角标：数量可能是小数（按斤称重），统一向上取整成整数件 */
export function cartBadgeCount(payload: CartPayload | null): number {
  const count = payload?.itemCount ?? 0;
  return count > 0 ? Math.max(1, Math.ceil(count - 0.0001)) : 0;
}

/** 购物车条目可用性：下架优先于售罄，二者都不能购买 */
export type CartItemAvailability = 'available' | 'sold_out' | 'off_shelf';

export function cartItemAvailability(
  item: Pick<CartItem, 'soldOut' | 'offShelf'>
): CartItemAvailability {
  if (item.offShelf) return 'off_shelf';
  if (item.soldOut) return 'sold_out';
  return 'available';
}

export function isCartItemUnavailable(item: Pick<CartItem, 'soldOut' | 'offShelf'>) {
  return item.offShelf || item.soldOut;
}

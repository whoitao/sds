import { Platform } from 'react-native';

/**
 * 顾客端接口基地址。
 * - iOS 模拟器 / Expo Go（本机）：localhost；
 * - Android 模拟器：ADB reverse 将设备 localhost 映射到宿主机；
 * - preview / 真机：通过 EXPO_PUBLIC_API_BASE_URL 注入线上 HTTPS 地址。
 */
const DEV_API_BASE_URL = Platform.select({
  android: 'http://localhost:19852',
  default: 'http://localhost:19852'
}) ?? 'http://localhost:19852';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || DEV_API_BASE_URL
).replace(/\/+$/, '');

export interface ShopInfo {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  coverUrl: string | null;
  businessHours: Record<string, { open: string; close: string }> | null;
  announcement: string | null;
  longitude: number;
  latitude: number;
  status: 'open' | 'closed';
  distanceMeters?: number | null;
}

export interface ShopLocation {
  longitude: number;
  latitude: number;
}

export interface CategoryChild {
  id: string;
  name: string;
  iconUrl: string | null;
  productCount: number;
}

export interface CategoryNode {
  id: string;
  name: string;
  iconUrl: string | null;
  productCount: number;
  children: CategoryChild[];
}

export interface HomePayload {
  shop: ShopInfo;
  categories: CategoryNode[];
}

export type QuantityMode = 'integer' | 'decimal_2';

export interface ProductSkuItem {
  skuId: string;
  specName: string;
  barcode: string | null;
  unit: string;
  quantityMode: QuantityMode;
  stockType: 'tracked' | 'untracked';
  isDefault: boolean;
  price: string;
  stockQuantity: number;
  soldOut: boolean;
}

export interface ProductItem {
  id: string;
  catalogProductId: string | null;
  name: string;
  imageUrl: string | null;
  unit: string;
  price: string;
  priceFrom: string;
  priceTo: string;
  categoryId: string | null;
  defaultSkuId: string | null;
  soldOut: boolean;
  skus: ProductSkuItem[];
}

export interface ProductListPayload {
  items: ProductItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerProfile {
  id: string;
  nickname: string | null;
  phone: string;
  avatarUrl: string | null;
  totalOrders: number;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  expiresAt: string;
  isNew: boolean;
  customer: CustomerProfile;
  user: { id: string; phone: string; name: string | null; role?: string };
}

export interface SendCodePayload {
  devMode: boolean;
  devCode: string;
  expiresIn: number;
  message: string;
}

export interface CartItem {
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
  quantityMode: QuantityMode;
  stockQuantity: number;
  soldOut: boolean;
  subtotal: string;
}

export interface CartGroup {
  id: string;
  shopId: string;
  shopName: string;
  remark: string;
  updatedAt: string;
  itemCount: number;
  totalAmount: string;
  items: CartItem[];
}

export interface CartPayload {
  carts: CartGroup[];
  itemCount: number;
  totalAmount: string;
}

async function request<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const { token, headers, ...rest } = init ?? {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ?? `请求失败（${response.status}）`);
  }
  return payload as T;
}

export function fetchShops(keyword = '') {
  return request<{ items: ShopInfo[] }>(`/api/mobile/shops?keyword=${encodeURIComponent(keyword)}`);
}

export function fetchNearbyShops(location: ShopLocation, radius = 3000, keyword = '') {
  const query = new URLSearchParams({
    lat: String(location.latitude),
    lng: String(location.longitude),
    radius: String(radius),
    keyword
  });
  return request<{ items: ShopInfo[] }>(`/api/mobile/shops/nearby?${query}`);
}

export function fetchHome(shopId: string) {
  return request<HomePayload>(`/api/mobile/shops/${shopId}/home`);
}

export function fetchProducts(shopId: string, categoryId?: string, pageSize = 100) {
  const query = [`pageSize=${pageSize}`];
  if (categoryId) query.push(`categoryId=${encodeURIComponent(categoryId)}`);
  return request<ProductListPayload>(
    `/api/mobile/shops/${shopId}/products?${query.join('&')}`
  );
}

/** ⚠️ 开发态临时方案：短信服务未接入，接口会返回固定验证码 devCode */
export function sendCode(phone: string) {
  return request<SendCodePayload>('/api/auth/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone })
  });
}

export function loginWithCode(payload: {
  phone: string;
  code: string;
  mode: 'login' | 'register';
  nickname?: string;
}) {
  return request<AuthSession>('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function fetchMe(token: string) {
  return request<{ customer: CustomerProfile; user: AuthSession['user'] }>('/api/auth/me', {
    token
  });
}

export function logout(token: string) {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', token });
}

/** 购物车：服务端落库，与 admin 购物车管理读写同一份数据 */
export function fetchCart(token: string) {
  return request<CartPayload>('/api/mobile/cart', { token });
}

export function addCartItem(token: string, skuId: string, quantity: number | string = 1) {
  return request<CartPayload>('/api/mobile/cart/items', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skuId, quantity })
  });
}

export function updateCartItem(token: string, itemId: string, quantity: number) {
  return request<CartPayload>(`/api/mobile/cart/items/${itemId}`, {
    method: 'PATCH',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quantity })
  });
}

export function removeCartItem(token: string, itemId: string) {
  return request<CartPayload>(`/api/mobile/cart/items/${itemId}`, {
    method: 'DELETE',
    token
  });
}

export function clearCart(token: string, shopId: string) {
  return request<CartPayload>(`/api/mobile/cart?shopId=${encodeURIComponent(shopId)}`, {
    method: 'DELETE',
    token
  });
}

export function saveCartRemark(token: string, shopId: string, remark: string) {
  return request<CartPayload>('/api/mobile/cart/remark', {
    method: 'PATCH',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopId, remark })
  });
}

export interface AddressItem {
  id: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string | null;
  province: string | null;
  cityCode: string | null;
  city: string | null;
  districtCode: string | null;
  district: string | null;
  detail: string;
  remark: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  contactName: string;
  contactPhone: string;
  detail: string;
  provinceCode: string;
  cityCode: string;
  districtCode: string;
  remark?: string | null;
  isDefault?: boolean;
}

/** 收货地址：一个顾客可有多条，默认地址唯一 */
export function fetchAddresses(token: string) {
  return request<{ items: AddressItem[] }>('/api/addresses', { token });
}

export function createAddress(token: string, input: AddressInput) {
  return request<{ address: AddressItem }>('/api/addresses', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export function updateAddress(token: string, id: string, input: Partial<AddressInput>) {
  return request<{ address: AddressItem }>(`/api/addresses/${id}`, {
    method: 'PATCH',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export function setDefaultAddress(token: string, id: string) {
  return request<{ items: AddressItem[] }>(`/api/addresses/${id}/default`, {
    method: 'PATCH',
    token
  });
}

export function deleteAddress(token: string, id: string) {
  return request<{ ok: boolean; items: AddressItem[] }>(`/api/addresses/${id}`, {
    method: 'DELETE',
    token
  });
}

export interface OrderItemPayload {
  id: string;
  productId: string;
  skuId: string;
  name: string;
  specName: string | null;
  imageUrl: string | null;
  unit: string;
  quantityMode: QuantityMode;
  unitPrice: string;
  quantity: number;
  subtotal: string;
}

export interface OrderPayload {
  id: string;
  orderNo: string;
  shopId: string;
  shopName: string;
  status: string;
  statusLabel: string;
  fulfillmentType: 'delivery' | 'pickup';
  itemCount: number;
  totalAmount: string;
  remark: string | null;
  contactName: string | null;
  contactPhone: string | null;
  addressText: string | null;
  cancelledReason: string | null;
  paymentMethod: 'wechat' | 'cash' | 'balance' | null;
  paymentMethodLabel: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  refundAmount: string | null;
  refundReason: string | null;
  refundRejectedReason: string | null;
  canPay: boolean;
  canCancel: boolean;
  /** 线上已收款：点「不要了」会转成退款申请，等店长确认 */
  cancelNeedsRefund: boolean;
  createdAt: string;
  completedAt: string | null;
  items: OrderItemPayload[];
}

export interface CheckoutGroup {
  shopId: string;
  shopName: string;
  remark: string;
  items: CartItem[];
}

export interface CreateOrdersInput {
  fulfillmentType: 'delivery' | 'pickup';
  paymentMethod: 'wechat' | 'cash';
  addressId?: string;
  remark?: string;
  groups: { shopId: string; itemIds: string[]; remark?: string }[];
}

/** 下单：一店一单，服务端校验库存并在同一事务内扣减；微信支付先落待支付 */
export function createOrders(token: string, input: CreateOrdersInput) {
  return request<{ orders: OrderPayload[] }>('/api/mobile/orders', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}

/** 支付待付款订单：多店多单可以一次付完（当前为沙箱通道，不做真实扣款） */
export function payOrders(token: string, orderIds: string[]) {
  return request<{ orders: OrderPayload[] }>('/api/mobile/orders/pay', {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderIds })
  });
}

export interface CancelOrderResult {
  order: OrderPayload | null;
  refundPending: boolean;
  message: string;
}

/** 顾客取消：未收款直接取消并回补库存，已收款转退款申请 */
export function cancelOrder(token: string, orderId: string, reason?: string) {
  return request<CancelOrderResult>(`/api/mobile/orders/${orderId}/cancel`, {
    method: 'POST',
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason })
  });
}

export function fetchOrders(token: string) {
  return request<{ items: OrderPayload[] }>('/api/mobile/orders', { token });
}

/** 单笔订单详情：与列表条目同结构，详情页打开时刷新一次 */
export function fetchOrder(token: string, orderId: string) {
  return request<{ order: OrderPayload | null }>(
    `/api/mobile/orders/${encodeURIComponent(orderId)}`,
    { token }
  );
}

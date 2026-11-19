'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Price } from '@sds/ui';
import { AddressForm } from '@/components/AddressBook';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import ProgressSteps from '@/components/ProgressSteps';
import { setDefaultAddressAction } from '@/app/(site)/addresses/actions';
import type { AddressItem } from '@/lib/api';
import {
  cartItemAvailability,
  isCartItemUnavailable,
  type CartGroup,
  type CartPayload
} from '@/lib/cart-model';
import type { RegionTreeNode } from '@/lib/regions';
import { placeOrderAction, type CheckoutOrder } from '@/lib/checkout-actions';

const CARD = 'rounded-[18px] border border-line bg-card p-4 shadow-perk sm:p-5';
const CHOICE_BASE =
  'flex min-h-[66px] flex-col items-start gap-1 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors';

const HIDDEN_REGION_NAMES = new Set([
  '市辖区',
  '省直辖县级行政区划',
  '自治区直辖县级行政区划'
]);

function fullAddress(item: AddressItem) {
  const region = [item.province, item.city, item.district]
    .filter((name): name is string => Boolean(name) && !HIDDEN_REGION_NAMES.has(name as string))
    .join('');
  return `${region}${item.detail}`;
}

function maskPhone(phone: string) {
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

function quantityOf(text: string) {
  const value = Number(text);
  return Number.isFinite(value) ? String(value) : text;
}

function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (name) {
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'bag':
      return (
        <svg {...common}>
          <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    default:
      return null;
  }
}

function Choice({
  active,
  title,
  sub,
  onClick
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${CHOICE_BASE} ${
        active
          ? 'border-brand-500 bg-brand-50/70'
          : 'border-line bg-card hover:border-brand-200'
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${
            active ? 'border-brand-600 bg-brand-600' : 'border-line bg-card'
          }`}
        >
          {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
        </span>
        <b className="text-[15px] text-ink">{title}</b>
      </span>
      <span className="pl-6 text-[12px] leading-[1.45] text-ink-3">{sub}</span>
    </button>
  );
}

type PlacedResult = {
  orders: CheckoutOrder[];
  paymentMethod: 'cash' | 'wechat';
  remaining: { shopId: string; shopName: string }[];
};

export default function Checkout({
  cart,
  addresses,
  regionTree,
  shops,
  customerName,
  customerPhone,
  backShop
}: {
  cart: CartPayload;
  addresses: AddressItem[];
  regionTree: RegionTreeNode[];
  shops: Record<string, { address: string; phone: string }>;
  customerName: string;
  customerPhone: string;
  backShop: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [payment, setPayment] = useState<'cash' | 'wechat'>('cash');
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    addresses.find((item) => item.isDefault)?.id ?? addresses[0]?.id ?? null
  );
  const [addressOpen, setAddressOpen] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedResult | null>(null);
  const [pending, startTransition] = useTransition();
  // 每家店已勾选的商品：默认把要结算那家店的可售商品全部勾上，其余店先不勾
  const [selection, setSelection] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    const preferred =
      cart.carts.find((group) => group.shopId === backShop?.id)?.id ?? cart.carts[0]?.id ?? null;
    for (const group of cart.carts) {
      initial[group.id] =
        group.id === preferred ? group.items.filter((item) => !isCartItemUnavailable(item)).map((item) => item.id) : [];
    }
    return initial;
  });

  // 购物车刷新后：保留仍然存在的勾选，移除已下架/售罄的条目，新出现的店默认全选
  useEffect(() => {
    setSelection((previous) => {
      const next: Record<string, string[]> = {};
      for (const group of cart.carts) {
        const availableIds = group.items.filter((item) => !isCartItemUnavailable(item)).map((item) => item.id);
        const previousIds = previous[group.id];
        next[group.id] =
          previousIds === undefined
            ? availableIds
            : availableIds.filter((id) => previousIds.includes(id));
      }
      return next;
    });
  }, [cart]);

  // 新增/删除地址后保持选中项有效，否则回落到默认地址
  useEffect(() => {
    if (addresses.length === 0) {
      setSelectedAddressId(null);
      return;
    }
    setSelectedAddressId((current) =>
      current && addresses.some((item) => item.id === current)
        ? current
        : addresses.find((item) => item.isDefault)?.id ?? addresses[0].id
    );
  }, [addresses]);

  const groups = cart.carts;
  const selectedIdsOf = (group: CartGroup) => selection[group.id] ?? [];
  const selectedItemsOf = (group: CartGroup) =>
    group.items.filter((item) => !isCartItemUnavailable(item) && selectedIdsOf(group).includes(item.id));

  // 一家店一单：优先结有勾选商品的店，没有勾选时回落到顶栏/店内选中的店
  const currentGroup: CartGroup | null =
    groups.find((group) => selectedItemsOf(group).length > 0) ??
    groups.find((group) => group.shopId === backShop?.id) ??
    groups[0] ??
    null;
  const otherGroups = currentGroup
    ? groups.filter((group) => group.id !== currentGroup.id)
    : [];

  const address = addresses.find((item) => item.id === selectedAddressId) ?? null;
  // 已下架/已售罄的商品不参与选择、合计与提交
  const availableItems = currentGroup ? currentGroup.items.filter((item) => !isCartItemUnavailable(item)) : [];
  const unavailableItems = currentGroup ? currentGroup.items.filter(isCartItemUnavailable) : [];
  const selectedItems = currentGroup ? selectedItemsOf(currentGroup) : [];
  const allUnavailable = Boolean(currentGroup) && currentGroup.items.length > 0 && availableItems.length === 0;
  const nothingSelected = Boolean(currentGroup) && !allUnavailable && selectedItems.length === 0;
  const needsAddress = fulfillment === 'delivery' && !address;
  const canSubmit = selectedItems.length > 0 && !pending && !needsAddress;

  const pickedCount = selectedItems.length;
  const totalAmount = (
    selectedItems.reduce((sum, item) => sum + Math.round(Number(item.subtotal) * 100), 0) / 100
  ).toFixed(2);

  function toggleItem(groupId: string, itemId: string) {
    setSelection((previous) => {
      const current = previous[groupId] ?? [];
      return {
        ...previous,
        [groupId]: current.includes(itemId)
          ? current.filter((id) => id !== itemId)
          : [...current, itemId]
      };
    });
  }

  function toggleGroup(group: CartGroup) {
    const availableIds = group.items.filter((item) => !isCartItemUnavailable(item)).map((item) => item.id);
    setSelection((previous) => {
      const current = previous[group.id] ?? [];
      const allSelected = availableIds.length > 0 && availableIds.every((id) => current.includes(id));
      return { ...previous, [group.id]: allSelected ? [] : availableIds };
    });
  }

  function setDefaultAddress(id: string) {
    setBusyId(id);
    setError('');
    startTransition(async () => {
      const result = await setDefaultAddressAction(id);
      setBusyId(null);
      if (result.ok) {
        setNotice(result.message ?? '已设为默认地址');
        router.refresh();
      } else {
        setError(result.error ?? '设置默认地址失败，请稍后再试');
      }
    });
  }

  function chooseAddress(id: string) {
    setSelectedAddressId(id);
    setAddressOpen(false);
  }

  function submit() {
    if (!currentGroup || !canSubmit) return;
    setError('');
    setNotice('');
    startTransition(async () => {
      const result = await placeOrderAction({
        fulfillmentType: fulfillment,
        paymentMethod: payment,
        addressId: selectedAddressId,
        groups: [
          {
            shopId: currentGroup.shopId,
            itemIds: selectedItems.map((item) => item.id)
          }
        ]
      });
      if (!result.ok) {
        // 服务端已按门店实时状态拦截：把错误码翻成「怎么处理」，避免只看到一句「暂时不能购买」
        const hint =
          result.code === 'SKU_UNAVAILABLE'
            ? '（已下架，请回到选菜页把它从购物车移除后再结算）'
            : result.code === 'STOCK_INSUFFICIENT'
              ? '（已售罄或库存不足，请移除或减少数量后再结算）'
              : '';
        setError(`${result.error}${hint}`);
        return;
      }
      setPlaced({
        orders: result.orders,
        paymentMethod: payment,
        remaining: otherGroups.map((group) => ({
          shopId: group.shopId,
          shopName: group.shopName
        }))
      });
      // 下单后这家店的购物车已被清空：刷新让顶栏角标与店内购物车同步
      router.refresh();
    });
  }

  if (placed) {
    const online = placed.paymentMethod === 'wechat';
    const totalAmount = placed.orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
    return (
      <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-auto">
        <ProgressSteps current={4} />
        <section className="flex w-full min-w-0 flex-col rounded-[18px] border border-line bg-card shadow-perk lg:flex-auto lg:flex-row">
          {/* 成功状态 */}
          <div className="flex flex-col items-center justify-center gap-4 rounded-t-[18px] border-b border-line bg-brand-50/60 px-6 py-8 text-center lg:w-[38%] lg:shrink-0 lg:rounded-l-[18px] lg:rounded-tr-none lg:border-b-0 lg:border-r lg:py-10">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-600 text-white sm:h-20 sm:w-20">
              <Icon name="check" className="h-8 w-8 sm:h-10 sm:w-10" />
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="m-0 text-[24px] font-extrabold leading-[1.25] text-ink sm:text-[26px]">
                {online ? '订单已提交，等待支付' : '订单已提交，等待门店接单'}
              </h1>
              <p className="m-0 text-[15px] leading-[1.6] text-ink-2 sm:text-[16px]">
                {online
                  ? '线上支付尚未开通，本页没有扣款；订单已保留，请联系门店完成支付。'
                  : '已通知门店备货，请留意门店来电。'}
              </p>
            </div>
            <span className="flex max-w-full flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 rounded-full bg-card px-5 py-2.5 shadow-perk sm:px-6">
              <span className="text-[14px] font-bold leading-[1.4] text-ink-2 sm:text-[15px]">
                共 {placed.orders.length} 单 · 合计
              </span>
              <Price
                value={totalAmount}
                color="brand"
                size={28}
                weight={800}
                symbolSize="0.62em"
              />
            </span>
          </div>

          {/* 订单摘要与操作 */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="m-0 text-[18px] font-extrabold text-ink">订单摘要</h2>
              <span className="text-[13px] text-ink-3">请记下订单号，取货或收货时报给店员</span>
            </div>

          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {placed.orders.map((order) => (
              <li key={order.id} className="flex flex-col gap-2 rounded-xl bg-card-soft px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-[16px] text-ink">{order.shopName}</b>
                  <span className="text-[13px] text-ink-3">订单号 {order.orderNo}</span>
                  <span className="ml-auto text-[18px] font-extrabold text-ink">
                    <Price
                      value={order.totalAmount}
                      color="ink"
                      size={18}
                      weight={800}
                      symbolSize="1em"
                    />
                  </span>
                </div>
                <span className="text-[13px] text-ink-2">
                  {order.fulfillmentType === 'pickup' ? '到店自提' : '送货上门'} ·{' '}
                  {online ? '待支付' : '货到付款'} · 共 {order.itemCount} 件
                </span>
              </li>
            ))}
          </ul>

          <p
            className={`m-0 rounded-xl px-4 py-3 text-[14px] leading-[1.6] ${
              online ? 'bg-amber-soft text-amber-ink' : 'bg-info-soft text-ink-2'
            }`}
          >
            {online
              ? '线上支付暂未开通：请保留订单号并联系门店付款，页面不会发起任何扣款。'
              : '货到付款：到店自提在取货时付款，送货上门在收货时付款。'}
          </p>

          {placed.remaining.length > 0 ? (
            <p className="m-0 rounded-xl bg-card-soft px-4 py-3 text-[14px] text-ink-2">
              还有 {placed.remaining.length} 家店没结：
              {placed.remaining.map((shop) => shop.shopName).join('、')}
              。不同店的菜不能合成一单，需要分开下单。
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap gap-3 pt-1">
            {placed.remaining.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setPlaced(null);
                  setNotice('');
                  router.refresh();
                }}
                className="flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
              >
                继续结算下一家
              </button>
            ) : (
              <Link
                href="/"
                className="flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
              >
                回附近的店
              </Link>
            )}
            {backShop ? (
              <Link
                href={`/shops/${backShop.id}`}
                className="flex h-12 items-center rounded-xl border-[1.5px] border-brand-200 px-6 text-[17px] font-bold text-brand-700 transition-colors hover:bg-brand-50"
              >
                继续选菜
              </Link>
            ) : null}
          </div>
          </div>
        </section>
      </div>
    );
  }

  if (!currentGroup) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-3">
        <ProgressSteps current={3} />
        <div className="flex w-full min-w-0 flex-col items-center gap-3 rounded-[20px] bg-card px-6 py-16 text-center shadow-perk">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Icon name="bag" className="h-7 w-7" />
          </span>
          <b className="text-[22px] text-ink">购物车是空的</b>
          <p className="m-0 text-[16px] text-ink-2">先去店里挑点菜，再来结算。</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-bold text-white transition-colors hover:bg-primary-hover"
            >
              去附近的店
            </Link>
            {backShop ? (
              <Link
                href={`/shops/${backShop.id}`}
                className="flex h-12 items-center rounded-xl border-[1.5px] border-brand-200 px-6 text-[17px] font-bold text-brand-700 transition-colors hover:bg-brand-50"
              >
                回门店继续选菜
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <LoadingOverlay show={pending} text="正在提交，请稍候…" />
      <h1 className="sr-only">确认订单</h1>
      <ProgressSteps current={3} />

      <div className="grid w-full min-w-0 items-start gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-x-hidden lg:overflow-y-auto">
        <div className="flex min-w-0 flex-col gap-3">
          {groups.map((group) => {
            const isCurrent = group.id === currentGroup.id;
            // 组头勾选与「已选 N 样」都只算可售商品，售罄项一律不计入
            const availableIds = group.items.filter((item) => !isCartItemUnavailable(item)).map((item) => item.id);
            const selectedIds = selectedIdsOf(group);
            const selectedCount = availableIds.filter((id) => selectedIds.includes(id)).length;
            const noAvailable = availableIds.length === 0;
            const allSelected = !noAvailable && selectedCount === availableIds.length;
            const partial = selectedCount > 0 && !allSelected;
            return (
              <section
                key={group.id}
                className={`${CARD} ${isCurrent ? '' : 'bg-card-soft/50'}`}
              >
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={partial ? 'mixed' : allSelected}
                    aria-disabled={noAvailable || undefined}
                    aria-label={`${group.shopName}：${allSelected ? '取消全选' : '全选'}可售商品`}
                    disabled={noAvailable}
                    onClick={() => toggleGroup(group)}
                    className={`relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${
                      allSelected || partial
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : noAvailable
                          ? 'border-line bg-segment text-ink-3'
                          : 'border-line bg-card text-transparent hover:border-brand-300'
                    }`}
                  >
                    {noAvailable ? (
                      <span className="h-[2px] w-2.5 rounded-full bg-ink-3" />
                    ) : allSelected ? (
                      <Icon name="check" className="h-3.5 w-3.5" />
                    ) : partial ? (
                      <span className="h-[2px] w-2.5 rounded-full bg-white" />
                    ) : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <b className="text-[16px] text-ink sm:text-[17px]">{group.shopName}</b>
                      <span className="text-[13px] text-ink-3 sm:text-[14px]">
                        已选 {selectedCount} 样
                      </span>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[13px] font-bold sm:text-[14px] ${
                      isCurrent && !noAvailable ? 'text-ink' : 'text-ink-3'
                    }`}
                  >
                    {isCurrent ? (noAvailable ? '暂无可结算' : '本次结这家') : '下一单再结'}
                  </span>
                </div>

                <ul className="m-0 mt-3 flex list-none flex-col p-0">
                  {group.items.map((item) => {
                    const availability = cartItemAvailability(item);
                    const unavailable = availability !== 'available';
                    const isSelected = !unavailable && selectedIds.includes(item.id);
                    const blockLabel = availability === 'off_shelf' ? '已下架' : '已售罄';
                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-2.5 border-t border-line py-3 first:border-t-0 first:pt-0 sm:gap-3"
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-disabled={unavailable || undefined}
                          aria-label={`${unavailable ? `${blockLabel}，无法选择：` : '选择：'}${item.name}`}
                          title={unavailable ? `${blockLabel}，无法选择` : undefined}
                          disabled={unavailable}
                          onClick={() => toggleItem(group.id, item.id)}
                          className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${
                            unavailable
                              ? 'border-line bg-segment text-ink-3'
                              : isSelected
                                ? 'border-brand-500 bg-brand-500 text-white'
                                : 'border-line bg-card text-transparent hover:border-brand-300'
                          }`}
                        >
                          {unavailable ? (
                            <span className="h-[2px] w-2 rounded-full bg-ink-3" />
                          ) : isSelected ? (
                            <Icon name="check" className="h-3 w-3" />
                          ) : null}
                        </button>
                        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-thumb-from text-[15px] font-extrabold text-brand-700 sm:h-12 sm:w-12 sm:text-[17px]">
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt=""
                              width={96}
                              height={96}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            item.name.slice(0, 1)
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`m-0 truncate text-[15px] font-bold sm:text-[16px] ${
                              unavailable ? 'text-ink-3' : 'text-ink'
                            }`}
                          >
                            {item.name}
                          </p>
                          <p className="m-0 mt-0.5 text-[12px] leading-[1.45] text-ink-3 sm:text-[13px]">
                            {item.specName ? (
                              <span className="whitespace-nowrap">{item.specName} · </span>
                            ) : null}
                            <span className="whitespace-nowrap">
                              <Price
                                value={item.unitPrice}
                                color="ink-3"
                                weight={400}
                                symbolSize="1em"
                              />
                              /{item.unit}
                            </span>
                          </p>
                          {unavailable ? (
                            <span
                              className={`mt-1 inline-flex rounded px-2 py-0.5 text-[12px] font-bold ${
                                availability === 'off_shelf'
                                  ? 'bg-danger-soft text-danger'
                                  : 'bg-segment text-ink-3'
                              }`}
                            >
                              {blockLabel}
                            </span>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 whitespace-nowrap text-[16px] font-bold tabular-nums sm:text-[17px] ${
                            unavailable ? 'text-ink-3' : 'text-ink'
                          }`}
                        >
                          ×{quantityOf(item.quantityText)}
                        </span>
                        <Price
                          as="b"
                          className="ml-1.5 w-[64px] shrink-0 text-right text-[15px] sm:ml-2 sm:w-[74px] sm:text-[17px]"
                          value={item.subtotal}
                          color={unavailable ? 'ink-3' : 'ink'}
                          weight={800}
                          symbolSize="1em"
                        />
                      </li>
                    );
                  })}
                </ul>

                {!isCurrent ? (
                  <p className="m-0 mt-3 -mx-4 -mb-4 rounded-b-[18px] bg-amber-soft px-4 py-2.5 text-[13px] leading-[1.55] text-amber-ink sm:-mx-5 sm:-mb-5 sm:text-[14px]">
                    不同店的菜不能合成一单，结完 {currentGroup.shopName} 再来结这家。
                  </p>
                ) : otherGroups.length === 0 ? (
                  <p className="m-0 mt-3 -mx-4 -mb-4 rounded-b-[18px] bg-amber-soft px-4 py-2.5 text-[13px] leading-[1.55] text-amber-ink sm:-mx-5 sm:-mb-5 sm:text-[14px]">
                    不同店的菜不能合成一单，一单一店结算；同一家店的菜可以一起提交。
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>

        <aside className={`${CARD} lg:sticky lg:top-0 lg:flex lg:max-h-full lg:flex-col lg:overflow-hidden lg:p-0`}>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-5">
          <h2 className="m-0 text-[19px] font-extrabold text-ink">怎么拿菜</h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Choice
              active={fulfillment === 'delivery'}
              title="送货到家"
              sub={address ? `送到${address.district ?? '你选的地址'}` : '送到你选的地址'}
              onClick={() => setFulfillment('delivery')}
            />
            <Choice
              active={fulfillment === 'pickup'}
              title="我去店里拿"
              sub="到店自提，做好通知你"
              onClick={() => setFulfillment('pickup')}
            />
          </div>

          {fulfillment === 'delivery' ? (
            <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3">
              <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
              <div className="min-w-0 flex-1">
                {address ? (
                  <>
                    <p className="m-0 flex flex-wrap items-center gap-x-2 text-[14px]">
                      <b className="text-ink">{address.contactName}</b>
                      <span className="text-ink-3">{maskPhone(address.contactPhone)}</span>
                    </p>
                    <p className="m-0 mt-0.5 text-[13px] leading-[1.5] text-ink-2">
                      {fullAddress(address)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="m-0 text-[14px] font-bold text-ink">还没有收货地址</p>
                    <p className="m-0 mt-0.5 text-[13px] text-ink-3">
                      先添加一个地址才能送货到家
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAddressOpen(true)}
                className="shrink-0 text-[14px] font-bold text-brand-700 transition-colors hover:text-brand-800"
              >
                {address ? '换地址' : '添加地址'}
              </button>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              {groups.map((group) => {
                const isCurrent = group.id === currentGroup.id;
                return (
                  <div
                    key={group.id}
                    className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${
                      isCurrent ? 'border-brand-300 bg-brand-50/40' : 'border-line'
                    }`}
                  >
                    <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 flex flex-wrap items-center gap-x-2 text-[14px] font-bold text-ink">
                        {group.shopName}
                        <span className="text-[12px] font-normal text-ink-3">
                          {isCurrent ? '本次自提' : '下一单再结'}
                        </span>
                      </p>
                      <p className="m-0 mt-0.5 text-[13px] leading-[1.5] text-ink-2">
                        {shops[group.shopId]?.address ?? '门店地址待补充'}
                      </p>
                    </div>
                  </div>
                );
              })}
              <p className="m-0 px-1 text-[13px] text-ink-3">
                取货人：{customerName || '当前账号'} {maskPhone(customerPhone)}
              </p>
            </div>
          )}

          <h2 className="mt-5 text-[19px] font-extrabold text-ink">怎么付钱</h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Choice
              active={payment === 'wechat'}
              title="现在微信付"
              sub="线上支付暂未开通"
              onClick={() => setPayment('wechat')}
            />
            <Choice
              active={payment === 'cash'}
              title="收到菜再付钱"
              sub="收货/取货时付给店里"
              onClick={() => setPayment('cash')}
            />
          </div>
          {payment === 'wechat' ? (
            <p className="m-0 mt-2 rounded-lg bg-amber-soft px-3 py-2 text-[12px] leading-[1.5] text-amber-ink">
              线上支付暂未开通：提交后订单会保留为待支付，本页不会扣款，请联系门店付款。
            </p>
          ) : null}

          {unavailableItems.length > 0 ? (
            <p className="m-0 mt-3 rounded-xl bg-amber-soft px-3 py-2 text-[12px] leading-[1.55] text-amber-ink">
              {unavailableItems
                .map((item) => `「${item.name}」${item.offShelf ? '已下架' : '已售罄'}`)
                .join('、')}
              暂不能购买，已自动排除、不计入合计；如需清理请回选菜页移除。
            </p>
          ) : null}
          </div>

          <div className="mt-4 shrink-0 border-t border-dashed border-line pt-4 lg:m-0 lg:border-solid lg:px-5 lg:pb-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] text-ink-2">一共 {pickedCount} 样，合计</span>
              <Price as="b" value={totalAmount} color="ink" size={28} weight={800} symbolSize="1em" />
            </div>

            {notice ? (
              <p className="m-0 mt-3 rounded-xl bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="m-0 mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="mt-3 h-[52px] w-full rounded-full bg-primary text-[18px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-segment disabled:text-ink-3"
            >
              {pending
                ? '提交中…'
                : payment === 'wechat'
                  ? '确认下单，待支付'
                  : '确认下单，收货再付'}
            </button>
            <p className="m-0 mt-2 min-h-[18px] text-center text-[12px] leading-[1.5] text-ink-3">
              {allUnavailable
                ? '这家店的菜都已下架或售罄，暂时无法下单。'
                : needsAddress
                  ? '请先选择一个收货地址'
                  : nothingSelected
                    ? '还没有勾选要结算的菜，勾选商品后再下单。'
                    : '提交后门店会确认备货；不同门店的菜需分开结算。'}
            </p>
          </div>
        </aside>
      </div>

      {addressOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="选择收货地址"
          onClick={() => {
            setAddressOpen(false);
            setAddingAddress(false);
          }}
        >
          <div
            className="max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[22px] bg-card p-5 shadow-perk sm:rounded-[22px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-[20px] font-extrabold text-ink">选择收货地址</h2>
              <button
                type="button"
                onClick={() => {
                  setAddressOpen(false);
                  setAddingAddress(false);
                }}
                className="h-9 rounded-lg px-3 text-[15px] font-bold text-ink-2 transition-colors hover:bg-card-soft"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {addresses.map((item) => {
                const active = item.id === selectedAddressId;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border-[1.5px] p-3.5 transition-colors ${
                      active
                        ? 'border-brand-500 bg-brand-50/60'
                        : 'border-line bg-card-soft hover:border-brand-200'
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="radio"
                        name="address"
                        checked={active}
                        onChange={() => chooseAddress(item.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <b className="text-[16px] text-ink">{item.contactName}</b>
                          <span className="text-[14px] text-ink-2">
                            {maskPhone(item.contactPhone)}
                          </span>
                          {item.isDefault ? (
                            <em className="rounded-full bg-brand-50 px-2 py-0.5 text-[12px] font-bold not-italic text-brand-700">
                              默认
                            </em>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-[14px] leading-[1.5] text-ink-2">
                          {fullAddress(item)}
                        </span>
                      </span>
                    </label>
                    {item.isDefault ? null : (
                      <button
                        type="button"
                        onClick={() => setDefaultAddress(item.id)}
                        disabled={busyId === item.id}
                        className="mt-1.5 h-8 rounded-lg px-2 text-[13px] font-bold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === item.id ? '设置中…' : '设为默认'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {addingAddress ? (
              <div className="mt-4">
                <AddressForm
                  item={null}
                  isFirst={addresses.length === 0}
                  regionTree={regionTree}
                  onClose={() => setAddingAddress(false)}
                  onSaved={(message) => {
                    setAddingAddress(false);
                    setNotice(message);
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingAddress(true)}
                className="mt-3 h-11 w-full rounded-xl border-[1.5px] border-dashed border-brand-300 text-[15px] font-bold text-brand-700 transition-colors hover:bg-brand-50"
              >
                + 新增收货地址
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

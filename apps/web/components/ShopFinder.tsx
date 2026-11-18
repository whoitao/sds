'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { selectShop } from '@/lib/shop-actions';
import {
  distanceText,
  gpsToMapLocation,
  straightDistanceMeters,
  todayHoursText,
  type ShopItem,
  type ShopLocation
} from '@/lib/shops';

const ShopMap = dynamic(() => import('@/components/ShopMap'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-map text-[16px] text-ink-3">
      地图加载中…
    </div>
  )
});

type LocateState = 'locating' | 'ready' | 'denied' | 'unsupported';

function Icon({ name, className = 'h-[20px] w-[20px]' }: { name: 'loc' | 'phone' | 'shop'; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  if (name === 'loc') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        <circle cx="12" cy="12" r="7" />
      </svg>
    );
  }
  if (name === 'phone') {
    return (
      <svg {...common}>
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z" />
      <path d="M5 13v7h14v-7" />
    </svg>
  );
}

const TAG_BASE = 'inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-bold';

/** 默认只看直线距离 3 公里内的门店 */
const RANGE_METERS = 3000;

export default function ShopFinder({
  shops,
  selectedId: initialSelectedId,
  todayKey
}: {
  shops: ShopItem[];
  selectedId: string | null;
  todayKey: string;
}) {
  const router = useRouter();
  const [location, setLocation] = useState<ShopLocation | null>(null);
  const [locateState, setLocateState] = useState<LocateState>('locating');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [withinRange, setWithinRange] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [pending, startTransition] = useTransition();

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateState('unsupported');
      return;
    }
    setLocateState('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation(
          gpsToMapLocation({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude
          })
        );
        setLocateState('ready');
      },
      () => setLocateState('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  const listed = useMemo(() => {
    const rows = shops
      .filter((shop) => (onlyOpen ? shop.status === 'open' : true))
      .map((shop) => ({
        shop,
        distance: location ? straightDistanceMeters(location, shop) : null
      }));
    if (!location) return rows; // 没定位就不按距离筛，保持接口顺序（后台维护顺序）
    rows.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return withinRange ? rows.filter((row) => (row.distance ?? Infinity) <= RANGE_METERS) : rows;
  }, [shops, onlyOpen, location, withinRange]);

  // 有关掉 3 公里限制后才会出现的店，空列表时可以提示去切换
  const hasOutOfRange = useMemo(() => {
    if (!location) return false;
    return shops.some((shop) => straightDistanceMeters(location, shop) > RANGE_METERS);
  }, [shops, location]);

  const current = listed.find((row) => row.shop.id === selectedId) ?? null;

  const emptyText = onlyOpen
    ? '现在没有营业中的门店，取消筛选看看全部'
    : withinRange && hasOutOfRange
      ? '3 公里内没有营业中的门店，取消「3 公里内」看看全部'
      : '暂时还没有门店，晚点再来看看';

  function choose(shop: ShopItem) {
    if (shop.status !== 'open' || pending) return;
    setSelectedId(shop.id);
    startTransition(async () => {
      await selectShop(shop.id, shop.name);
      router.push(`/shops/${shop.id}`);
    });
  }

  function cardButton(shop: ShopItem, isCurrent: boolean) {
    const base =
      'col-span-2 flex h-10 w-full items-center justify-center rounded-full text-[15px] font-bold sm:col-span-1 sm:h-11 sm:w-auto sm:justify-self-end sm:self-center sm:px-5';
    if (shop.status !== 'open') {
      return (
        <button
          type="button"
          disabled
          className={`${base} cursor-not-allowed bg-segment text-ink-3`}
        >
          休息中
        </button>
      );
    }
    if (isCurrent) {
      return (
        <Link
          href={`/shops/${shop.id}`}
          className={`${base} border-[1.5px] border-brand-200 bg-brand-50 text-brand-700 transition-colors hover:bg-brand-100`}
        >
          去买菜
        </Link>
      );
    }
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => choose(shop)}
        className={`${base} bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-60`}
      >
        选他
      </button>
    );
  }

  return (
    <div className="grid w-full min-w-0 gap-6 lg:flex-1 lg:min-h-[420px] lg:grid-cols-[minmax(0,500px)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-4 lg:h-full lg:min-h-0 lg:[contain:size]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-[28px] font-extrabold text-ink">附近的店</h2>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-pressed={withinRange && Boolean(location)}
              disabled={!location}
              onClick={() => setWithinRange((value) => !value)}
              className={`flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border-[1.5px] px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:px-[18px] sm:text-[17px] ${
                withinRange && location
                  ? 'border-primary bg-primary font-bold text-white'
                  : 'border-line bg-card text-ink-2 hover:border-brand-300'
              }`}
            >
              3 公里内
            </button>
            <button
              type="button"
              aria-pressed={onlyOpen}
              onClick={() => setOnlyOpen((value) => !value)}
              className={`flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border-[1.5px] px-3 text-[13px] transition-colors sm:h-11 sm:px-[18px] sm:text-[17px] ${
                onlyOpen
                  ? 'border-brand-500 bg-brand-50 font-bold text-brand-700'
                  : 'border-line bg-card text-ink-2 hover:border-brand-300'
              }`}
            >
              只看营业中
            </button>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5 rounded-xl bg-info-soft px-3.5 py-2.5 text-[16px] text-ink-2">
          <Icon name="loc" className="h-[20px] w-[20px] text-info" />
          {locateState === 'ready' ? (
            <span>
              按 <b className="font-bold text-info">当前位置</b> 附近找的店
            </span>
          ) : null}
          {locateState === 'locating' ? <span>正在获取位置…</span> : null}
          {locateState === 'denied' ? <span>没拿到位置，先按门店列表看</span> : null}
          {locateState === 'unsupported' ? <span>这个浏览器不支持定位，先按门店列表看</span> : null}
          {locateState !== 'ready' ? (
            <button
              type="button"
              onClick={locate}
              className="ml-auto font-bold whitespace-nowrap text-info"
            >
              打开定位
            </button>
          ) : (
            <button
              type="button"
              onClick={locate}
              className="ml-auto font-bold whitespace-nowrap text-info"
            >
              重新定位
            </button>
          )}
        </div>

        <div className="min-h-0 lg:-mr-1.5 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:[scrollbar-gutter:stable] lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-line lg:[&::-webkit-scrollbar-track]:bg-transparent lg:[&::-webkit-scrollbar]:w-1.5">
          {listed.length === 0 ? (
            <p className="m-0 rounded-2xl bg-card px-5 py-8 text-center text-[17px] text-ink-2 shadow-perk">
              {emptyText}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {listed.map(({ shop, distance }) => {
                const open = shop.status === 'open';
                const isCurrent = shop.id === selectedId && shop.status === 'open';
                return (
                  <li key={shop.id}>
                    <div
                      className={`grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 rounded-2xl border-2 bg-card px-4 py-3.5 shadow-perk sm:grid-cols-[84px_minmax(0,1fr)_auto] sm:px-5 ${
                        isCurrent ? 'border-brand-500' : 'border-transparent'
                      }`}
                    >
                      <div
                        className={`grid h-auto w-16 shrink-0 self-stretch place-items-center overflow-hidden rounded-[14px] text-[24px] font-extrabold sm:w-[84px] sm:text-[28px] ${
                          open
                            ? 'bg-gradient-to-br from-thumb-from to-thumb-to text-brand-700'
                            : 'bg-gradient-to-br from-thumb-muted to-thumb-muted-to text-ink-3'
                        }`}
                      >
                        {shop.coverUrl ? (
                          // 后台传了实拍图就用实拍图，没有就用店名首字占位（与设计稿一致）
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={shop.coverUrl}
                            alt=""
                            width={320}
                            height={320}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          shop.name.slice(0, 1)
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col justify-between self-stretch">
                        <h2
                          className={`m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[17px] leading-[1.35] font-bold sm:text-[18px] ${
                            open ? 'text-ink' : 'text-ink-2'
                          }`}
                        >
                          <span className="min-w-0 break-words">{shop.name}</span>
                          {isCurrent ? (
                            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[12px] font-bold text-brand-700">
                              当前门店
                            </span>
                          ) : null}
                        </h2>
                        <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-[1.4] text-ink-2">
                          <span className={`${TAG_BASE} ${open ? 'bg-brand-50 text-brand-700' : 'bg-segment text-ink-3'}`}>
                            {open ? '营业中' : '休息中'}
                          </span>
                          <span className="min-w-0 break-words">
                            {open ? todayHoursText(shop, todayKey) : '今天不接单'}
                          </span>
                        </p>
                        <p className="m-0 mt-1 text-[13px] leading-[1.5] text-ink-3">
                          直线 {distanceText(distance)} · {shop.address}
                        </p>
                      </div>

                      {cardButton(shop, isCurrent)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="m-0 shrink-0 text-[14px] leading-[1.6] text-ink-3">
          距离是直线距离，仅供参考；实际能不能送，以店里接单为准。
        </p>
      </section>

      <div className="relative h-[420px] min-w-0 overflow-hidden rounded-[20px] bg-map shadow-perk lg:h-auto">
        <ShopMap
          shops={listed.map((row) => row.shop)}
          selectedId={selectedId}
          location={location}
          onSelect={setSelectedId}
        />

        {current ? (
          <div className="absolute inset-x-4 bottom-4 z-10 hidden flex-wrap items-center gap-3 rounded-[18px] bg-card px-4 py-3 shadow-[0_10px_30px_rgba(30,42,34,0.16)] sm:flex xl:gap-4 xl:px-5 xl:py-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-thumb-from to-thumb-to text-[22px] font-extrabold text-brand-700 xl:h-[60px] xl:w-[60px] xl:text-[24px]">
              {current.shop.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1 lg:min-w-[150px]">
              <p className="m-0 truncate text-[18px] font-extrabold text-ink xl:text-[20px]">
                {current.shop.name}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-2 xl:text-[15px]">
                <span className={`${TAG_BASE} ${current.shop.status === 'open' ? 'bg-brand-50 text-brand-700' : 'bg-segment text-ink-3'}`}>
                  {current.shop.status === 'open' ? '营业中' : '休息中'}
                </span>
                <span>直线 {distanceText(current.distance)}</span>
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {current.shop.phone ? (
                <a
                  href={`tel:${current.shop.phone}`}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-full border-[1.5px] border-brand-200 bg-card px-4 text-[16px] font-bold text-brand-700 transition-colors hover:bg-brand-50 xl:h-[52px] xl:px-5 xl:text-[18px]"
                >
                  <Icon name="phone" className="h-[22px] w-[22px]" />
                  打电话
                </a>
              ) : null}
              <button
                type="button"
                disabled={pending || current.shop.status !== 'open'}
                onClick={() => choose(current.shop)}
                className="flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-[16px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 xl:h-[52px] xl:px-6 xl:text-[18px]"
              >
                去买菜
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

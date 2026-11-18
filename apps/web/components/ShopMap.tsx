'use client';

import { useEffect, useRef, useState } from 'react';
import { loadAMap } from '@sds/ui/amap';
import type { AMapMap, AMapMarker, AMapNamespace } from '@sds/ui/amap';
import { shortShopName, type ShopItem, type ShopLocation } from '@/lib/shops';

type WebMap = AMapMap & {
  setFitView(overlays?: unknown[], immediately?: boolean, avoid?: number[], maxZoom?: number): void;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
};

type ClickableMarker = AMapMarker & { on(event: 'click', handler: () => void): void };

/** 没有定位也没有门店时的兜底中心：杭州文三路一带 */
const FALLBACK_CENTER: ShopLocation = { longitude: 120.1309, latitude: 30.2884 };
const DARK_MAP_STYLE = 'amap://styles/dark';
const NORMAL_MAP_STYLE = 'amap://styles/normal';

const PIN_CSS = `
.sds-pin{position:relative;display:flex;align-items:center;gap:6px;height:38px;padding:0 14px;border:0;border-radius:999px;background:rgb(var(--card));
  color:rgb(var(--brand-700));font:700 15px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;cursor:pointer;
  box-shadow:0 4px 12px rgba(30,42,34,.18);}
.sds-pin::after{content:"";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);border:7px solid transparent;border-top-color:rgb(var(--card));border-bottom:0;}
.sds-pin.is-sel{height:44px;padding:0 18px;background:rgb(var(--primary));color:rgb(var(--card));font-size:17px;}
.sds-pin.is-sel::after{border-top-color:rgb(var(--primary));}
.sds-pin.is-rest{color:rgb(var(--ink-3));}
.sds-pin:focus-visible{outline:3px solid rgb(var(--brand-500) / .5);outline-offset:2px;}
.sds-me{position:relative;width:18px;height:18px;border-radius:50%;background:rgb(var(--info));border:3px solid rgb(var(--card));box-shadow:0 0 0 8px rgb(var(--info) / .18);}
.sds-me-label{position:absolute;left:50%;top:26px;transform:translateX(-50%);font:700 13px/1 -apple-system,"PingFang SC",sans-serif;color:rgb(var(--info));white-space:nowrap;}
`;

export default function ShopMap({
  shops,
  selectedId,
  location,
  onSelect
}: {
  shops: ShopItem[];
  selectedId: string | null;
  location: ShopLocation | null;
  onSelect: (shopId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<WebMap | null>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const markersRef = useRef<unknown[]>([]);
  const pinElsRef = useRef(new Map<string, HTMLElement>());
  const zoomRef = useRef(14);
  const centeredOnceRef = useRef(false);
  const shopsRef = useRef(shops);
  const locationRef = useRef(location);
  const onSelectRef = useRef(onSelect);
  shopsRef.current = shops;
  locationRef.current = location;
  onSelectRef.current = onSelect;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  // 初始化：等脚本就绪后建图，卸载时销毁
  useEffect(() => {
    let cancelled = false;
    // 首页地图只画点和气泡，不逆地理也不搜地点，不随脚本拉 Geocoder / PlaceSearch
    loadAMap({ plugins: [] })
      .then((amap) => {
        if (cancelled || !containerRef.current) return;
        const first = shopsRef.current[0];
        const center =
          locationRef.current ??
          (first ? { longitude: first.longitude, latitude: first.latitude } : FALLBACK_CENTER);
        const map = new amap.Map(containerRef.current, {
          zoom: zoomRef.current,
          center: [center.longitude, center.latitude],
          viewMode: '2D',
          resizeEnable: true,
          // 深色模式下直接用高德暗色底图，避免亮色地图在夜间刺眼
          mapStyle: document.documentElement.classList.contains('dark') ? DARK_MAP_STYLE : NORMAL_MAP_STYLE
        }) as WebMap;
        amapRef.current = amap;
        mapRef.current = map;
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '地图加载失败');
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      amapRef.current = null;
      markersRef.current = [];
      pinElsRef.current.clear();
    };
  }, []);

  // 门店 / 定位变化：重建钉子并自动缩放到能看全
  useEffect(() => {
    const map = mapRef.current;
    const amap = amapRef.current;
    if (!ready || !map || !amap) return;

    if (markersRef.current.length) map.remove(markersRef.current);
    pinElsRef.current.clear();
    const created: unknown[] = [];

    for (const shop of shops) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `sds-pin${shop.id === selectedId ? ' is-sel' : ''}${
        shop.status === 'open' ? '' : ' is-rest'
      }`;
      pin.textContent =
        shop.status === 'open' ? shortShopName(shop.name) : `${shortShopName(shop.name)} · 休息`;
      pin.addEventListener('click', () => onSelectRef.current(shop.id));
      pinElsRef.current.set(shop.id, pin);

      const marker = new amap.Marker({
        position: [shop.longitude, shop.latitude],
        content: pin,
        anchor: 'bottom-center',
        zIndex: shop.id === selectedId ? 120 : 100
      }) as unknown as ClickableMarker;
      marker.on('click', () => onSelectRef.current(shop.id));
      map.add(marker);
      created.push(marker);
    }

    if (location) {
      const wrap = document.createElement('div');
      wrap.className = 'sds-me';
      const label = document.createElement('span');
      label.className = 'sds-me-label';
      label.textContent = '我在这';
      wrap.appendChild(label);
      const me = new amap.Marker({ position: [location.longitude, location.latitude], content: wrap });
      map.add(me);
      created.push(me);
    }

    markersRef.current = created;
    if (created.length) map.setFitView(created, false, [64, 64, 80, 64], 15);
    // 只在门店集合或定位变化时重排，选中态由下面的 effect 单独处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shops, location]);

  // 主题切换：跟着 <html class="dark"> 切高德底图样式
  useEffect(() => {
    const map = mapRef.current as (WebMap & { setMapStyle?: (style: string) => void }) | null;
    if (!ready || !map) return;
    function apply() {
      const dark = document.documentElement.classList.contains('dark');
      map?.setMapStyle?.(dark ? DARK_MAP_STYLE : NORMAL_MAP_STYLE);
    }
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [ready]);

  // 选中态：更新钉子样式，并把视野移到选中的店
  useEffect(() => {
    pinElsRef.current.forEach((pin, shopId) => {
      pin.classList.toggle('is-sel', shopId === selectedId);
    });
    const map = mapRef.current;
    const shop = shops.find((item) => item.id === selectedId);
    if (!ready || !map || !shop) return;
    // 首次进入交给 setFitView 展示全部门店，之后点选才移动视野
    if (!centeredOnceRef.current) {
      centeredOnceRef.current = true;
      return;
    }
    map.setZoomAndCenter(Math.max(zoomRef.current, 15), [shop.longitude, shop.latitude]);
  }, [ready, selectedId, shops]);

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    zoomRef.current = Math.min(18, Math.max(11, zoomRef.current + delta));
    map.setZoom(zoomRef.current);
  }

  function zoomToMe() {
    const map = mapRef.current;
    const target = locationRef.current;
    if (!map || !target) return;
    zoomRef.current = 15;
    map.setZoomAndCenter(15, [target.longitude, target.latitude]);
  }

  return (
    <div className="relative h-full w-full">
      <style>{PIN_CSS}</style>
      <div ref={containerRef} className="h-full w-full" aria-label="附近门店地图" />

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-map px-6 text-center">
          <p className="m-0 text-[17px] font-bold text-ink-2">地图暂时没打开</p>
          <p className="m-0 max-w-[360px] text-[15px] leading-[1.6] text-ink-3">
            {error}。门店列表照常可用，可以先从列表里选店。
          </p>
        </div>
      ) : null}

      {!error ? (
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
          <button
            type="button"
            aria-label="放大地图"
            onClick={() => zoomBy(1)}
            className="grid h-11 w-11 place-items-center rounded-xl bg-card text-[22px] font-bold text-ink-2 shadow-perk transition-colors hover:text-ink"
          >
            +
          </button>
          <button
            type="button"
            aria-label="缩小地图"
            onClick={() => zoomBy(-1)}
            className="grid h-11 w-11 place-items-center rounded-xl bg-card text-[22px] font-bold text-ink-2 shadow-perk transition-colors hover:text-ink"
          >
            −
          </button>
          {location ? (
            <button
              type="button"
              aria-label="回到我的位置"
              onClick={zoomToMe}
              className="grid h-11 w-11 place-items-center rounded-xl bg-card shadow-perk"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 text-info"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                <circle cx="12" cy="12" r="7" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

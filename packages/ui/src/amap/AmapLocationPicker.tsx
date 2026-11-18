'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatLngLat, isSameLngLat, normalizeLngLat } from './geo';
import { loadAMap } from './loader';
import { reverseGeocode } from './reverse-geocode';
import type { AMapMap, AMapMarker, LngLat, PickedLocation } from './types';

/** 未传坐标时的初始中心：天安门 */
const DEFAULT_CENTER: LngLat = { longitude: 120.3875850, latitude: 36.0747020 };
/** 已有坐标时的最小初始缩放：15 只看得到街区，16 能看清街道名 */
const DETAIL_ZOOM = 16;
const MAP_STYLES = {
  light: 'amap://styles/normal',
  dark: 'amap://styles/dark'
} as const;

/** 控制台把最终明暗写在 html[data-theme] 上；没有该属性（如 web 端）时按浅色处理 */
function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

type PickerStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface AmapLocationPickerProps {
  /** 受控坐标；外部改值会同步移动标记 */
  value?: LngLat | null;
  /** 点图 / 拖标记 / 搜索选中后回传坐标与地址 */
  onChange?: (location: PickedLocation) => void;
  height?: number;
  zoom?: number;
  disabled?: boolean;
  /** 地图底图主题；不传时跟随 html[data-theme]，深浅主题切换会实时更新 */
  theme?: 'light' | 'dark';
  /** 是否在选点后自动逆地理编码，默认 true */
  resolveAddress?: boolean;
  defaultCenter?: LngLat;
  className?: string;
  style?: CSSProperties;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8
};

const inputStyle = (dark: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  height: 32,
  padding: '0 11px',
  fontSize: 14,
  color: 'inherit',
  background: dark ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
  border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.22)' : '#d9d9d9'}`,
  borderRadius: 6,
  outline: 'none'
});

const buttonStyle = (dark: boolean): CSSProperties => ({
  height: 32,
  padding: '0 15px',
  fontSize: 14,
  color: 'inherit',
  background: dark ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
  border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.22)' : '#d9d9d9'}`,
  borderRadius: 6,
  cursor: 'pointer'
});

const overlayStyle = (dark: boolean): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  fontSize: 13,
  lineHeight: 1.7,
  textAlign: 'center',
  color: dark ? '#a6adb8' : '#8c8c8c',
  background: dark ? 'rgba(20, 22, 26, 0.88)' : 'rgba(255, 255, 255, 0.88)'
});

/**
 * 高德地图选点组件（受控）。
 * - 脚本通过 loadAMap 单例按需注入，组件本身也应由调用方 dynamic import，
 *   这样首屏包里既没有高德 JS，也不会在页面加载时就请求它；
 * - 只依赖 React，不依赖 antd，admin / web 可直接复用；
 * - 未配置 Key 时降级成提示，不影响调用方手动填写经纬度。
 */
export function AmapLocationPicker({
  value,
  onChange,
  height = 260,
  zoom = 15,
  disabled = false,
  theme,
  resolveAddress = true,
  defaultCenter = DEFAULT_CENTER,
  className,
  style
}: AmapLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markerRef = useRef<AMapMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const resolveAddressRef = useRef(resolveAddress);
  // 地图脚本异步加载，等就绪时可能已经换了店铺或清空了坐标，
  // 所以每次渲染都把最新值与布局参数同步到 ref，初始化时以 ref 为准。
  const valueRef = useRef(value);
  const layoutRef = useRef({ zoom, disabled, defaultCenter });

  const [status, setStatus] = useState<PickerStatus>('loading');
  const [message, setMessage] = useState('');
  const [address, setAddress] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  // 未显式指定 theme 时跟随 html[data-theme]；初值留给挂载后的 effect 同步，
  // 避免服务端渲染与客户端首帧不一致
  const [documentTheme, setDocumentTheme] = useState<'light' | 'dark'>('light');
  const effectiveTheme = theme ?? documentTheme;
  const dark = effectiveTheme === 'dark';
  const themeRef = useRef(effectiveTheme);

  useEffect(() => {
    if (theme) return;
    const root = document.documentElement;
    const sync = () => setDocumentTheme(readDocumentTheme());
    sync();
    // 主题在设置面板里切换时只改 html[data-theme]，用属性监听实时更新地图
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [theme]);

  onChangeRef.current = onChange;
  resolveAddressRef.current = resolveAddress;
  valueRef.current = value;
  layoutRef.current = { zoom, disabled, defaultCenter };
  themeRef.current = effectiveTheme;

  const pick = useCallback(async (longitude: number, latitude: number) => {
    const next = normalizeLngLat({ longitude, latitude });
    if (!next) return;

    markerRef.current?.show();
    markerRef.current?.setPosition([next.longitude, next.latitude]);
    mapRef.current?.setCenter([next.longitude, next.latitude]);

    let addressText: string | undefined;
    const amap = typeof window === 'undefined' ? undefined : window.AMap;
    if (resolveAddressRef.current && amap) {
      addressText = (await reverseGeocode(amap, next)) ?? undefined;
      if (addressText) setAddress(addressText);
    }

    onChangeRef.current?.({ ...next, address: addressText });
  }, []);

  /** 把地图与标记对齐到指定坐标；传 null 表示没有坐标：隐藏标记并回到默认视图 */
  const applyValue = useCallback((target: LngLat | null) => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    if (!target) {
      marker.hide();
      const fallback = normalizeLngLat(layoutRef.current.defaultCenter) ?? DEFAULT_CENTER;
      map.setZoom(layoutRef.current.zoom);
      map.setCenter([fallback.longitude, fallback.latitude]);
      return;
    }

    marker.show();
    marker.setPosition([target.longitude, target.latitude]);
    map.setCenter([target.longitude, target.latitude]);
  }, []);

  // 初始化地图：组件挂载时才拉脚本，卸载即销毁
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setStatus('loading');
    setMessage('');

    loadAMap()
      .then((amap) => {
        if (cancelled) return;
        // 以脚本就绪时的最新值定位，避免挂载时拿到的是空值
        const initial = normalizeLngLat(valueRef.current ?? null);
        const center = initial ?? normalizeLngLat(layoutRef.current.defaultCenter) ?? DEFAULT_CENTER;
        // 有坐标时按街道级缩放打开，没有坐标才用默认缩放
        const initialZoom = initial ? Math.max(layoutRef.current.zoom, DETAIL_ZOOM) : layoutRef.current.zoom;

        const map = new amap.Map(container, {
          zoom: initialZoom,
          center: [center.longitude, center.latitude],
          viewMode: '2D',
          resizeEnable: true,
          mapStyle: MAP_STYLES[themeRef.current]
        });
        const marker = new amap.Marker({
          position: [center.longitude, center.latitude],
          draggable: !layoutRef.current.disabled,
          cursor: 'move',
          title: '店铺位置'
        });
        // 没有坐标时标记只是占位，先隐藏，等外部给出坐标再显示
        if (!initial) marker.hide();
        map.add(marker);

        mapRef.current = map;
        markerRef.current = marker;

        map.on('click', (event) => {
          if (layoutRef.current.disabled) return;
          void pick(event.lnglat.getLng(), event.lnglat.getLat());
        });
        marker.on('dragend', () => {
          if (layoutRef.current.disabled) return;
          const position = marker.getPosition();
          void pick(position.getLng(), position.getLat());
        });

        setStatus('ready');
        // 脚本加载期间外部可能已经改过值，这里按最新值兜底对齐一次
        applyValue(normalizeLngLat(valueRef.current ?? null));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = (error as { code?: string }).code;
        const text = error instanceof Error ? error.message : '地图加载失败';
        setStatus(code === 'MISSING_KEY' ? 'unconfigured' : 'error');
        setMessage(text);
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 只在挂载时初始化，后续坐标/禁用态变化由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'ready') mapRef.current?.setMapStyle(MAP_STYLES[effectiveTheme]);
  }, [status, effectiveTheme]);

  // 外部改值（切换店铺、回填、清空坐标）时同步地图与标记；
  // 地图尚未就绪时跳过，初始化会读 valueRef 里最新的值
  useEffect(() => {
    const next = normalizeLngLat(value ?? null);
    const marker = markerRef.current;
    if (!marker) return;

    if (!next) {
      applyValue(null);
      setAddress('');
      return;
    }

    const current = marker.getPosition();
    if (current && isSameLngLat({ longitude: current.getLng(), latitude: current.getLat() }, next)) {
      return;
    }
    applyValue(next);
  }, [value?.longitude, value?.latitude, applyValue]);

  useEffect(() => {
    markerRef.current?.setDraggable(!disabled);
  }, [disabled]);

  const selected = normalizeLngLat(value ?? null);

  async function search() {
    const amap = typeof window === 'undefined' ? undefined : window.AMap;
    const term = keyword.trim();
    if (!amap || !term || disabled) return;

    setSearching(true);
    setMessage('');
    try {
      const placeSearch = new amap.PlaceSearch({ pageSize: 5 });
      const poi = await new Promise<{ longitude: number; latitude: number } | null>((resolve) => {
        placeSearch.search(term, (resultStatus, result) => {
          const location = result?.pois?.[0]?.location;
          if (resultStatus !== 'complete' || !location) {
            resolve(null);
            return;
          }
          resolve({ longitude: location.getLng(), latitude: location.getLat() });
        });
      });

      if (!poi) {
        setMessage('没有找到匹配的地点，换个关键词试试');
        return;
      }
      await pick(poi.longitude, poi.latitude);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ ...containerStyle, ...style }} className={className}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={keyword}
          disabled={status !== 'ready' || disabled}
          placeholder="搜索地点，回车定位"
          aria-label="搜索地点"
          style={inputStyle(dark)}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          disabled={status !== 'ready' || disabled || searching}
          style={{ ...buttonStyle(dark), cursor: searching ? 'progress' : 'pointer' }}
          onClick={() => void search()}
        >
          {searching ? '搜索中…' : '搜索'}
        </button>
      </div>

      <div
        style={{
          position: 'relative',
          border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.18)' : '#d9d9d9'}`,
          borderRadius: 8,
          overflow: 'hidden'
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height }} />
        {status !== 'ready' ? (
          <div style={overlayStyle(dark)}>
            {status === 'loading' ? '地图加载中…' : null}
            {status === 'unconfigured'
              ? '未配置高德地图 Key（SDS_PUBLIC_AMAP_KEY），暂时无法在地图上选点，可直接填写下方经纬度。'
              : null}
            {status === 'error' ? message || '地图加载失败' : null}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: dark ? '#a6adb8' : '#8c8c8c' }}>
        <span style={{ whiteSpace: 'nowrap' }}>
          {selected ? formatLngLat(selected) : '尚未选择位置'}
        </span>
        <span
          title={address}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {address || (selected ? '未获取到地址' : '点击地图或拖动标记选点')}
        </span>
      </div>

      {message && status === 'ready' ? (
        <div style={{ fontSize: 12, color: dark ? '#ff7875' : '#d4380d' }}>{message}</div>
      ) : null}
    </div>
  );
}

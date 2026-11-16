/** 经纬度。本包只透传数值，不关心坐标系来源（高德返回 GCJ-02） */
export interface LngLat {
  longitude: number;
  latitude: number;
}

/** 选点结果：坐标 + 逆地理编码得到的地址 */
export interface PickedLocation extends LngLat {
  address?: string;
}

/** 高德 JS API 2.0 的最小类型声明，只覆盖本包用到的能力，避免额外引入类型依赖 */
export interface AMapLngLat {
  getLng(): number;
  getLat(): number;
}

export interface AMapMapEvent {
  lnglat: AMapLngLat;
}

export interface AMapMap {
  setCenter(position: [number, number]): void;
  setZoom(level: number): void;
  add(overlay: unknown): void;
  remove(overlay: unknown): void;
  on(event: 'click', handler: (event: AMapMapEvent) => void): void;
  destroy(): void;
}

export interface AMapMarker {
  setPosition(position: [number, number]): void;
  getPosition(): AMapLngLat;
  setDraggable(draggable: boolean): void;
  show(): void;
  hide(): void;
  on(event: 'dragend', handler: () => void): void;
}

export interface AMapGeocodeResult {
  regeocode?: { formattedAddress?: string };
}

export interface AMapGeocoder {
  getAddress(
    position: [number, number],
    callback: (status: string, result: AMapGeocodeResult) => void
  ): void;
}

export interface AMapPoi {
  name?: string;
  address?: string;
  location?: AMapLngLat;
}

export interface AMapPlaceSearchResult {
  pois?: AMapPoi[];
}

export interface AMapPlaceSearch {
  search(
    keyword: string,
    callback: (status: string, result: AMapPlaceSearchResult) => void
  ): void;
}

export interface AMapNamespace {
  Map: new (container: HTMLDivElement, options?: Record<string, unknown>) => AMapMap;
  Marker: new (options?: Record<string, unknown>) => AMapMarker;
  Geocoder: new (options?: Record<string, unknown>) => AMapGeocoder;
  PlaceSearch: new (options?: Record<string, unknown>) => AMapPlaceSearch;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    /** 2021-12 之后高德要求的安全配置，必须在脚本加载前写入 */
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

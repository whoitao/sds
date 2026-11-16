import type { AMapNamespace, LngLat } from './types';

export interface ReverseGeocodeOptions {
  /** 超时按失败处理，返回 null，不阻塞选点 */
  timeoutMs?: number;
  /** 逆地理编码半径（米），默认 200 */
  radius?: number;
}

/**
 * 坐标 → 地址。失败/超时/插件缺失统一返回 null，调用方只把地址当「锦上添花」，
 * 不能因为地址拿不到就丢掉坐标。
 */
export async function reverseGeocode(
  amap: AMapNamespace,
  position: LngLat,
  options: ReverseGeocodeOptions = {}
): Promise<string | null> {
  const { timeoutMs = 8000, radius = 200 } = options;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      const geocoder = new amap.Geocoder({ radius, extensions: 'base' });
      geocoder.getAddress([position.longitude, position.latitude], (status, result) => {
        const address =
          status === 'complete' && result?.regeocode?.formattedAddress
            ? result.regeocode.formattedAddress
            : null;
        finish(address);
      });
    } catch {
      finish(null);
    }
  });
}

import type { LngLat } from './types';

export const LNG_MIN = -180;
export const LNG_MAX = 180;
export const LAT_MIN = -90;
export const LAT_MAX = 90;

/** shops 表经纬度为 numeric(10,7)，统一按 7 位小数落库 */
export const COORDINATE_DIGITS = 7;

export function roundCoordinate(value: number, digits = COORDINATE_DIGITS): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isValidLngLat(value: unknown): value is LngLat {
  if (!value || typeof value !== 'object') return false;
  const { longitude, latitude } = value as Partial<LngLat>;
  return (
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= LNG_MIN &&
    longitude <= LNG_MAX &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= LAT_MIN &&
    latitude <= LAT_MAX
  );
}

/** 越界或非数字返回 null，交给调用方决定是忽略还是提示 */
export function normalizeLngLat(
  value: Partial<LngLat> | null | undefined,
  digits = COORDINATE_DIGITS
): LngLat | null {
  if (!value) return null;
  const longitude = Number(value.longitude);
  const latitude = Number(value.latitude);
  if (!isValidLngLat({ longitude, latitude })) return null;
  return { longitude: roundCoordinate(longitude, digits), latitude: roundCoordinate(latitude, digits) };
}

/** 展示用：116.397428, 39.909230 */
export function formatLngLat(value: LngLat, digits = 6): string {
  return `${value.longitude.toFixed(digits)}, ${value.latitude.toFixed(digits)}`;
}

/** 表单回写后比对，避免同一次点选触发地图重复居中 */
export function isSameLngLat(
  a: Partial<LngLat> | null | undefined,
  b: Partial<LngLat> | null | undefined,
  tolerance = 1e-7
): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(Number(a.longitude) - Number(b.longitude)) <= tolerance &&
    Math.abs(Number(a.latitude) - Number(b.latitude)) <= tolerance
  );
}

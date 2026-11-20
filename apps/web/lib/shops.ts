import { formatMessage, type Locale } from '@/lib/i18n/config';
import { messagesOf } from '@/lib/i18n/messages';

/** 顾客端门店数据：字段与 /api/shops 返回保持一致 */
export type ShopItem = {
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
};

export type ShopLocation = { longitude: number; latitude: number };

const EARTH_RADIUS = 6371000;

/**
 * 浏览器定位是 WGS84，后台选点保存的是 GCJ-02（高德）。
 * 画点与算距离前统一转换，避免门店标记偏出几百米。
 */
export function gpsToMapLocation({ latitude, longitude }: ShopLocation): ShopLocation {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) {
    return { latitude, longitude };
  }
  const x = longitude - 105;
  const y = latitude - 35;
  const pi = Math.PI;
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  dLat += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dLat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3;
  dLat += ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dLng += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dLng += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3;
  dLng += ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rad = (latitude / 180) * pi;
  const magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2;
  const root = Math.sqrt(magic);
  dLat = (dLat * 180) / (((6378245 * (1 - 0.006693421622965943)) / (magic * root)) * pi);
  dLng = (dLng * 180) / ((6378245 / root) * Math.cos(rad) * pi);
  return { latitude: latitude + dLat, longitude: longitude + dLng };
}

/** 直线距离（米），按 10 米取整，和设计稿的「直线 xxx 米」一致 */
export function straightDistanceMeters(from: ShopLocation, to: ShopLocation) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(meters / 10) * 10;
}

/** 只写直线距离，不折算步行几分钟；单位按当前语言输出 */
export function distanceText(meters: number | null | undefined, locale: Locale) {
  const t = messagesOf(locale).shops;
  if (meters == null) return t.distanceUnknown;
  return meters < 1000
    ? formatMessage(t.distanceMeters, { value: meters })
    : formatMessage(t.distanceKilometers, { value: (meters / 1000).toFixed(1) });
}

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** 今日营业时间文案；没有排班时回落到「营业时间未知」，避免出现空白或 undefined */
export function todayHoursText(
  shop: Pick<ShopItem, 'businessHours'>,
  todayKey: string,
  locale: Locale
): string {
  const slot = shop.businessHours?.[todayKey];
  return slot ? `${slot.open}–${slot.close}` : messagesOf(locale).shops.hoursUnknown;
}

/** 地图钉子上的短名：去掉「（xx店）」这类后缀，避免钉子太长 */
export function shortShopName(name: string) {
  return name.replace(/[（(].*$/, '').trim() || name;
}

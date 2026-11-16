import type { ShopInfo, ShopLocation } from './api';

// GPS 使用 WGS84，后台高德选点保存 GCJ-02；查询距离与画点必须先统一坐标系。
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

export function shopDistanceLabel(distance: number | null | undefined) {
  if (distance == null) return '未获取距离';
  return distance < 1000 ? `直线距离 ${distance} 米` : `直线距离 ${(distance / 1000).toFixed(1)} 公里`;
}

export function shopHoursLabel(shop: ShopInfo, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
    .format(now).toLowerCase();
  const hours = shop.businessHours?.[day];
  return hours ? `今日 ${hours.open}–${hours.close}` : '今日营业时间请电话咨询';
}

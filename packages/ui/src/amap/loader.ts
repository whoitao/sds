import { readAMapEnv, type AMapEnvConfig } from './env';
import type { AMapNamespace } from './types';

const SCRIPT_ID = 'sds-amap-jsapi';
const SCRIPT_VERSION = '2.0';
/** 逆地理编码与关键字搜索都要用到，随脚本一起加载，避免后续再注入一次 */
const DEFAULT_PLUGINS = ['AMap.Geocoder', 'AMap.PlaceSearch'];

export type AMapLoadErrorCode = 'SSR' | 'MISSING_KEY' | 'SCRIPT_FAILED';

export class AMapLoadError extends Error {
  readonly code: AMapLoadErrorCode;

  constructor(code: AMapLoadErrorCode, message: string) {
    super(message);
    this.name = 'AMapLoadError';
    this.code = code;
  }
}

/** 单例：并发调用共享同一个 Promise，脚本只会注入一次 */
let pending: Promise<AMapNamespace> | null = null;

export interface LoadAMapOptions extends Omit<AMapEnvConfig, 'key'> {
  /** 不传则读环境变量 SDS_PUBLIC_AMAP_KEY */
  key?: string;
  plugins?: string[];
  version?: string;
}

export function loadAMap(options?: LoadAMapOptions): Promise<AMapNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new AMapLoadError('SSR', '高德地图只能在浏览器环境加载'));
  }
  if (window.AMap) return Promise.resolve(window.AMap);
  if (pending) return pending;

  const env = readAMapEnv();
  const key = options?.key ?? env.key;
  const securityCode = options?.securityCode ?? env.securityCode;
  const serviceHost = options?.serviceHost ?? env.serviceHost;
  if (!key) {
    return Promise.reject(
      new AMapLoadError('MISSING_KEY', '未配置高德地图 Key（SDS_PUBLIC_AMAP_KEY）')
    );
  }

  // 安全配置必须在脚本执行前写入，否则高德会拒绝请求
  if (serviceHost) window._AMapSecurityConfig = { serviceHost };
  else if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };

  const plugins = options?.plugins ?? DEFAULT_PLUGINS;
  const pluginQuery = plugins.length ? `&plugin=${plugins.join(',')}` : '';
  const version = options?.version ?? SCRIPT_VERSION;

  pending = new Promise<AMapNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=${version}&key=${encodeURIComponent(
      key
    )}${pluginQuery}`;
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new AMapLoadError('SCRIPT_FAILED', '高德地图脚本已加载但未找到 AMap 对象'));
    };
    script.onerror = () => reject(new AMapLoadError('SCRIPT_FAILED', '高德地图脚本加载失败'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // 失败后清空单例，允许用户补上 Key 后重试
    pending = null;
    throw error;
  });

  return pending;
}

/** 仅供测试/调试：清掉单例，不删除已注入的 script */
export function resetAMapLoader(): void {
  pending = null;
}

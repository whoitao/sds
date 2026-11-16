export interface AMapEnvConfig {
  key: string;
  securityCode?: string;
  /** 走代理服务器方案时的地址，与安全密钥二选一 */
  serviceHost?: string;
}

/**
 * 高德 Key 与安全密钥只能从环境变量读，不落仓库。
 * 统一使用 SDS_PUBLIC_ 前缀；Next 只自动内联 NEXT_PUBLIC_*，
 * 因此 apps/admin、apps/web 的 next.config 里用 `env` 显式映射这三个变量，
 * 浏览器侧才能读到（代价是值在构建期定死，改了要重启/重新构建）。
 */
export function readAMapEnv(): AMapEnvConfig {
  return {
    key: process.env.SDS_PUBLIC_AMAP_KEY ?? '',
    securityCode: process.env.SDS_PUBLIC_AMAP_SECURITY_CODE || undefined,
    serviceHost: process.env.SDS_PUBLIC_AMAP_SERVICE_HOST || undefined
  };
}

/** 未配置 Key 时组件降级为提示文案，不抛错、不影响手动填写经纬度 */
export function isAMapConfigured(): boolean {
  return readAMapEnv().key.length > 0;
}

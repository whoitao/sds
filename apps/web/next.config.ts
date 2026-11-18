import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 内共享包直接导出 TS 源码，需要 Next 转译
  transpilePackages: ['@sds/shared', '@sds/ui'],
  // 与 admin 保持一致：高德变量用 SDS_PUBLIC_ 前缀，显式映射到浏览器端 process.env。
  // 代价：值在构建时定死，改 .env 后需要重启或重新构建。
  env: {
    SDS_PUBLIC_AMAP_KEY: process.env.SDS_PUBLIC_AMAP_KEY ?? '',
    SDS_PUBLIC_AMAP_SECURITY_CODE: process.env.SDS_PUBLIC_AMAP_SECURITY_CODE ?? '',
    SDS_PUBLIC_AMAP_SERVICE_HOST: process.env.SDS_PUBLIC_AMAP_SERVICE_HOST ?? ''
  }
};

export default nextConfig;

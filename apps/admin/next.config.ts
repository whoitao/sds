import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sds/shared', '@sds/ui'],
  // 高德变量统一使用 SDS_PUBLIC_ 前缀。Next 只自动内联 NEXT_PUBLIC_*，
  // 这里显式映射到浏览器端 process.env，否则客户端读到的是 undefined。
  // 代价：值在构建（dev 下为编译）时定死，改 .env 后必须重启 dev server 或重新构建。
  env: {
    SDS_PUBLIC_AMAP_KEY: process.env.SDS_PUBLIC_AMAP_KEY ?? '',
    SDS_PUBLIC_AMAP_SECURITY_CODE: process.env.SDS_PUBLIC_AMAP_SECURITY_CODE ?? '',
    SDS_PUBLIC_AMAP_SERVICE_HOST: process.env.SDS_PUBLIC_AMAP_SERVICE_HOST ?? ''
  }
};

export default nextConfig;

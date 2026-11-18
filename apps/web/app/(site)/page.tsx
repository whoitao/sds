import type { Metadata } from 'next';
import ShopFinder from '@/components/ShopFinder';
import { apiRequest } from '@/lib/api';
import { getSelectedShop } from '@/lib/shop';
import type { ShopItem } from '@/lib/shops';

export const metadata: Metadata = {
  title: '附近的店 · 捎点啥'
};

/** 营业时间按门店所在时区取「今天」，在服务端定好，避免客户端水合时跨天不一致 */
function todayKey() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
    .format(new Date())
    .toLowerCase();
}

export default async function HomePage() {
  const [response, selected] = await Promise.all([
    // 门店列表是公开只读数据：进 Next Data Cache，后台改店通过 revalidateTag('shops') 立即失效
    apiRequest<{ items: ShopItem[] }>('/api/shops', {
      next: { revalidate: 60, tags: ['shops'] }
    }),
    getSelectedShop()
  ]);
  const shops = response.ok ? response.data?.items ?? [] : [];

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 pt-5 lg:min-h-0 lg:flex-1">
      {/* 只有首页会注入高德脚本：提前建连，省一次 DNS + TLS */}
      <link rel="preconnect" href="https://webapi.amap.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://webapi.amap.com" />
      {!response.ok ? (
        <p className="m-0 rounded-xl bg-danger-soft px-4 py-3 text-[16px] text-danger">
          {response.message ?? '门店加载失败，请稍后刷新重试'}
        </p>
      ) : null}
      <ShopFinder shops={shops} selectedId={selected?.id ?? null} todayKey={todayKey()} />
    </div>
  );
}
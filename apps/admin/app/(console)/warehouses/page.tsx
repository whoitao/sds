'use client';

// 仓库管理：第一个 Tab 是仓库列表与成员维护，第二个 Tab 是原「仓库库存」的明细与预警。
// 当前 Tab 写在 ?tab= 里，刷新、分享链接后都停在同一 Tab。
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from 'antd';
import { WarehouseListPanel } from './WarehouseListPanel';
import { WarehouseStocksPanel } from './WarehouseStocksPanel';

type WarehouseTab = 'warehouses' | 'stocks';

export default function WarehousesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: WarehouseTab = searchParams.get('tab') === 'stocks' ? 'stocks' : 'warehouses';

  const changeTab = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const header = (
    <Tabs
      activeKey={tab}
      onChange={changeTab}
      tabBarStyle={{ margin: 0 }}
      items={[
        { key: 'warehouses', label: '仓库管理' },
        { key: 'stocks', label: '仓库库存' }
      ]}
    />
  );

  return tab === 'stocks' ? (
    <WarehouseStocksPanel header={header} />
  ) : (
    <WarehouseListPanel header={header} />
  );
}

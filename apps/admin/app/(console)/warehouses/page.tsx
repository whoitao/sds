'use client';

// 仓库管理：三个 Tab 依次是仓库列表与成员维护、仓库库存明细与预警、分拨管理。
// 当前 Tab 写在 ?tab= 里，刷新、分享链接、前进后退后都停在同一 Tab；无参数或非法值默认落到「仓库库存」。
// 只有 warehouse.read 的账号看三个 Tab；只有 warehouse.transfer_read 的账号（店长）只看分拨 Tab。
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from 'antd';
import { WarehouseListPanel } from './WarehouseListPanel';
import { WarehouseStocksPanel } from './WarehouseStocksPanel';
import { WarehouseTransfersPanel } from './WarehouseTransfersPanel';

type WarehouseTab = 'warehouses' | 'stocks' | 'transfers';

const TAB_ITEMS: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'warehouses', label: '仓库管理' },
  { key: 'stocks', label: '仓库库存' },
  { key: 'transfers', label: '分拨管理' }
];

export default function WarehousesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [permissions, setPermissions] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/me/permissions', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        setPermissions(response.ok ? ((payload.permissions ?? []) as string[]) : []);
      })
      .catch(() => {
        if (!cancelled) setPermissions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canWarehouse = permissions?.includes('warehouse.read') ?? false;
  const canTransfers = canWarehouse || (permissions?.includes('warehouse.transfer_read') ?? false);

  const tabParam = searchParams.get('tab');
  const tab: WarehouseTab = canWarehouse
    ? tabParam === 'warehouses' || tabParam === 'transfers'
      ? tabParam
      : 'stocks'
    : 'transfers';

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
      items={canWarehouse ? TAB_ITEMS : TAB_ITEMS.filter((item) => item.key === 'transfers')}
    />
  );

  if (permissions === null) {
    return <div style={{ padding: 24, color: '#8c8c8c' }}>加载中…</div>;
  }
  if (!canTransfers) {
    return <div style={{ padding: 24, color: '#8c8c8c' }}>当前账号没有仓库相关权限。</div>;
  }

  // 各 Tab 是独立组件，切换即卸载，页签专属筛选与页码随组件状态一起清空。
  if (tab === 'transfers') return <WarehouseTransfersPanel header={header} />;
  if (tab === 'stocks') return <WarehouseStocksPanel header={header} />;
  return <WarehouseListPanel header={header} />;
}

import { redirect } from 'next/navigation';

// 「仓库库存」已并入仓库管理的第二个 Tab；旧地址保留重定向，书签与历史链接不失效。
export default function WarehouseStocksLegacyPage() {
  redirect('/warehouses?tab=stocks');
}

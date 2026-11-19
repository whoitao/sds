import { redirect } from 'next/navigation';

// 「分拨管理」已并入仓库管理的第三个 Tab；旧地址保留重定向，书签与历史链接不失效。
export default function WarehouseTransfersLegacyPage() {
  redirect('/warehouses?tab=transfers');
}

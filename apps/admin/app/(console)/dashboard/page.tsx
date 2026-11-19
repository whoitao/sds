import { getAdminAccess } from '../../../lib/session';
import { DashboardPanel } from './DashboardPanel';

// 服务端先拿权限，门店筛选默认文案首帧即正确（全部门店 / 全部绑定门店）
export default async function DashboardPage() {
  const access = await getAdminAccess();
  return <DashboardPanel initialIsSuperAdmin={access.isSuperAdmin} />;
}

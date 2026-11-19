import { getAdminAccess } from '../../../lib/session';
import { DamageReportsPanel } from './DamageReportsPanel';

// 首帧就带上服务端读到权限，仓库报损页签不会先出现再消失
export default async function DamageReportsPage() {
  const access = await getAdminAccess();
  return (
    <DamageReportsPanel
      initialPermissions={access.permissions}
      initialIsSuperAdmin={access.isSuperAdmin}
    />
  );
}

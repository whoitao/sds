import { eq } from 'drizzle-orm';
import { adminUserShops, getDb } from '@sds/db';
import { loadAdminAccess } from './admin-access.js';

export async function isSuperAdmin(adminId: string) {
  const { roles } = await loadAdminAccess(adminId);
  return roles.some((role) => role.code === 'super_admin');
}

/**
 * 管理员可访问门店：
 * - super_admin 返回 null（不限制）；
 * - 其他管理员只返回 admin_user_shops 中已绑定的门店；
 * - 未绑定任何门店时返回空数组，表示不具备门店范围（不再兼容为全部门店可见）。
 */
export async function accessibleShopIds(adminId: string): Promise<string[] | null> {
  if (await isSuperAdmin(adminId)) return null;
  const db = await getDb();
  const rows = await db
    .select({ shopId: adminUserShops.shopId })
    .from(adminUserShops)
    .where(eq(adminUserShops.adminUserId, adminId));
  return rows.map((row) => row.shopId);
}

export async function canAccessShop(adminId: string, shopId: string) {
  const ids = await accessibleShopIds(adminId);
  return ids === null || ids.includes(shopId);
}

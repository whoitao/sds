import '../lib/load-env';
import { adminUsers, closeDb, getDb } from '@sds/db';
import { hashPassword } from '../lib/password';

/**
 * 创建 / 重置平台管理员账号：
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='至少8位' pnpm --filter @sds/api admin:create
 * 不做默认账号，避免把弱口令带进环境。
 */
async function main() {
  const username = (process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? '平台管理员';
  const role = process.env.ADMIN_ROLE ?? 'platform_admin';

  if (username.length < 3) throw new Error('ADMIN_USERNAME 至少 3 个字符');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD 至少 8 个字符');

  const db = await getDb();
  const passwordHash = await hashPassword(password);

  const [admin] = await db
    .insert(adminUsers)
    .values({ username, passwordHash, displayName, role })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash, displayName, role, status: 1, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }
    })
    .returning({ id: adminUsers.id, username: adminUsers.username, role: adminUsers.role });

  console.log('[sds-api] 管理员已就绪:', admin);
  await closeDb();
}

main().catch(async (error) => {
  console.error('[sds-api] 创建管理员失败:', error instanceof Error ? error.message : error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});

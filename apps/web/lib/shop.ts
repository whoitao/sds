import 'server-only';
import { cookies } from 'next/headers';

/** 顾客当前选中的门店：存在 cookie 里，顶栏与「附近的店」页共用 */
export const SHOP_COOKIE = 'sds_shop';

export type SelectedShop = { id: string; name: string };

export async function getSelectedShop(): Promise<SelectedShop | null> {
  const raw = (await cookies()).get(SHOP_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SelectedShop>;
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // cookie 被改坏时当作未选店，不阻塞页面
  }
  return null;
}

/**
 * 通知顾客端清掉门店列表缓存（Next Data Cache 的 'shops' 标签）。
 * 两个应用分开部署，这里只做一次 best-effort 调用：
 * 没配 WEB_REVALIDATE_URL / REVALIDATE_SECRET 或请求失败时忽略，顾客端最多等 60s 的 revalidate。
 */
export async function revalidateWebShopCache() {
  const base = process.env.WEB_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) return;

  try {
    await fetch(`${base.replace(/\/+$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': secret
      },
      body: JSON.stringify({ tag: 'shops' }),
      cache: 'no-store'
    });
  } catch {
    /* 忽略：缓存到期后自然更新 */
  }
}

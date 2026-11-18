import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/** 允许后台触发的缓存标签，避免这个端点被用来乱刷缓存 */
const ALLOWED_TAGS = new Set(['shops', 'regions']);

/**
 * 后台改店后调用：让顾客端的门店/区划缓存立即失效。
 * 通过 REVALIDATE_SECRET 与后台共享密钥；未配置密钥时一律拒绝，只依赖各自的 revalidate 周期。
 */
export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { tag?: unknown } | null;
  const tag = typeof payload?.tag === 'string' ? payload.tag : '';
  if (!ALLOWED_TAGS.has(tag)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ ok: true, tag });
}

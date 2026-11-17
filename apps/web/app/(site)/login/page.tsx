import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import { getCurrentCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '登录 / 注册 · 捎点啥'
};

/** 只接受站内相对路径，避免登录后被带到站外 */
function safeNext(value: string | string[] | undefined): string | null {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string | string[]; next?: string | string[] }>;
}) {
  const params = await searchParams;
  const mode = params.mode === 'register' ? 'register' : 'login';
  const next = safeNext(params.next);

  // 已登录再访问登录页：直接回到目标页（没有目标则去收货地址）
  const customer = await getCurrentCustomer();
  if (customer) redirect(next ?? '/addresses');

  return <AuthForm key={mode} mode={mode} next={next ?? undefined} />;
}

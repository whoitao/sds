import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AccountLayout from '@/components/AccountLayout';
import AddressBook from '@/components/AddressBook';
import { apiRequest, type AddressItem } from '@/lib/api';
import { getMessages } from '@/lib/i18n/server';
import { getRegionTree } from '@/lib/regions';
import { getSessionToken, requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '收货地址 · 捎点啥'
};

export default async function AddressesPage() {
  // 未登录会带着 next 参数跳到登录页
  await requireCustomer('/addresses');

  const [token, regionTree] = await Promise.all([getSessionToken(), getRegionTree()]);
  const response = await apiRequest<{ items: AddressItem[] }>('/api/addresses', { token });

  // 会话在服务端被吊销：同样回登录页
  if (response.status === 401) redirect('/login?next=%2Faddresses');

  const items = response.ok ? response.data?.items ?? [] : [];
  const m = await getMessages();

  return (
    <AccountLayout>
      <div className="flex w-full flex-col gap-5">
        {!response.ok ? (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-[16px] text-danger">
            {response.message ?? m.address.loadFailed}
          </p>
        ) : null}
        <AddressBook items={items} regionTree={regionTree} />
      </div>
    </AccountLayout>
  );
}

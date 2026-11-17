import type { Metadata } from 'next';
import AccountLayout from '@/components/AccountLayout';
import ProfileSettings from '@/components/ProfileSettings';
import { requireCustomer } from '@/lib/session';

export const metadata: Metadata = {
  title: '个人信息 · 捎点啥'
};

export default async function ProfilePage() {
  const customer = await requireCustomer('/profile');

  return (
    <AccountLayout>
      <div className="flex w-full min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <ProfileSettings
          nickname={customer.nickname ?? ''}
          phone={customer.phone}
          avatarUrl={customer.avatarUrl}
        />
      </div>
    </AccountLayout>
  );
}

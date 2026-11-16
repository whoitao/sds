'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const logout = async () => {
    setLoading(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <Button size="large" onClick={logout} loading={loading}>
      退出登录
    </Button>
  );
}

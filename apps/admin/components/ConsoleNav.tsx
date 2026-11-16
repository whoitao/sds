'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'antd';

const ITEMS = [
  { key: '/', label: <Link href="/">概览</Link> },
  { key: '/dashboard', label: <Link href="/dashboard">控制面板</Link> }
];

/** 后台顶部导航，选中态跟随当前路径 */
export function ConsoleNav() {
  const pathname = usePathname();
  const selected = pathname.startsWith('/dashboard') ? '/dashboard' : '/';

  return (
    <Menu
      mode="horizontal"
      selectedKeys={[selected]}
      items={ITEMS}
      style={{
        flex: 1,
        minWidth: 0,
        borderBottom: 'none',
        background: 'transparent',
        fontSize: 16
      }}
    />
  );
}

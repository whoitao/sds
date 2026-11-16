'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  CheckOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  RightOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SunOutlined,
  UnorderedListOutlined,
  UserOutlined
} from '@ant-design/icons';
import { PAGE_SIZE_OPTIONS, useAdminSettings, type ThemePreference } from './AdminSettingsProvider';
import { adminColors as palette } from '../lib/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'system', label: '跟随系统', icon: <SettingOutlined /> }
];

type Flyout = 'none' | 'root' | 'theme' | 'pageSize';

const MAIN_ITEMS = [
  { href: '/dashboard', label: '控制面板', icon: <DashboardOutlined /> },
  { href: '/shops', label: '店铺管理', icon: <ShopOutlined /> },
  { href: '/users', label: '用户管理', icon: <UserOutlined /> },
  { href: '/products', label: '商品管理', icon: <AppstoreOutlined /> },
  { href: '/catalog', label: '总部商品库', icon: <DatabaseOutlined /> },
  { href: '/carts', label: '购物车管理', icon: <ShoppingOutlined /> },
  { href: '/orders', label: '订单管理', icon: <ShoppingCartOutlined /> },
  { href: '/inventory', label: '库存管理', icon: <InboxOutlined /> },
  { href: '/purchases', label: '采购管理', icon: <ShoppingOutlined /> },
  { href: '/reports', label: '报表统计', icon: <BarChartOutlined /> }
];

const SECONDARY_ITEMS = [{ href: '/about', label: '关于', icon: <InfoCircleOutlined /> }];

export function AdminSidebar({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, pageSize, setTheme, setPageSize } = useAdminSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flyout, setFlyout] = useState<Flyout>('none');
  const accountRef = useRef<HTMLDivElement>(null);

  const itemStyle = (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: 38,
    margin: '2px 12px',
    padding: collapsed ? 0 : '0 14px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: 8,
    background: active ? palette.accentLight : 'transparent',
    color: active ? palette.accentStrong : palette.text,
    fontWeight: active ? 600 : 400,
    fontSize: 14,
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden'
  });

  const popupItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    height: 38,
    padding: '0 14px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    fontSize: 14,
    color: palette.text,
    textDecoration: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const
  };

  useEffect(() => {
    if (!menuOpen) return;

    function handleClick(event: MouseEvent) {
      if (!accountRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setFlyout('none');
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    setFlyout('none');
  }

  const optionRowStyle = (active: boolean) => ({
    ...popupItemStyle,
    background: active ? palette.accentLight : 'transparent',
    color: active ? palette.accentStrong : palette.text,
    fontWeight: active ? 600 : 400
  });

  const flyoutCardStyle: React.CSSProperties = {
    padding: 6,
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    boxShadow: '0 6px 20px rgba(15, 20, 30, 0.16)'
  };

  // 浮层紧贴父级右缘（不留缝），鼠标可以直接滑入，也不会出现跨缝导致的外层 mouseleave
  const flyoutWrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: '100%',
    zIndex: 20
  };

  async function handleLogout() {
    closeMenu();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside
      style={{
        width: collapsed ? 72 : 264,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        background: palette.surface,
        borderRight: `1px solid ${palette.border}`,
        transition: 'width 0.2s ease'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: collapsed ? '0 12px' : '0 20px',
          height: 48,
          borderBottom: `1px solid ${palette.border}`,
          justifyContent: collapsed ? 'center' : 'space-between'
        }}
      >
        {!collapsed ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: palette.primary,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1,
                flex: 'none'
              }}
            >
              S
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: palette.text, whiteSpace: 'nowrap' }}>
              捎点啥
            </span>
          </span>
        ) : null}
        <button
          type="button"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={() => setCollapsed((value) => !value)}
          style={{
            border: 'none',
            background: 'transparent',
            color: palette.textSecondary,
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 4
          }}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '6px 0 8px' }}>
        {MAIN_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            style={itemStyle(pathname.startsWith(item.href))}
          >
            <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>{item.icon}</span>
            {!collapsed ? <span>{item.label}</span> : null}
          </Link>
        ))}
      </nav>

      <div ref={accountRef} style={{ position: 'relative' }}>
        {menuOpen ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: collapsed ? 'auto' : 12,
              width: collapsed ? 200 : undefined,
              bottom: 'calc(100% + 8px)',
              padding: 6,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              boxShadow: '0 6px 20px rgba(31, 35, 41, 0.10)',
              zIndex: 10
            }}
            onMouseLeave={() => setFlyout('none')}
          >
            {/* 外观：二级浮层里放主题、分页 */}
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={flyout === 'root'}
              onMouseEnter={() => setFlyout('root')}
              onClick={() => setFlyout('root')}
              style={optionRowStyle(flyout === 'root')}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>
                <BgColorsOutlined />
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>外观</span>
              <RightOutlined style={{ fontSize: 11, color: palette.textTertiary }} />
            </button>

            {SECONDARY_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                style={popupItemStyle}
              >
                <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              style={{ ...popupItemStyle, color: palette.danger }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>
                <LogoutOutlined />
              </span>
              <span>退出登录</span>
            </button>

            {flyout !== 'none' ? (
              <div style={{ ...flyoutWrapStyle, top: 0 }}>
              <div style={{ ...flyoutCardStyle, minWidth: 148 }}>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={flyout === 'theme'}
                    onMouseEnter={() => setFlyout('theme')}
                    onClick={() => setFlyout('theme')}
                    style={optionRowStyle(flyout === 'theme')}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>
                      <SunOutlined />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>主题</span>
                    <RightOutlined style={{ fontSize: 11, color: palette.textTertiary }} />
                  </button>

                  {flyout === 'theme' ? (
                    <div style={{ ...flyoutWrapStyle, top: -6, marginLeft: 6 }}>
                      <div style={{ ...flyoutCardStyle, minWidth: 140 }}>
                        {THEME_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setTheme(option.value);
                              closeMenu();
                            }}
                            style={optionRowStyle(theme === option.value)}
                          >
                            <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>{option.icon}</span>
                            <span style={{ flex: 1, textAlign: 'left' }}>{option.label}</span>
                            {theme === option.value ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ position: 'relative' }} onMouseEnter={() => setFlyout('pageSize')}>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={flyout === 'pageSize'}
                    onClick={() => setFlyout('pageSize')}
                    style={optionRowStyle(flyout === 'pageSize')}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1, flex: 'none' }}>
                      <UnorderedListOutlined />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>分页</span>
                    <RightOutlined style={{ fontSize: 11, color: palette.textTertiary }} />
                  </button>

                  {flyout === 'pageSize' ? (
                    <div style={{ ...flyoutWrapStyle, top: 32, marginLeft: 6 }}>
                      <div style={{ ...flyoutCardStyle, minWidth: 140 }}>
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              setPageSize(size);
                              closeMenu();
                            }}
                            style={optionRowStyle(pageSize === size)}
                          >
                            <span style={{ flex: 1, textAlign: 'left' }}>{`每页 ${size} 条`}</span>
                            {pageSize === size ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label="账号菜单"
          onClick={() => setMenuOpen((value) => !value)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 10,
            width: '100%',
            padding: collapsed ? '10px 0' : '10px 14px',
            border: 'none',
            borderTop: `1px solid ${palette.border}`,
            background: menuOpen ? palette.accentLight : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit'
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: palette.primary,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 600,
              flex: 'none'
            }}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          {!collapsed ? (
            <span
              style={{
                fontSize: 14,
                color: palette.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {displayName}
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
}

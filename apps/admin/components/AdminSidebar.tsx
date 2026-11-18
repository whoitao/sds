'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  CheckOutlined,
  ContactsOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileExclamationOutlined,
  FontSizeOutlined,
  GoldOutlined,
  HomeOutlined,
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
  SwapOutlined,
  UnorderedListOutlined,
  UserOutlined,
  ContainerOutlined
} from '@ant-design/icons';
import { PAGE_SIZE_OPTIONS, useAdminSettings, type ThemePreference } from './AdminSettingsProvider';
import { adminColors as palette } from '../lib/theme';
import type { DisplayDensity } from '../lib/display';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'system', label: '跟随系统', icon: <SettingOutlined /> }
];

const DISPLAY_OPTIONS: { value: DisplayDensity; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' }
];

type Flyout = 'none' | 'root' | 'theme' | 'pageSize' | 'display';

const MAIN_ITEMS = [
  { href: '/dashboard', label: '控制面板', icon: <DashboardOutlined /> },
  { href: '/shops', label: '店铺管理', icon: <ShopOutlined /> },
  { href: '/users', label: '用户管理', icon: <UserOutlined /> },
  { href: '/products', label: '商品管理', icon: <AppstoreOutlined /> },
  { href: '/catalog', label: '总部商品库', icon: <DatabaseOutlined /> },
  { href: '/carts', label: '购物车管理', icon: <ShoppingOutlined /> },
  { href: '/orders', label: '订单管理', icon: <ShoppingCartOutlined /> },
  { href: '/inventory', label: '库存管理', icon: <InboxOutlined /> },
  { href: '/damage-reports', label: '报损管理', icon: <FileExclamationOutlined /> },
  { href: '/purchases', label: '采购管理', icon: <ShoppingOutlined /> },
  { href: '/warehouse-transfers', label: '分拨管理', icon: <SwapOutlined /> },
  { href: '/requisitions', label: '门店要货', icon: <UnorderedListOutlined /> },
  { href: '/demand-plans', label: '需求汇总', icon: <ContainerOutlined /> },
  { href: '/suppliers', label: '供应商档案', icon: <ContactsOutlined /> },
  { href: '/warehouses', label: '仓库管理', icon: <HomeOutlined /> },
  { href: '/warehouse-stocks', label: '仓库库存', icon: <GoldOutlined /> },
  { href: '/reports', label: '报表统计', icon: <BarChartOutlined /> }
];

const SECONDARY_ITEMS = [{ href: '/about', label: '关于', icon: <InfoCircleOutlined /> }];

const flyoutCardStyle: React.CSSProperties = {
  padding: 4,
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: 10,
  boxShadow: '0 6px 16px rgba(15, 20, 30, 0.08), 0 9px 28px 8px rgba(15, 20, 30, 0.05)'
};

/**
 * 子菜单浮层：默认紧贴上级右缘（不留缝，鼠标可以直接滑入），
 * 当浮层靠近窗口底部时整体上移，保证卡片完整可见；
 * 打开时以及窗口尺寸、滚动变化后都会重新测量。
 */
function FlyoutPanel({
  top = 0,
  marginLeft = 0,
  minWidth = 140,
  children
}: {
  top?: number;
  marginLeft?: number;
  minWidth?: number;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const card = cardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      // 扣除已应用的位移，得到未上移时卡片的原始位置
      const baseTop = rect.top - offsetRef.current;
      const baseBottom = rect.bottom - offsetRef.current;
      const edge = 8;
      let next = 0;
      if (baseBottom > window.innerHeight - edge) {
        next = window.innerHeight - edge - baseBottom;
      }
      // 上移后仍不越过窗口顶部
      if (baseTop + next < edge) next = edge - baseTop;
      offsetRef.current = next;
      setOffset(next);
    };

    const schedule = () => {
      // 等父级浮层的位移先落定，再测量自身位置
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, []);

  return (
    <div style={{ position: 'absolute', left: '100%', top, marginLeft, zIndex: 20 }}>
      <div
        ref={cardRef}
        style={{ ...flyoutCardStyle, minWidth, transform: `translateY(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function AdminSidebar({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, pageSize, displayDensity, setTheme, setPageSize, setDisplayDensity } =
    useAdminSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flyout, setFlyout] = useState<Flyout>('none');
  const accountRef = useRef<HTMLDivElement>(null);
  const flyoutTimer = useRef<number | null>(null);

  // 菜单项的字号、行高与间距由「展示效果」的 CSS 变量统一控制，标准档等于原视觉
  const itemStyle = (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--admin-nav-item-gap)',
    height: 'var(--admin-nav-item-height)',
    margin: '2px 12px',
    padding: collapsed
      ? 0
      : '0 var(--admin-nav-item-padding) 0 calc(var(--admin-nav-item-padding) + 4px)',
    justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: 8,
    background: active ? palette.accentLight : 'transparent',
    color: active ? palette.accentStrong : palette.text,
    fontWeight: active ? 600 : 400,
    fontSize: 'var(--admin-display-font-size)',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden'
  });

  const popupItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 36,
    padding: '0 10px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    fontSize: 14,
    color: palette.text,
    textDecoration: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap'
  };

  const itemIconStyle = (color: string): React.CSSProperties => ({
    fontSize: 14,
    lineHeight: 1,
    flex: 'none',
    color
  });

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
    cancelFlyoutClose();
    setMenuOpen(false);
    setFlyout('none');
  }

  /** 离开账号菜单后延迟收起浮层，避免斜向移入子菜单时跨过缝隙导致闪烁 */
  function scheduleFlyoutClose() {
    cancelFlyoutClose();
    flyoutTimer.current = window.setTimeout(() => {
      flyoutTimer.current = null;
      setFlyout('none');
    }, 160);
  }

  function cancelFlyoutClose() {
    if (flyoutTimer.current !== null) {
      window.clearTimeout(flyoutTimer.current);
      flyoutTimer.current = null;
    }
  }

  /**
   * 悬停展开统一交给菜单卡片上冒泡的 mouseover 判定：
   * 指针落在带 data-flyout 的条目（含其内部图标、文字）上就切到对应浮层。
   * 比逐条绑 mouseenter 稳，条目重渲染时也不会漏掉进入事件。
   */
  function handleMenuMouseOver(event: React.MouseEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-flyout]');
    const value = row?.dataset.flyout;
    if (value === 'root' || value === 'theme' || value === 'pageSize' || value === 'display') {
      setFlyout(value);
    }
  }

  const optionRowStyle = (active: boolean): React.CSSProperties => ({
    ...popupItemStyle,
    // 非选中项不写内联背景色，交给 .admin-account-menu-item:hover
    ...(active
      ? { background: palette.accentLight, color: palette.accentStrong, fontWeight: 500 }
      : {})
  });

  async function handleLogout() {
    closeMenu();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside
      style={{
        width: collapsed ? 72 : 256,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        // 侧边栏整体抬到页面内容之上，子菜单浮层伸出侧边栏时不会被表格等遮挡
        zIndex: 30,
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
          padding: collapsed ? '0 12px' : '0 calc(var(--admin-nav-item-padding) + 16px)',
          height: 'var(--admin-brand-bar-height)',
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
                borderRadius: 7,
                background: palette.primary,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 800,
                lineHeight: 1,
                flex: 'none'
              }}
            >
              捎
            </span>
            <span
              style={{
                fontSize: 'var(--admin-brand-font-size)',
                fontWeight: 800,
                color: palette.primaryStrong,
                whiteSpace: 'nowrap'
              }}
            >
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

      <div
        ref={accountRef}
        style={{
          position: 'relative',
          height: 53,
          boxSizing: 'border-box',
          padding: '6px 12px',
          borderTop: `1px solid ${palette.border}`,
          background: palette.surface
        }}
        onMouseEnter={cancelFlyoutClose}
        onMouseLeave={scheduleFlyoutClose}
      >
        {menuOpen ? (
          <div
            className="admin-account-menu"
            onMouseOver={handleMenuMouseOver}
            style={{
              position: 'absolute',
              left: 12,
              right: collapsed ? 'auto' : 12,
              width: collapsed ? 200 : undefined,
              bottom: 'calc(100% + 8px)',
              zIndex: 10
            }}
          >
            {/* 透明连接带：盖住卡片与账号行之间的 8px 空隙，
                鼠标在两者之间移动时不会离开账号区域，浮层不会被收起 */}
            <div aria-hidden style={{ position: 'absolute', top: '100%', left: 0, right: 0, height: 8 }} />

            {/* 外观：二级浮层里放主题、分页、展示效果 */}
            <button
              type="button"
              className="admin-account-menu-item"
              aria-haspopup="menu"
              aria-expanded={flyout !== 'none'}
              data-flyout="root"
              onFocus={() => setFlyout('root')}
              onClick={() => setFlyout('root')}
              style={optionRowStyle(flyout === 'root')}
            >
              <span style={itemIconStyle(flyout === 'root' ? palette.accentStrong : palette.textSecondary)}>
                <BgColorsOutlined />
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>外观</span>
              <RightOutlined style={{ fontSize: 10, color: palette.textTertiary }} />
            </button>

            <div style={{ height: 1, margin: '4px 6px', background: palette.border }} />

            {SECONDARY_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="admin-account-menu-item"
                style={popupItemStyle}
              >
                <span style={itemIconStyle(palette.textSecondary)}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}

            <div style={{ height: 1, margin: '4px 6px', background: palette.border }} />

            <button
              type="button"
              onClick={handleLogout}
              className="admin-account-menu-item admin-account-menu-danger"
              style={{ ...popupItemStyle, color: palette.danger }}
            >
              <span style={itemIconStyle(palette.danger)}>
                <LogoutOutlined />
              </span>
              <span>退出登录</span>
            </button>

            {flyout !== 'none' ? (
              <FlyoutPanel minWidth={148}>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="admin-account-menu-item"
                    aria-haspopup="menu"
                    aria-expanded={flyout === 'theme'}
                    data-flyout="theme"
                    onFocus={() => setFlyout('theme')}
                    onClick={() => setFlyout('theme')}
                    style={optionRowStyle(flyout === 'theme')}
                  >
                    <span style={itemIconStyle(flyout === 'theme' ? palette.accentStrong : palette.textSecondary)}>
                      <SunOutlined />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>主题</span>
                    <RightOutlined style={{ fontSize: 10, color: palette.textTertiary }} />
                  </button>

                  {flyout === 'theme' ? (
                    <FlyoutPanel top={-6} marginLeft={6}>
                      {THEME_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="admin-account-menu-item"
                          onClick={() => {
                            setTheme(option.value);
                            closeMenu();
                          }}
                          style={optionRowStyle(theme === option.value)}
                        >
                          <span style={itemIconStyle(theme === option.value ? palette.accentStrong : palette.textSecondary)}>
                            {option.icon}
                          </span>
                          <span style={{ flex: 1, textAlign: 'left' }}>{option.label}</span>
                          {theme === option.value ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
                        </button>
                      ))}
                    </FlyoutPanel>
                  ) : null}
                </div>

                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="admin-account-menu-item"
                    aria-haspopup="menu"
                    aria-expanded={flyout === 'pageSize'}
                    data-flyout="pageSize"
                    onFocus={() => setFlyout('pageSize')}
                    onClick={() => setFlyout('pageSize')}
                    style={optionRowStyle(flyout === 'pageSize')}
                  >
                    <span style={itemIconStyle(flyout === 'pageSize' ? palette.accentStrong : palette.textSecondary)}>
                      <UnorderedListOutlined />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>分页</span>
                    <RightOutlined style={{ fontSize: 10, color: palette.textTertiary }} />
                  </button>

                  {flyout === 'pageSize' ? (
                    <FlyoutPanel top={32} marginLeft={6}>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className="admin-account-menu-item"
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
                    </FlyoutPanel>
                  ) : null}
                </div>

                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="admin-account-menu-item"
                    aria-haspopup="menu"
                    aria-expanded={flyout === 'display'}
                    data-flyout="display"
                    onFocus={() => setFlyout('display')}
                    onClick={() => setFlyout('display')}
                    style={optionRowStyle(flyout === 'display')}
                  >
                    <span style={itemIconStyle(flyout === 'display' ? palette.accentStrong : palette.textSecondary)}>
                      <FontSizeOutlined />
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>展示效果</span>
                    <RightOutlined style={{ fontSize: 10, color: palette.textTertiary }} />
                  </button>

                  {flyout === 'display' ? (
                    <FlyoutPanel top={-6} marginLeft={6}>
                      {DISPLAY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="admin-account-menu-item"
                          onClick={() => {
                            setDisplayDensity(option.value);
                            closeMenu();
                          }}
                          style={optionRowStyle(displayDensity === option.value)}
                        >
                          <span style={{ flex: 1, textAlign: 'left' }}>{option.label}</span>
                          {displayDensity === option.value ? (
                            <CheckOutlined style={{ fontSize: 12 }} />
                          ) : null}
                        </button>
                      ))}
                    </FlyoutPanel>
                  ) : null}
                </div>
              </FlyoutPanel>
            ) : null}
          </div>
        ) : null}

        <div
          className="admin-account-trigger"
          style={{
            display: 'flex',
            alignItems: 'center',
            borderRadius: 8,
            ...(menuOpen ? { background: palette.subtle } : {})
          }}
        >
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label="账号菜单"
            onClick={() => setMenuOpen((value) => !value)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10,
              padding: collapsed ? '6px 0' : '6px 12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit'
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: palette.primary,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
                flex: 'none'
              }}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            {!collapsed ? (
              <span
                style={{
                  fontSize: 'var(--admin-display-font-size)',
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
          {/* 齿轮：直接展开账号菜单里的「外观」子菜单（主题 / 分页 / 展示效果） */}
          {!collapsed ? (
            <button
              type="button"
              aria-label="外观设置"
              title="外观设置"
              onClick={() => {
                setMenuOpen(true);
                setFlyout('root');
              }}
              className="admin-account-settings"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                marginRight: 4,
                padding: 0,
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                fontSize: 13,
                lineHeight: 1,
                cursor: 'pointer',
                flex: 'none'
              }}
            >
              <SettingOutlined />
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

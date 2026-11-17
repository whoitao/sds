'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logoutAction } from '@/lib/auth-actions';

type UserMenuProps = {
  /** 已处理好的展示名（优先姓名，其次打码手机号） */
  name: string;
  phone: string | null;
  /** 进行中订单数 / 地址数；接口取不到时为 null，不展示数字 */
  ongoingOrders: number | null;
  addressCount: number | null;
};

function maskPhone(phone: string) {
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

/** 头像里的姓氏字 */
function initial(name: string) {
  return Array.from(name.trim())[0] ?? '我';
}

function Icon({ name, className = 'h-[22px] w-[22px]' }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (name) {
    case 'chevron':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.8" />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case 'list':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...common}>
          <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
          <path d="M10 8l-4 4 4 4M6 12h9" />
        </svg>
      );
    default:
      return null;
  }
}

export default function UserMenu({ name, phone, ongoingOrders, addressCount }: UserMenuProps) {
  const pathname = usePathname();
  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/');
  const profileActive = pathname === '/profile' || pathname.startsWith('/profile/');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);

  // 路由变化（含返回/前进、菜单项跳转）后不保留展开状态
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // 键盘打开时把焦点送进菜单，鼠标点击则不抢焦点
  useEffect(() => {
    if (!open || !focusFirstRef.current) return;
    focusFirstRef.current = false;
    panelRef.current?.querySelector<HTMLElement>('[data-menu-action]')?.focus();
  }, [open]);

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-action]') ?? []
    );
    if (items.length === 0) return;
    event.preventDefault();
    if (event.key === 'Home') {
      items[0].focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1].focus();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="customer-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (open) {
            panelRef.current?.querySelector<HTMLElement>('[data-menu-action]')?.focus();
            return;
          }
          focusFirstRef.current = true;
          setOpen(true);
        }}
        className={`flex h-[54px] items-center gap-2.5 rounded-full border-[1.5px] pl-2 pr-2 sm:pr-4 text-[18px] font-bold text-brand-700 transition-all ${
          open
            ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-500/15'
            : 'border-brand-200 bg-brand-50 hover:border-brand-300 hover:bg-brand-100'
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-[17px] font-bold text-white">
          {initial(name)}
        </span>
        <span className="hidden max-w-[120px] truncate sm:inline">{name}</span>
        <Icon
          name="chevron"
          className={`hidden h-5 w-5 shrink-0 transition-transform sm:block ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id="customer-menu"
          onKeyDown={handlePanelKeyDown}
          className="absolute right-0 top-[calc(100%+12px)] z-50 w-[296px] overflow-hidden rounded-[18px] bg-card shadow-auth"
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600 text-[21px] font-bold text-white">
              {initial(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[20px] font-bold text-ink">{name}</p>
              {phone ? <p className="mt-1 text-[15px] text-ink-3">手机 {maskPhone(phone)}</p> : null}
            </div>
          </div>

          <div className="h-px bg-line" />

          <div className="flex flex-col gap-0.5 p-2">
            <Link
              href="/profile"
              data-menu-action
              onClick={() => setOpen(false)}
              aria-current={profileActive ? 'page' : undefined}
              className={`flex h-[52px] items-center gap-3 rounded-xl px-3 text-[17px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
                profileActive
                  ? 'bg-brand-50 font-bold text-brand-700'
                  : 'text-ink hover:bg-brand-50/70 focus-visible:bg-brand-50/70'
              }`}
            >
              <Icon
                name="user"
                className={`h-[22px] w-[22px] shrink-0 ${profileActive ? 'text-brand-700' : 'text-ink-2'}`}
              />
              个人信息
            </Link>

            <Link
              href="/orders"
              data-menu-action
              onClick={() => setOpen(false)}
              className="flex h-[52px] items-center gap-3 rounded-xl px-3 text-[17px] text-ink transition-colors hover:bg-brand-50/70 focus-visible:bg-brand-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
            >
              <Icon name="list" className="h-[22px] w-[22px] shrink-0 text-ink-2" />
              我的订单
              {ongoingOrders !== null && ongoingOrders > 0 ? (
                <span className="ml-auto text-[15px] text-ink-3">进行中 {ongoingOrders}</span>
              ) : null}
            </Link>

            <Link
              href="/addresses"
              data-menu-action
              onClick={() => setOpen(false)}
              className="flex h-[52px] items-center gap-3 rounded-xl px-3 text-[17px] text-ink transition-colors hover:bg-brand-50/70 focus-visible:bg-brand-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
            >
              <Icon name="pin" className="h-[22px] w-[22px] shrink-0 text-ink-2" />
              收货地址
              {addressCount !== null ? (
                <span className="ml-auto text-[15px] text-ink-3">{addressCount} 个</span>
              ) : null}
            </Link>

            <Link
              href="/settings"
              data-menu-action
              onClick={() => setOpen(false)}
              aria-current={settingsActive ? 'page' : undefined}
              className={`flex h-[52px] items-center gap-3 rounded-xl px-3 text-[17px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
                settingsActive
                  ? 'bg-brand-50 font-bold text-brand-700'
                  : 'text-ink hover:bg-brand-50/70 focus-visible:bg-brand-50/70'
              }`}
            >
              <Icon
                name="gear"
                className={`h-[22px] w-[22px] shrink-0 ${settingsActive ? 'text-brand-700' : 'text-ink-2'}`}
              />
              设置
            </Link>
          </div>

          <div className="h-px bg-line" />

          <div className="p-2">
            <form action={logoutAction}>
              <button
                type="submit"
                data-menu-action
                className="flex h-[52px] w-full items-center gap-3 rounded-xl px-3 text-[17px] text-danger transition-colors hover:bg-danger-soft/70 focus-visible:bg-danger-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger/30"
              >
                <Icon name="logout" className="h-[22px] w-[22px] shrink-0" />
                退出登录
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

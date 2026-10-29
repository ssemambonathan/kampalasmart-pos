'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  CloudOff,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import type { AppNotification, Paginated, Permission } from '@kampalasmart/shared';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/offline/sync';
import { api, errorMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { cn } from './ui';
import { useToast } from './toast';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  permission?: Permission;
  badge?: 'pending' | 'conflicts';
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Sell',
    items: [{ href: '/pos', label: 'Point of sale', icon: <ShoppingCart className="h-4 w-4" />, permission: 'sales:create' }],
  },
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, permission: 'reports:read' },
      { href: '/sales', label: 'Sales', icon: <ReceiptText className="h-4 w-4" />, permission: 'sales:read:own' },
      { href: '/refunds', label: 'Refunds', icon: <RotateCcw className="h-4 w-4" />, permission: 'refunds:read' },
    ],
  },
  {
    title: 'Stock & buying',
    items: [
      { href: '/inventory', label: 'Inventory', icon: <Boxes className="h-4 w-4" />, permission: 'inventory:read' },
      { href: '/purchases', label: 'Purchases', icon: <ClipboardList className="h-4 w-4" />, permission: 'purchases:read' },
      { href: '/transfers', label: 'Transfers', icon: <ArrowLeftRight className="h-4 w-4" />, permission: 'inventory:transfer' },
      { href: '/products', label: 'Products', icon: <Package className="h-4 w-4" />, permission: 'products:read' },
      { href: '/suppliers', label: 'Suppliers', icon: <Truck className="h-4 w-4" />, permission: 'suppliers:read' },
      { href: '/customers', label: 'Customers', icon: <Users className="h-4 w-4" />, permission: 'customers:read' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { href: '/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, permission: 'reports:read' },
      { href: '/assistant', label: 'Business assistant', icon: <Sparkles className="h-4 w-4" />, permission: 'assistant:use' },
      { href: '/audit', label: 'Audit trail', icon: <ShieldCheck className="h-4 w-4" />, permission: 'audit:read' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { href: '/sync', label: 'Offline sync', icon: <RefreshCw className="h-4 w-4" />, permission: 'sync:read', badge: 'conflicts' },
      { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, permission: 'settings:read' },
    ],
  },
];

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="KampalaSmart home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-base font-black text-white shadow-sm">
        K<span className="text-accent-300">.</span>
      </span>
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-tight text-ink-950">KampalaSmart</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600">
            Retail OS
          </span>
        </span>
      ) : null}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, business, locations, activeLocationId, activeLocation, setActiveLocationId, can, logout, offlineSession } = useAuth();
  const { online, syncing, pendingCount, conflictCount, lastSyncAt, syncNow, error: syncError } = useSync();
  const { toast } = useToast();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled: can('notifications:read'),
    refetchInterval: 60_000,
  });

  const notifications = useQuery({
    queryKey: ['notifications', 'preview'],
    queryFn: () => api.get<Paginated<AppNotification>>('/notifications', { page: 1, pageSize: 6 }),
    enabled: can('notifications:read') && notificationsOpen,
  });

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenu(false);
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pendingCount || !online) return;
    const timer = window.setTimeout(() => {
      toast(`${pendingCount} offline sale${pendingCount === 1 ? '' : 's'} waiting to sync.`, 'info');
    }, 1500);
    return () => window.clearTimeout(timer);
    // Only announce once per mount, not on every count change.
  }, []);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all');
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (markError) {
      toast(errorMessage(markError), 'error');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleOpenNotification = async (notification: AppNotification) => {
    if (!notification.readAt) {
      try {
        await api.post(`/notifications/${notification.id}/read`);
        await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        // Opening the notification still succeeds even if the read receipt fails.
      }
    }
  };

  const onSync = async () => {
    try {
      await syncNow();
      toast('Sync check complete.', 'success');
    } catch (syncFailure) {
      toast(errorMessage(syncFailure), 'error');
    }
  };

  const syncLabel = !online
    ? 'Offline'
    : syncing
      ? 'Syncing'
      : pendingCount > 0
        ? `${pendingCount} pending`
        : 'Synced';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-4">
        <Brand />
        <button type="button" className="btn-ghost p-1.5 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mx-3 mb-2 rounded-lg border border-ink-200 bg-ink-50/80 px-3 py-2">
        <p className="truncate text-xs font-semibold text-ink-800">{business?.name}</p>
        <p className="text-[11px] text-ink-500">
          {business?.plan?.toLowerCase()} plan · {business?.currency}
        </p>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
        {visibleGroups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn('nav-link', isActive(item.href) && 'nav-link-active')}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.badge === 'conflicts' && conflictCount > 0 ? (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                      {conflictCount}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-ink-200 p-3">
        <button
          type="button"
          onClick={onSync}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-ink-600 hover:bg-ink-100"
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              !online ? 'bg-accent-500' : syncing ? 'bg-sky-500 animate-pulse' : pendingCount ? 'bg-accent-500' : 'bg-brand-500',
            )}
          />
          <span className="flex-1">{syncLabel}</span>
          <span className="text-[10px] text-ink-400">{lastSyncAt ? relativeTime(lastSyncAt) : 'never'}</span>
        </button>
        {syncError ? <p className="mt-1 px-2 text-[10px] leading-snug text-red-600">{syncError}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-ink-200 bg-white lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-white shadow-pop">{sidebar}</aside>
        </div>
      ) : null}

      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
        {!online ? (
          <div className="flex items-center justify-center gap-2 bg-accent-100 px-4 py-1.5 text-xs font-medium text-accent-900">
            <CloudOff className="h-3.5 w-3.5" /> Offline mode — sales are saved on this device and sync automatically.
            {offlineSession ? ' You are using this device’s last verified sign-in.' : ''}
          </div>
        ) : pendingCount > 0 ? (
          <div className="flex items-center justify-center gap-2 bg-accent-50 px-4 py-1.5 text-xs font-medium text-accent-800">
            <RefreshCw className="h-3.5 w-3.5" /> {pendingCount} sale{pendingCount === 1 ? '' : 's'} waiting to sync.
            <button type="button" className="font-semibold underline" onClick={onSync}>
              Sync now
            </button>
          </div>
        ) : null}
        <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
          <button type="button" className="btn-ghost p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Brand compact />
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Store className="h-4 w-4 text-ink-400" />
            {locations.length > 1 ? (
              <select
                className="select !w-auto !border-transparent !bg-transparent !py-1.5 !pl-1 pr-8 text-sm font-medium hover:!border-ink-200"
                value={activeLocationId}
                onChange={(event) => setActiveLocationId(event.target.value)}
                aria-label="Active branch"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm font-medium text-ink-800">{activeLocation?.name ?? '—'}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSync}
              className={cn(
                'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:flex',
                !online
                  ? 'border-accent-200 bg-accent-50 text-accent-800'
                  : pendingCount
                    ? 'border-accent-200 bg-accent-50 text-accent-800'
                    : 'border-brand-200 bg-brand-50 text-brand-700',
              )}
              title="Offline sync status"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', !online ? 'bg-accent-500' : 'bg-brand-500', syncing && 'animate-pulse')} />
              {syncLabel}
            </button>

            {can('notifications:read') ? (
              <div className="relative" ref={notificationsRef}>
                <button
                  type="button"
                  className="btn-ghost relative p-2"
                  onClick={() => setNotificationsOpen((open) => !open)}
                  aria-label={`Notifications${unread.data?.count ? ` (${unread.data.count} unread)` : ''}`}
                  aria-expanded={notificationsOpen}
                >
                  <Bell className="h-[18px] w-[18px]" />
                  {unread.data?.count ? (
                    <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {unread.data.count > 99 ? '99+' : unread.data.count}
                    </span>
                  ) : null}
                </button>
                {notificationsOpen ? (
                  <div className="absolute right-0 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                    <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
                      <p className="text-sm font-semibold text-ink-900">Notifications</p>
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-700 disabled:opacity-50"
                        onClick={markAll}
                        disabled={markingAll || !unread.data?.count}
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.isLoading ? (
                        <div className="space-y-3 p-4">
                          <div className="skeleton h-4 w-3/4" />
                          <div className="skeleton h-4 w-1/2" />
                        </div>
                      ) : notifications.data?.data.length ? (
                        notifications.data.data.map((notification) => (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => void handleOpenNotification(notification)}
                            className={cn(
                              'block w-full border-b border-ink-100 px-4 py-3 text-left hover:bg-ink-50',
                              !notification.readAt && 'bg-brand-50/40',
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {!notification.readAt ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" /> : null}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                                <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{notification.body}</p>
                                <p className="mt-1 text-[10px] text-ink-400">{relativeTime(notification.createdAt)}</p>
                              </div>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="px-4 py-8 text-center text-sm text-ink-500">You&apos;re all caught up.</p>
                      )}
                    </div>
                    <Link href="/notifications" className="block border-t border-ink-100 px-4 py-2.5 text-center text-xs font-semibold text-brand-700 hover:bg-ink-50">
                      View all notifications
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ink-100"
                onClick={() => setUserMenu((open) => !open)}
                aria-expanded={userMenu}
                aria-label="Account menu"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white">
                  {user?.name
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-[130px] truncate text-xs font-semibold text-ink-900">{user?.name}</span>
                  <span className="block text-[10px] capitalize text-ink-500">{user?.role.toLowerCase().replace('_', ' ')}</span>
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 sm:block" />
              </button>
              {userMenu ? (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-pop">
                  <div className="border-b border-ink-100 px-4 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink-900">{user?.name}</p>
                    <p className="truncate text-xs text-ink-500">{user?.email}</p>
                  </div>
                  <Link href="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <ShieldCheck className="h-4 w-4 text-ink-400" /> Account & security
                  </Link>
                  {can('settings:read') ? (
                    <Link href="/settings" className="flex items-center gap-2 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                      <Building2 className="h-4 w-4 text-ink-400" /> Business settings
                    </Link>
                  ) : null}
                  <Link href="/sync" className="flex items-center gap-2 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <Activity className="h-4 w-4 text-ink-400" /> Sync & devices
                  </Link>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="flex w-full items-center gap-2 border-t border-ink-100 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-5 pb-24 sm:px-6 lg:pb-8" id="main-content">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden" aria-label="Quick navigation">
        <div className="grid grid-cols-4">
          {[
            { href: '/pos', label: 'Sell', icon: <CreditCard className="h-5 w-5" />, show: can('sales:create') },
            { href: '/dashboard', label: 'Home', icon: <LayoutDashboard className="h-5 w-5" />, show: can('reports:read') },
            { href: '/sales', label: 'Sales', icon: <ReceiptText className="h-5 w-5" />, show: can('sales:read:own') },
          ]
            .filter((item) => item.show)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
                  isActive(item.href) ? 'text-brand-700' : 'text-ink-500',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-ink-500"
          >
            <Menu className="h-5 w-5" /> More
          </button>
        </div>
      </nav>
    </div>
  );
}

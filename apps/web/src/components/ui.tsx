'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import clsx from 'clsx';

export function cn(...values: Array<string | false | null | undefined>): string {
  return clsx(values);
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden />;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950 sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  trend,
  icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  trend?: number | null;
  icon?: React.ReactNode;
  tone?: 'default' | 'brand' | 'amber' | 'red';
}) {
  const toneClass =
    tone === 'brand'
      ? 'bg-brand-50 text-brand-700'
      : tone === 'amber'
        ? 'bg-accent-50 text-accent-700'
        : tone === 'red'
          ? 'bg-red-50 text-red-600'
          : 'bg-ink-100 text-ink-600';
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
          <div className="mt-2 truncate font-mono text-2xl font-semibold tracking-tight text-ink-950">{value}</div>
          {detail ? <div className="mt-1 text-xs text-ink-500">{detail}</div> : null}
        </div>
        {icon ? <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', toneClass)}>{icon}</div> : null}
      </div>
      {trend !== undefined ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          {trend === null ? (
            <span className="text-ink-400">No prior period</span>
          ) : (
            <span className={trend >= 0 ? 'font-semibold text-brand-600' : 'font-semibold text-red-600'}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          <span className="text-ink-400">vs previous period</span>
        </div>
      ) : null}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'badge-green',
  SYNCED: 'badge-green',
  APPROVED: 'badge-blue',
  PENDING: 'badge-amber',
  SYNCING: 'badge-blue',
  PARTIALLY_RECEIVED: 'badge-blue',
  PARTIALLY_REFUNDED: 'badge-amber',
  RECEIVED: 'badge-green',
  ORDERED: 'badge-blue',
  REFUNDED: 'badge-slate',
  CANCELLED: 'badge-slate',
  REJECTED: 'badge-red',
  FAILED: 'badge-red',
  CONFLICT: 'badge-red',
  OPEN: 'badge-red',
  RESOLVED: 'badge-green',
  OUT_OF_STOCK: 'badge-red',
  CRITICAL: 'badge-red',
  LOW: 'badge-amber',
  OK: 'badge-green',
  OVERSTOCK: 'badge-blue',
  SLOW_MOVING: 'badge-slate',
  ACTIVE: 'badge-green',
  SUSPENDED: 'badge-red',
  INACTIVE: 'badge-slate',
  TRIAL: 'badge-blue',
  PAST_DUE: 'badge-amber',
  INFO: 'badge-blue',
  WARNING: 'badge-amber',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <span className={STATUS_STYLES[status] ?? 'badge-slate'}>{text}</span>;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-10' : 'py-16')}>
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-ink-100 text-ink-400">
        {icon ?? <AlertTriangle className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="max-w-md text-sm text-ink-600">{message}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: cols }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="skeleton h-6 flex-1"
              style={{ maxWidth: colIndex === 0 ? '24%' : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {children}
      {error ? <p className="error-text">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        type="search"
        className="input pl-9"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]), select, textarea, button',
      );
      focusable?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  const maxWidth =
    size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : size === 'xl' ? 'max-w-4xl' : 'max-w-lg';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-2xl',
          maxWidth,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink-950">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
          </div>
          <button type="button" className="btn-ghost -mr-1 p-1.5" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-600">{message}</div>
    </Modal>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-3 border-t border-ink-100 px-4 py-3 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Showing <span className="font-semibold text-ink-700">{from.toLocaleString()}</span>–
        <span className="font-semibold text-ink-700">{to.toLocaleString()}</span> of{' '}
        <span className="font-semibold text-ink-700">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <span className="px-2 font-medium text-ink-600">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="scroll-thin -mb-px flex gap-1 overflow-x-auto border-b border-ink-200" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            active === tab.id
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-600">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-ink-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    </label>
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 py-2 text-sm last:border-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-right font-medium text-ink-900">{children}</span>
    </div>
  );
}

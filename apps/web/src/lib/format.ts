import { CURRENCY_DECIMALS } from '@kampalasmart/shared';

export function formatMoney(
  value: string | number | null | undefined,
  currency = 'UGX',
  options: { compact?: boolean; sign?: boolean } = {},
): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? '—');
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const formatter = new Intl.NumberFormat(currency === 'UGX' ? 'en-UG' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: options.compact ? 0 : decimals,
    maximumFractionDigits: options.compact ? 0 : decimals,
    notation: options.compact ? 'compact' : 'standard',
  });
  const formatted = formatter.format(amount);
  return options.sign && amount > 0 ? `+${formatted}` : formatted;
}

export function formatNumber(value: string | number | null | undefined, decimals = 0): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? '—');
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatQuantity(value: string | number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? '—');
  return Number.isInteger(amount) ? formatNumber(amount) : formatNumber(amount, 3).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPercent(value: string | number | null | undefined, decimals = 1): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toFixed(decimals)}%`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

export function todayInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function daysAgoInput(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

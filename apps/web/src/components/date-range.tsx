'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { todayInput } from '@/lib/format';
import { cn } from './ui';

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'month' | 'lastMonth' | 'custom';

export interface DateRangeValue {
  from: string;
  to: string;
}

export const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom range' },
];

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function daysBefore(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localInput(date);
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>): DateRangeValue {
  const today = todayInput();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: daysBefore(6), to: today };
    case '90d':
      return { from: daysBefore(89), to: today };
    case 'month': {
      const now = new Date();
      return { from: localInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    }
    case 'lastMonth': {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: localInput(first), to: localInput(last) };
    }
    case '30d':
    default:
      return { from: daysBefore(29), to: today };
  }
}

/** ISO bounds that include the whole local day, for list endpoints that compare timestamps directly. */
export function listBounds(range: DateRangeValue): DateRangeValue {
  return {
    from: range.from ? `${range.from}T00:00:00.000Z` : '',
    to: range.to ? `${range.to}T23:59:59.999Z` : '',
  };
}

export function useDateRange(initial: RangePreset = '30d') {
  const [preset, setPresetState] = useState<RangePreset>(initial);
  const [range, setRangeState] = useState<DateRangeValue>(() =>
    presetRange(initial === 'custom' ? '30d' : initial),
  );

  const setPreset = (next: RangePreset) => {
    setPresetState(next);
    if (next !== 'custom') setRangeState(presetRange(next));
  };

  const setRange = (next: DateRangeValue) => {
    setPresetState('custom');
    setRangeState(next);
  };

  return { preset, range, setPreset, setRange, query: range, bounds: listBounds(range) };
}

export function DateRangeFilter({
  preset,
  range,
  onPreset,
  onRange,
  className,
  compact,
}: {
  preset: RangePreset;
  range: DateRangeValue;
  onPreset: (preset: RangePreset) => void;
  onRange: (range: DateRangeValue) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <select
          className={cn('select !w-auto pl-8 text-xs font-medium', compact ? '!py-1.5' : '')}
          value={preset}
          onChange={(event) => onPreset(event.target.value as RangePreset)}
          aria-label="Date range"
        >
          {RANGE_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {preset === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className={cn('input !w-auto text-xs', compact ? '!py-1.5' : '')}
            value={range.from}
            max={range.to || undefined}
            onChange={(event) => onRange({ ...range, from: event.target.value })}
            aria-label="Start date"
          />
          <span className="text-xs text-ink-400">to</span>
          <input
            type="date"
            className={cn('input !w-auto text-xs', compact ? '!py-1.5' : '')}
            value={range.to}
            min={range.from || undefined}
            onChange={(event) => onRange({ ...range, to: event.target.value })}
            aria-label="End date"
          />
        </div>
      ) : null}
    </div>
  );
}

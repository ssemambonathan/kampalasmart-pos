import { ApiException } from './errors/api-exception';

/**
 * KampalaSmart currently targets East African retail businesses. These fixed
 * offsets keep report day boundaries stable without a timezone database; all
 * supported zones have no daylight saving.
 */
const OFFSET_MINUTES: Record<string, number> = {
  'Africa/Kampala': 180,
  'Africa/Nairobi': 180,
  'Africa/Dar_es_Salaam': 180,
  'Africa/Kigali': 120,
  'Africa/Lagos': 60,
  'Africa/Johannesburg': 120,
  UTC: 0,
};

/** Time zones with a fixed offset, supported by report day boundaries. */
export const SUPPORTED_TIMEZONES = Object.keys(OFFSET_MINUTES);

export function isSupportedTimezone(timezone: string): boolean {
  return Object.prototype.hasOwnProperty.call(OFFSET_MINUTES, timezone);
}

export function timezoneOffsetMinutes(timezone = 'Africa/Kampala'): number {
  return OFFSET_MINUTES[timezone] ?? 180;
}

export function startOfBusinessDay(date: Date, timezone = 'Africa/Kampala'): Date {
  const offset = timezoneOffsetMinutes(timezone);
  const shifted = new Date(date.getTime() + offset * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offset * 60_000);
}

export function endOfBusinessDay(date: Date, timezone = 'Africa/Kampala'): Date {
  const start = startOfBusinessDay(date, timezone);
  return new Date(start.getTime() + 86_400_000 - 1);
}

export function businessDayBounds(now = new Date(), timezone = 'Africa/Kampala') {
  const start = startOfBusinessDay(now, timezone);
  const end = new Date(start.getTime() + 86_400_000 - 1);
  return { start, end };
}

export interface DateRange {
  from: Date;
  to: Date;
  days: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string, end: boolean, timezone: string): Date {
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const local = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(local.getTime()) ||
      local.getUTCFullYear() !== year ||
      local.getUTCMonth() !== month - 1 ||
      local.getUTCDate() !== day
    ) {
      throw ApiException.badRequest(`Invalid date: ${value}`, 'INVALID_DATE');
    }
    local.setUTCMinutes(local.getUTCMinutes() - timezoneOffsetMinutes(timezone));
    return end ? new Date(local.getTime() + 86_400_000 - 1) : local;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiException.badRequest(`Invalid date: ${value}`, 'INVALID_DATE');
  }
  return parsed;
}

/** Parses an inclusive report range; date-only values use business time. */
export function parseDateRange(
  from: string | undefined,
  to: string | undefined,
  options: { timezone?: string; defaultDays?: number } = {},
): DateRange {
  const timezone = options.timezone ?? 'Africa/Kampala';
  const defaultDays = options.defaultDays ?? 30;
  const now = new Date();
  const toDate = to ? parseBoundary(to, true, timezone) : now;

  let fromDate: Date;
  if (from) {
    fromDate = parseBoundary(from, false, timezone);
  } else {
    const start = startOfBusinessDay(toDate, timezone);
    fromDate = new Date(start.getTime() - (defaultDays - 1) * 86_400_000);
  }
  if (fromDate.getTime() > toDate.getTime()) {
    throw ApiException.badRequest('The start date must be before the end date.', 'INVALID_DATE_RANGE');
  }
  const days = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime() + 1) / 86_400_000));
  if (days > 731) {
    throw ApiException.badRequest('Date ranges are limited to two years.', 'DATE_RANGE_TOO_LARGE');
  }
  return { from: fromDate, to: toDate, days };
}

export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime() + 1;
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime() - 1),
    days: range.days,
  };
}

export function eachDay(range: DateRange, timezone = 'Africa/Kampala'): Date[] {
  const days: Date[] = [];
  let cursor = startOfBusinessDay(range.from, timezone);
  while (cursor.getTime() <= range.to.getTime()) {
    days.push(cursor);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

export function dayKey(date: Date, timezone = 'Africa/Kampala'): string {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes(timezone) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

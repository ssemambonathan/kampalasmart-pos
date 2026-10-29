import Decimal from 'decimal.js';

export type Numeric = string | number | Decimal;
export type MoneyString = string;

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,
  toExpPos: 30,
});

export { Decimal };

export function dec(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    return new Decimal(0);
  }
}

export function roundMoney(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Serialize an amount with exactly two decimal places (canonical storage format). */
export function money(value: Numeric): MoneyString {
  return roundMoney(value).toFixed(2);
}

/** Serialize a stock quantity with exactly three decimal places. */
export function quantity(value: Numeric): string {
  return dec(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function add(...values: Numeric[]): MoneyString {
  return money(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

export function sub(a: Numeric, b: Numeric): MoneyString {
  return money(dec(a).minus(dec(b)));
}

export function mul(a: Numeric, b: Numeric): MoneyString {
  return money(dec(a).times(dec(b)));
}

export function sum(values: Numeric[]): MoneyString {
  return money(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

export function percentOf(base: Numeric, percent: Numeric): MoneyString {
  return money(dec(base).times(dec(percent)).dividedBy(100));
}

export function isNegative(value: Numeric): boolean {
  return dec(value).isNegative();
}

export function isZero(value: Numeric): boolean {
  return dec(value).isZero();
}

export function maxMoney(a: Numeric, b: Numeric): MoneyString {
  return dec(a).greaterThanOrEqualTo(dec(b)) ? money(a) : money(b);
}

export function minMoney(a: Numeric, b: Numeric): MoneyString {
  return dec(a).lessThanOrEqualTo(dec(b)) ? money(a) : money(b);
}

export const CURRENCY_DECIMALS: Record<string, number> = {
  UGX: 0,
  KES: 2,
  TZS: 0,
  RWF: 0,
  NGN: 2,
  GHS: 2,
  ZAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export const CURRENCIES = Object.keys(CURRENCY_DECIMALS);

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency?.toUpperCase()] ?? 2;
}

/**
 * Format a stored amount for display. Amounts are stored with two decimals;
 * presentation decimals follow the currency (UGX has none).
 */
export function formatMoney(
  amount: Numeric,
  currency = 'UGX',
  locale = 'en-UG',
  options?: Intl.NumberFormatOptions,
): string {
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      ...options,
    }).format(dec(amount).toNumber());
  } catch {
    return `${currency} ${roundMoney(amount).toFixed(decimals)}`;
  }
}

export function formatQuantity(value: Numeric): string {
  const d = dec(value);
  const fixed = d.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '' || fixed === '-0' ? '0' : fixed;
}

import { Decimal, Numeric, dec, money, roundMoney } from './money';

export type DiscountType = 'PERCENT' | 'AMOUNT';

export interface DiscountInput {
  type: DiscountType;
  value: Numeric;
}

export interface CartLineInput {
  productId: string;
  quantity: Numeric;
  /** Effective unit price; defaults to the product's selling price. */
  unitPrice?: Numeric;
  lineDiscount?: DiscountInput | null;
}

export interface PriceableProduct {
  id: string;
  name: string;
  sku: string;
  sellingPrice: Numeric;
  costPrice: Numeric;
  taxRate: Numeric;
  taxInclusive: boolean;
  trackStock?: boolean;
  stock?: Numeric;
}

export interface PricingOptions {
  cartDiscount?: DiscountInput | null;
  taxEnabled?: boolean;
  allowNegativeStock?: boolean;
}

export interface PricedLine {
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  gross: string;
  lineDiscount: string;
  cartDiscount: string;
  discountAmount: string;
  net: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  unitCost: string;
  totalCost: string;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: string;
  lineDiscountTotal: string;
  cartDiscountTotal: string;
  discountTotal: string;
  taxTotal: string;
  /** Net revenue excluding tax, after discounts. */
  netRevenue: string;
  total: string;
  costTotal: string;
  grossProfit: string;
  itemCount: number;
  quantityTotal: string;
}

export type PricingErrorCode =
  | 'CART_EMPTY'
  | 'PRODUCT_NOT_FOUND'
  | 'DUPLICATE_PRODUCT'
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'INVALID_DISCOUNT'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_TAX_RATE';

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const MAX_QUANTITY = new Decimal(1_000_000);

function validateDiscount(
  discount: DiscountInput | null | undefined,
  base: Decimal,
  field: string,
): Decimal {
  if (!discount) return new Decimal(0);
  const value = dec(discount.value);
  if (!value.isFinite() || value.isNegative()) {
    throw new PricingError('INVALID_DISCOUNT', `${field} discount cannot be negative.`);
  }
  if (discount.type === 'PERCENT') {
    if (value.greaterThan(100)) {
      throw new PricingError('INVALID_DISCOUNT', `${field} discount cannot exceed 100%.`);
    }
    return roundMoney(base.times(value).dividedBy(100));
  }
  if (discount.type === 'AMOUNT') {
    if (value.decimalPlaces() > 2) {
      throw new PricingError('INVALID_DISCOUNT', `${field} discount must have at most 2 decimals.`);
    }
    if (value.greaterThan(base)) {
      throw new PricingError('INVALID_DISCOUNT', `${field} discount cannot exceed the amount it applies to.`);
    }
    return roundMoney(value);
  }
  throw new PricingError('INVALID_DISCOUNT', `Unsupported discount type.`);
}

/**
 * Deterministic cart pricing shared by the POS client preview and the
 * authoritative server calculation. All monetary results are 2-decimal strings.
 * Cart-level discounts are allocated across lines proportionally so per-line
 * tax remains defensible.
 */
export function priceCart(
  lines: CartLineInput[],
  products: PriceableProduct[] | Map<string, PriceableProduct>,
  options: PricingOptions = {},
): PricedCart {
  if (!lines?.length) throw new PricingError('CART_EMPTY', 'The cart is empty.');
  const productMap =
    products instanceof Map ? products : new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();

  const base = lines.map((line) => {
    if (seen.has(line.productId)) {
      throw new PricingError('DUPLICATE_PRODUCT', 'A product appears more than once in the cart.', {
        productId: line.productId,
      });
    }
    seen.add(line.productId);
    const product = productMap.get(line.productId);
    if (!product) {
      throw new PricingError('PRODUCT_NOT_FOUND', 'One of the products no longer exists.', {
        productId: line.productId,
      });
    }
    const quantity = dec(line.quantity);
    if (
      !quantity.isFinite() ||
      quantity.isNegative() ||
      quantity.isZero() ||
      quantity.greaterThan(MAX_QUANTITY) ||
      quantity.decimalPlaces() > 3
    ) {
      throw new PricingError('INVALID_QUANTITY', `Invalid quantity for ${product.name}.`, {
        productId: product.id,
      });
    }
    if (product.trackStock !== false && !options.allowNegativeStock) {
      const stock = dec(product.stock ?? 0);
      if (quantity.greaterThan(stock)) {
        throw new PricingError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock for ${product.name}. Available: ${stock.toFixed(3)}.`,
          { productId: product.id, available: stock.toFixed(3), requested: quantity.toFixed(3) },
        );
      }
    }
    const unitPrice = line.unitPrice === undefined ? dec(product.sellingPrice) : dec(line.unitPrice);
    if (
      !unitPrice.isFinite() ||
      unitPrice.isNegative() ||
      unitPrice.decimalPlaces() > 2 ||
      unitPrice.greaterThan(1_000_000_000)
    ) {
      throw new PricingError('INVALID_PRICE', `Invalid price for ${product.name}.`, {
        productId: product.id,
      });
    }
    const taxRate = dec(product.taxRate);
    if (!taxRate.isFinite() || taxRate.isNegative() || taxRate.greaterThan(100)) {
      throw new PricingError('INVALID_TAX_RATE', `Invalid tax rate for ${product.name}.`, {
        productId: product.id,
      });
    }

    const gross = roundMoney(quantity.times(unitPrice));
    const lineDiscount = validateDiscount(line.lineDiscount, gross, 'Line');
    const netAfterLine = gross.minus(lineDiscount);
    return { product, quantity, unitPrice, taxRate, gross, lineDiscount, netAfterLine };
  });

  const netBase = base.reduce<Decimal>((acc, l) => acc.plus(l.netAfterLine), new Decimal(0));
  const cartDiscountTotal = validateDiscount(options.cartDiscount, netBase, 'Cart');

  // Allocate the cart discount proportionally, putting rounding residue on the
  // last line so the sum of allocations exactly equals the cart discount.
  let allocated = new Decimal(0);
  const cartShares = base.map((line, index) => {
    if (cartDiscountTotal.isZero() || netBase.isZero()) return new Decimal(0);
    if (index === base.length - 1) {
      return cartDiscountTotal.minus(allocated);
    }
    const share = roundMoney(cartDiscountTotal.times(line.netAfterLine).dividedBy(netBase));
    allocated = allocated.plus(share);
    return share;
  });

  let subtotal = new Decimal(0);
  let lineDiscounts = new Decimal(0);
  let taxTotal = new Decimal(0);
  let total = new Decimal(0);
  let costTotal = new Decimal(0);

  const pricedLines: PricedLine[] = base.map((line, index) => {
    const cartShare = cartShares[index] ?? new Decimal(0);
    const net = line.netAfterLine.minus(cartShare);
    const taxEnabled = options.taxEnabled !== false && line.taxRate.greaterThan(0);
    let taxAmount = new Decimal(0);
    if (taxEnabled) {
      taxAmount = line.product.taxInclusive
        ? net.minus(net.dividedBy(new Decimal(1).plus(line.taxRate.dividedBy(100))))
        : net.times(line.taxRate.dividedBy(100));
      taxAmount = roundMoney(taxAmount);
    }
    const lineTotal = roundMoney(line.product.taxInclusive ? net : net.plus(taxAmount));
    const totalCost = roundMoney(line.quantity.times(dec(line.product.costPrice)));

    subtotal = subtotal.plus(line.gross);
    lineDiscounts = lineDiscounts.plus(line.lineDiscount);
    taxTotal = taxTotal.plus(taxAmount);
    total = total.plus(lineTotal);
    costTotal = costTotal.plus(totalCost);

    return {
      productId: line.product.id,
      name: line.product.name,
      sku: line.product.sku,
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unitPrice.toFixed(2),
      gross: line.gross.toFixed(2),
      lineDiscount: line.lineDiscount.toFixed(2),
      cartDiscount: cartShare.toFixed(2),
      discountAmount: line.lineDiscount.plus(cartShare).toFixed(2),
      net: net.toFixed(2),
      taxRate: line.taxRate.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      unitCost: dec(line.product.costPrice).toFixed(2),
      totalCost: totalCost.toFixed(2),
    };
  });

  const discountTotal = lineDiscounts.plus(cartDiscountTotal);
  const netRevenue = total.minus(taxTotal);
  return {
    lines: pricedLines,
    subtotal: money(subtotal),
    lineDiscountTotal: money(lineDiscounts),
    cartDiscountTotal: money(cartDiscountTotal),
    discountTotal: money(discountTotal),
    taxTotal: money(taxTotal),
    netRevenue: money(netRevenue),
    total: money(total),
    costTotal: money(costTotal),
    grossProfit: money(netRevenue.minus(costTotal)),
    itemCount: pricedLines.length,
    quantityTotal: base
      .reduce<Decimal>((acc, l) => acc.plus(l.quantity), new Decimal(0))
      .toFixed(3),
  };
}

export interface DiscountPolicy {
  maxCashierDiscountPercent: Numeric;
  maxManagerDiscountPercent: Numeric;
}

export function discountPercent(subtotal: Numeric, discountTotal: Numeric): Decimal {
  const base = dec(subtotal);
  if (base.isZero()) return new Decimal(0);
  return dec(discountTotal).dividedBy(base).times(100);
}

/** Returns null when the role has no discount cap. */
export function discountLimitForRole(role: string, policy: DiscountPolicy): number | null {
  switch (role) {
    case 'OWNER':
      return null;
    case 'MANAGER':
      return dec(policy.maxManagerDiscountPercent).toNumber();
    case 'CASHIER':
      return dec(policy.maxCashierDiscountPercent).toNumber();
    default:
      return 0;
  }
}

export function assertDiscountAllowed(
  role: string,
  subtotal: Numeric,
  discountTotal: Numeric,
  policy: DiscountPolicy,
): { percent: number; limit: number | null } {
  const percent = discountPercent(subtotal, discountTotal).toNumber();
  const limit = discountLimitForRole(role, policy);
  if (limit !== null && percent > limit + 1e-9) {
    throw new PricingError(
      'INVALID_DISCOUNT',
      `This discount of ${percent.toFixed(1)}% exceeds your ${limit}% limit. A manager must authorise it.`,
      { percent, limit, requiredRole: 'MANAGER' },
    );
  }
  return { percent, limit };
}

/** Ensures a percentage value stored as a rate (0-100) is sane. */
export function normalizeTaxRate(value: Numeric): string {
  const rate = dec(value);
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new PricingError('INVALID_TAX_RATE', 'Tax rate must be between 0 and 100.');
  }
  return rate.toDecimalPlaces(4).toFixed(4);
}

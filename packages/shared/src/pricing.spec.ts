import { formatMoney, money, quantity } from './money';
import {
  assertDiscountAllowed,
  priceCart,
  PriceableProduct,
  PricingError,
  PricingErrorCode,
} from './pricing';

const coke: PriceableProduct = {
  id: 'p1',
  name: 'Coca-Cola 500ml',
  sku: 'COKE-500',
  sellingPrice: '2000.00',
  costPrice: '1500.00',
  taxRate: '0',
  taxInclusive: false,
  trackStock: true,
  stock: '20.000',
};

const bread: PriceableProduct = {
  id: 'p2',
  name: 'Bread',
  sku: 'BREAD-1',
  sellingPrice: '3000.00',
  costPrice: '2200.00',
  taxRate: '18',
  taxInclusive: false,
  trackStock: true,
  stock: '10.000',
};

const inclusive: PriceableProduct = {
  id: 'p3',
  name: 'Soap (tax inclusive)',
  sku: 'SOAP-1',
  sellingPrice: '1180.00',
  costPrice: '800.00',
  taxRate: '18',
  taxInclusive: true,
  trackStock: false,
};

describe('money', () => {
  it('rounds half up and serializes canonical amounts', () => {
    expect(money('10.005')).toBe('10.01');
    expect(money(0.1 + 0.2)).toBe('0.30');
    expect(quantity('3.0004')).toBe('3.000');
  });

  it('formats UGX without decimals', () => {
    const formatted = formatMoney('4820000.00', 'UGX');
    expect(formatted).not.toContain('.');
    expect(formatted).toContain('4,820,000');
  });
});

describe('priceCart', () => {
  it('computes a simple sale with tax', () => {
    const cart = priceCart(
      [
        { productId: 'p1', quantity: '2' },
        { productId: 'p2', quantity: '1' },
      ],
      [coke, bread],
    );
    expect(cart.subtotal).toBe('7000.00');
    expect(cart.taxTotal).toBe('540.00');
    expect(cart.total).toBe('7540.00');
    expect(cart.costTotal).toBe('5200.00');
    expect(cart.grossProfit).toBe('1800.00');
    expect(cart.itemCount).toBe(2);
  });

  it('applies line discounts before tax', () => {
    const cart = priceCart(
      [{ productId: 'p1', quantity: '2', lineDiscount: { type: 'AMOUNT', value: '500' } }],
      [coke],
    );
    expect(cart.subtotal).toBe('4000.00');
    expect(cart.discountTotal).toBe('500.00');
    expect(cart.total).toBe('3500.00');
    expect(cart.grossProfit).toBe('500.00');
  });

  it('allocates cart discounts exactly across lines', () => {
    const cart = priceCart(
      [
        { productId: 'p1', quantity: '1' },
        { productId: 'p2', quantity: '1' },
      ],
      [coke, bread],
      { cartDiscount: { type: 'AMOUNT', value: '100.01' } },
    );
    const allocated = cart.lines.reduce((acc, line) => acc + Number(line.cartDiscount), 0);
    expect(Number(allocated.toFixed(2))).toBe(100.01);
    expect(cart.total).toBe('5429.19');
  });

  it('handles tax-inclusive pricing', () => {
    const cart = priceCart([{ productId: 'p3', quantity: '3' }], [inclusive]);
    expect(cart.total).toBe('3540.00');
    expect(cart.taxTotal).toBe('540.00');
    expect(cart.netRevenue).toBe('3000.00');
    expect(cart.grossProfit).toBe('600.00');
  });

  it('rejects overselling tracked stock', () => {
    let error: unknown;
    try {
      priceCart([{ productId: 'p1', quantity: '21' }], [coke]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PricingError);
    expect((error as PricingError).code).toBe<PricingErrorCode>('INSUFFICIENT_STOCK');
  });

  it('allows negative stock when explicitly permitted', () => {
    const cart = priceCart([{ productId: 'p1', quantity: '21' }], [coke], { allowNegativeStock: true });
    expect(cart.total).toBe('42000.00');
  });

  it('rejects invalid quantities and discounts', () => {
    expect(() => priceCart([{ productId: 'p1', quantity: '0' }], [coke])).toThrow(PricingError);
    expect(() => priceCart([{ productId: 'p1', quantity: '1.0001' }], [coke])).toThrow(PricingError);
    expect(() =>
      priceCart(
        [{ productId: 'p1', quantity: '1', lineDiscount: { type: 'PERCENT', value: '101' } }],
        [coke],
      ),
    ).toThrow(PricingError);
  });

  it('rejects duplicate products rather than double-decrementing stock', () => {
    expect(() =>
      priceCart(
        [
          { productId: 'p1', quantity: '1' },
          { productId: 'p1', quantity: '1' },
        ],
        [coke],
      ),
    ).toThrow(/more than once/);
  });

  it('matches totals derived from the ledger of lines', () => {
    const cart = priceCart(
      [
        { productId: 'p1', quantity: '3', lineDiscount: { type: 'PERCENT', value: '10' } },
        { productId: 'p2', quantity: '2' },
      ],
      [coke, bread],
      { cartDiscount: { type: 'PERCENT', value: '5' } },
    );
    const lineSum = cart.lines.reduce((acc, line) => acc + Number(line.lineTotal), 0);
    expect(Number(lineSum.toFixed(2))).toBe(Number(cart.total));
    expect(Number(cart.taxTotal)).toBeCloseTo(
      cart.lines.reduce((acc, l) => acc + Number(l.taxAmount), 0),
      2,
    );
  });
});

describe('discount policy', () => {
  const policy = { maxCashierDiscountPercent: '5', maxManagerDiscountPercent: '20' };

  it('enforces the cashier cap', () => {
    expect(() => assertDiscountAllowed('CASHIER', '10000', '501', policy)).toThrow(/exceeds your 5%/);
    expect(assertDiscountAllowed('CASHIER', '10000', '500', policy).percent).toBe(5);
  });

  it('allows managers up to their cap and owners without cap', () => {
    expect(() => assertDiscountAllowed('MANAGER', '10000', '2001', policy)).toThrow();
    expect(() => assertDiscountAllowed('OWNER', '10000', '10000', policy)).not.toThrow();
  });
});

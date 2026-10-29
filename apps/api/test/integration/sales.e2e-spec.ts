import type { TestContext, Tenant } from './helpers';
import {
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
  stockOf,
} from './helpers';

describe('Sales: authoritative pricing, stock ledger and idempotency', () => {
  let ctx: TestContext;
  let tenant: Tenant;

  const sell = (
    client: Tenant['cashier'],
    quantity: string,
    extra: Record<string, unknown> = {},
    amount = '11800.00',
  ) =>
    client.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId: tenant.productId, quantity }],
      payments: [{ method: 'CASH', amount }],
      ...extra,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Sales');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('calculates tax, cost and profit on the server and moves stock once', async () => {
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);
    expect(before).toBe('20.000');

    const res = await sell(tenant.cashier, '2', {}, '23600.00');
    assertStatus(res, 201);
    expect(res.body.saleNumber).toMatch(/^SALE-\d+$/);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.subtotal).toBe('20000.00');
    expect(res.body.taxTotal).toBe('3600.00');
    expect(res.body.total).toBe('23600.00');
    expect(res.body.costTotal).toBe('12000.00');
    expect(res.body.grossProfit).toBe('8000.00');
    expect(res.body.change).toBe('0.00');
    expect(res.body.cashierId).toBe(tenant.cashierId);
    expect(res.body.isOffline).toBe(false);
    expect(res.body.items[0].quantity).toBe('2.000');

    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe('18.000');

    const movements = await ctx.prisma.inventoryMovement.findMany({
      where: { referenceType: 'SALE', referenceId: res.body.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe('SALE');
    expect(movements[0].quantity.toFixed(3)).toBe('-2.000');
    expect(movements[0].balanceAfter.toFixed(3)).toBe('18.000');

    const payments = await ctx.prisma.payment.findMany({ where: { saleId: res.body.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('COMPLETED');
    expect(payments[0].amount.toFixed(2)).toBe('23600.00');

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: res.body.id, action: 'sale.created' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.after as any).total).toBe('23600.00');
    expect((audit?.after as any).offline).toBe(false);
  });

  it('returns the same sale for a repeated idempotency key without moving stock again', async () => {
    const key = `sale-idem-${tenant.suffix}`;
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);

    const first = await sell(tenant.cashier, '1', { idempotencyKey: key });
    assertStatus(first, 201);
    const afterFirst = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);

    const replay = await sell(tenant.cashier, '1', { idempotencyKey: key });
    assertStatus(replay, 201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.saleNumber).toBe(first.body.saleNumber);
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(afterFirst);
    expect(Number(afterFirst)).toBe(Number(before) - 1);

    const count = await ctx.prisma.sale.count({
      where: { businessId: tenant.businessId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it('forbids cashiers from overriding prices but allows managers', async () => {
    const forbidden = await sell(tenant.cashier, '1', {
      items: [
        {
          productId: tenant.productId,
          quantity: '1',
          unitPrice: '9000.00',
        },
      ],
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('PRICE_OVERRIDE_FORBIDDEN');

    const managerSale = await tenant.manager.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId: tenant.productId, quantity: '1', unitPrice: '9000.00' }],
      payments: [{ method: 'CARD', amount: '10620.00' }],
    });
    assertStatus(managerSale, 201);
    expect(managerSale.body.subtotal).toBe('9000.00');
    expect(managerSale.body.taxTotal).toBe('1620.00');
    expect(managerSale.body.total).toBe('10620.00');
  });

  it('blocks discounts above the cashier allowance', async () => {
    const res = await sell(tenant.cashier, '1', {
      cartDiscount: { type: 'PERCENT', value: '50' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_DISCOUNT');
  });

  it('rejects insufficient stock without changing inventory', async () => {
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);
    const res = await sell(tenant.cashier, '999', {}, '1178820.00');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(before);
  });

  it('rejects underpayment and records no sale', async () => {
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);
    const res = await sell(tenant.cashier, '1', {}, '1000.00');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_MISMATCH');
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(before);
  });

  it('records change when cash tendered exceeds the total', async () => {
    const res = await sell(tenant.cashier, '1', {}, '12000.00');
    assertStatus(res, 201);
    expect(res.body.total).toBe('11800.00');
    expect(res.body.change).toBe('200.00');
  });

  it('scopes the cashier sale list to that cashier while managers see the branch', async () => {
    const managerSale = await tenant.manager.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId: tenant.secondaryProductId, quantity: '1' }],
      payments: [{ method: 'CASH', amount: '5900.00' }],
    });
    assertStatus(managerSale, 201);

    const cashierList = await tenant.cashier.get('/sales', { pageSize: 100 });
    expect(cashierList.status).toBe(200);
    expect(cashierList.body.data.length).toBeGreaterThan(0);
    expect(
      cashierList.body.data.every((sale: any) => sale.cashierName === 'Sales Cashier'),
    ).toBe(true);

    const managerList = await tenant.manager.get('/sales', { pageSize: 100 });
    expect(managerList.status).toBe(200);
    expect(managerList.body.data.some((sale: any) => sale.id === managerSale.body.id)).toBe(true);
    expect(
      managerList.body.data.some((sale: any) => sale.cashierName === 'Sales Cashier'),
    ).toBe(true);
  });
});

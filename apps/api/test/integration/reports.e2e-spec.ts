import type { TestContext, Tenant } from './helpers';
import {
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
} from './helpers';

const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Business date in Africa/Kampala, offset by whole days. */
function businessDay(offset = 0): string {
  const shifted = new Date(Date.now() + KAMPALA_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function atBusinessTime(day: string, time: string): Date {
  return new Date(`${day}T${time}+03:00`);
}

describe('Reports: net revenue, refunds, ranges and tenant scope', () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let today: string;
  let yesterday: string;
  let twoDaysAgo: string;

  const sale = async (
    client: Tenant['cashier'],
    productId: string,
    quantity: string,
    amount: string,
    method = 'CASH',
  ) => {
    const res = await client.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId, quantity }],
      payments: [{ method, amount }],
    });
    assertStatus(res, 201);
    return res.body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Reports');
    other = await setupTenant(ctx.server, ctx.prisma, 'ReportsOther');

    today = businessDay(0);
    yesterday = businessDay(-1);
    twoDaysAgo = businessDay(-2);

    const widgetSale = await sale(tenant.cashier, tenant.productId, '2', '23600.00');
    await sale(tenant.manager, tenant.secondaryProductId, '1', '5900.00');
    await sale(tenant.cashier, tenant.secondaryProductId, '3', '17700.00', 'CARD');

    const detail = await tenant.cashier.get(`/sales/${widgetSale.id}`);
    assertStatus(detail, 200);
    const refund = await tenant.manager.post('/refunds', {
      saleId: widgetSale.id,
      items: [{ saleItemId: detail.body.items[0].id, quantity: '1' }],
      reason: 'Damaged packaging',
    });
    assertStatus(refund, 201);
    expect(refund.body.status).toBe('COMPLETED');
    expect(refund.body.total).toBe('11800.00');

    const priorSale = await sale(tenant.cashier, tenant.productId, '1', '11800.00');
    await ctx.prisma.sale.update({
      where: { id: priorSale.id },
      data: { createdAt: atBusinessTime(yesterday, '12:00:00') },
    });

    const earlyProbe = await sale(tenant.cashier, tenant.secondaryProductId, '1', '5900.00');
    await ctx.prisma.sale.update({
      where: { id: earlyProbe.id },
      data: { createdAt: atBusinessTime(twoDaysAgo, '00:05:00') },
    });

    const lateProbe = await sale(tenant.cashier, tenant.secondaryProductId, '1', '5900.00');
    await ctx.prisma.sale.update({
      where: { id: lateProbe.id },
      data: { createdAt: atBusinessTime(twoDaysAgo, '23:55:00') },
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('nets completed refunds through totals, cashier and category breakdowns', async () => {
    const res = await tenant.owner.get('/reports/sales-summary', { from: today, to: today });
    assertStatus(res, 200);

    expect(res.body.totals).toEqual({
      grossSales: '40000.00',
      netSales: '30000.00',
      discounts: '0.00',
      tax: '5400.00',
      refunds: '11800.00',
      costOfGoods: '14000.00',
      grossProfit: '16000.00',
      transactions: 3,
      averageSale: '15733.33',
      itemsSold: '5.000',
    });

    expect(res.body.series).toEqual([
      { period: today, sales: '30000.00', profit: '16000.00', transactions: 3 },
    ]);

    expect(res.body.byLocation).toHaveLength(1);
    expect(res.body.byLocation[0]).toMatchObject({
      locationId: tenant.mainLocationId,
      name: 'Main Branch',
      sales: '30000.00',
      profit: '16000.00',
      transactions: 3,
    });

    const cashierRow = res.body.byCashier.find(
      (row: { userId: string }) => row.userId === tenant.cashierId,
    );
    const managerRow = res.body.byCashier.find(
      (row: { userId: string }) => row.userId === tenant.managerId,
    );
    expect(cashierRow).toMatchObject({
      sales: '25000.00',
      profit: '13000.00',
      transactions: 2,
    });
    expect(managerRow).toMatchObject({ sales: '5000.00', profit: '3000.00', transactions: 1 });
    const cashierNet = res.body.byCashier.reduce(
      (total: number, row: { sales: string }) => total + Number(row.sales),
      0,
    );
    expect(cashierNet).toBe(30000);

    expect(res.body.byCategory).toEqual([
      {
        categoryId: tenant.categoryId,
        name: 'Reports Category',
        sales: '30000.00',
        profit: '16000.00',
        quantity: '5.000',
      },
    ]);

    expect(res.body.byPaymentMethod).toEqual([
      expect.objectContaining({ method: 'CASH', amount: '29500.00', count: 2 }),
      expect.objectContaining({ method: 'CARD', amount: '17700.00', count: 1 }),
    ]);

    const widget = res.body.topProducts.find(
      (row: { productId: string }) => row.productId === tenant.productId,
    );
    const secondary = res.body.topProducts.find(
      (row: { productId: string }) => row.productId === tenant.secondaryProductId,
    );
    expect(widget).toMatchObject({ quantity: '2.000', revenue: '20000.00', profit: '8000.00' });
    expect(secondary).toMatchObject({ quantity: '4.000', revenue: '20000.00', profit: '12000.00' });
    expect(res.body.discounts).toEqual([]);
  });

  it('applies inclusive date-only ranges in business time', async () => {
    const bucket = await tenant.owner.get('/reports/sales-summary', {
      from: twoDaysAgo,
      to: twoDaysAgo,
    });
    assertStatus(bucket, 200);
    expect(bucket.body.totals).toMatchObject({
      netSales: '10000.00',
      tax: '1800.00',
      refunds: '0.00',
      costOfGoods: '4000.00',
      grossProfit: '6000.00',
      transactions: 2,
      itemsSold: '2.000',
    });
    expect(bucket.body.series).toEqual([
      { period: twoDaysAgo, sales: '10000.00', profit: '6000.00', transactions: 2 },
    ]);

    const emptyDay = await tenant.owner.get('/reports/sales-summary', {
      from: businessDay(-3),
      to: businessDay(-3),
    });
    assertStatus(emptyDay, 200);
    expect(emptyDay.body.totals.transactions).toBe(0);
    expect(emptyDay.body.totals.netSales).toBe('0.00');
    expect(emptyDay.body.series).toEqual([]);

    const span = await tenant.owner.get('/reports/sales-summary', {
      from: businessDay(-3),
      to: twoDaysAgo,
    });
    assertStatus(span, 200);
    expect(span.body.totals.transactions).toBe(2);
    expect(span.body.totals.netSales).toBe('10000.00');

    const invalidDay = await tenant.owner.get('/reports/sales-summary', {
      from: '2026-02-30',
      to: '2026-03-01',
    });
    expect(invalidDay.status).toBe(400);
    const reversed = await tenant.owner.get('/reports/sales-summary', {
      from: today,
      to: yesterday,
    });
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.code).toBe('INVALID_DATE_RANGE');
    const tooLarge = await tenant.owner.get('/reports/sales-summary', {
      from: '2020-01-01',
      to: today,
    });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('DATE_RANGE_TOO_LARGE');
  });

  it('builds the dashboard from recorded sales, refunds and current stock', async () => {
    const res = await tenant.owner.get('/reports/dashboard');
    assertStatus(res, 200);

    expect(res.body.today).toMatchObject({
      sales: '30000.00',
      transactions: 3,
      profit: '16000.00',
      refunds: '11800.00',
      discounts: '0.00',
      averageSale: '15733.33',
    });
    expect(res.body.comparison.salesChangePercent).toBe(200);
    expect(res.body.comparison.profitChangePercent).toBe(300);
    expect(res.body.comparison.transactionChangePercent).toBe(200);

    expect(res.body.trend).toHaveLength(7);
    const todayBucket = res.body.trend.find((row: { date: string }) => row.date === today);
    const yesterdayBucket = res.body.trend.find(
      (row: { date: string }) => row.date === yesterday,
    );
    const probeBucket = res.body.trend.find((row: { date: string }) => row.date === twoDaysAgo);
    expect(todayBucket).toEqual({
      date: today,
      sales: '30000.00',
      profit: '16000.00',
      transactions: 3,
    });
    expect(yesterdayBucket).toMatchObject({ sales: '10000.00', profit: '4000.00', transactions: 1 });
    expect(probeBucket).toMatchObject({ sales: '10000.00', profit: '6000.00', transactions: 2 });

    expect(res.body.paymentBreakdown).toEqual([
      expect.objectContaining({ method: 'CASH', amount: '29500.00', count: 2 }),
      expect.objectContaining({ method: 'CARD', amount: '17700.00', count: 1 }),
    ]);

    expect(res.body.branchPerformance).toEqual([
      expect.objectContaining({
        locationId: tenant.mainLocationId,
        sales: '30000.00',
        profit: '16000.00',
        transactions: 3,
      }),
    ]);

    expect(res.body.inventoryValue).toBe('116000.00');
    expect(res.body.pending).toEqual({ refunds: 0, transfers: 0, syncConflicts: 0 });
    expect(res.body.recentSales).toHaveLength(3);
    expect(res.body.recentSales[0]).toMatchObject({
      locationName: 'Main Branch',
      status: 'COMPLETED',
    });

    const top = res.body.topProducts.find(
      (row: { productId: string }) => row.productId === tenant.secondaryProductId,
    );
    expect(top).toMatchObject({ quantity: '4.000', revenue: '20000.00', profit: '12000.00' });
  });

  it('explains the profit change with period comparisons and a recommended action', async () => {
    const res = await tenant.owner.get('/reports/profit-explanation', {
      from: today,
      to: today,
    });
    assertStatus(res, 200);

    expect(res.body.currentPeriod).toMatchObject({
      from: today,
      to: today,
      revenue: '30000.00',
      profit: '16000.00',
      marginPercent: 53.3,
    });
    expect(res.body.previousPeriod).toMatchObject({
      from: yesterday,
      to: yesterday,
      revenue: '10000.00',
      profit: '4000.00',
      marginPercent: 40,
    });
    expect(res.body.profitChange).toBe('12000.00');
    expect(res.body.profitChangePercent).toBe(300);
    expect(res.body.reasons.map((reason: { title: string }) => reason.title)).toEqual([
      'Sales volume',
      'Average basket',
      'Discounts given',
      'Refunds and returns',
      'Cost of goods sold',
    ]);
    const refundReason = res.body.reasons.find(
      (reason: { title: string }) => reason.title === 'Refunds and returns',
    );
    expect(refundReason.direction).toBe('DOWN');
    expect(refundReason.impact).toBe('-4000.00');
    expect(res.body.largestContributor).toMatchObject({
      productId: tenant.secondaryProductId,
      name: 'Reports Secondary',
      profitChange: '12000.00',
    });
    expect(res.body.basedOn).toContain('Africa/Kampala');
    expect(res.body.suggestedAction.length).toBeGreaterThan(20);
  });

  it('values stock and nets units sold through the refunded quantity', async () => {
    const res = await tenant.owner.get('/reports/stock', { from: today, to: today });
    assertStatus(res, 200);
    expect(res.body.totals).toMatchObject({
      value: '116000.00',
      quantity: '22.000',
      skuCount: 2,
      lowStock: 0,
      critical: 0,
      outOfStock: 2,
    });
    expect(res.body.byLocation[0]).toMatchObject({
      locationId: tenant.mainLocationId,
      value: '116000.00',
      quantity: '22.000',
      skuCount: 2,
    });

    const sold = res.body.movements.find(
      (row: { movementType: string }) => row.movementType === 'SALE',
    );
    const returned = res.body.movements.find(
      (row: { movementType: string }) => row.movementType === 'SALE_RETURN',
    );
    // Movement summaries use the ledger timestamp: every sale was applied today,
    // even the ones whose business date was back-dated for the range tests.
    expect(sold).toMatchObject({ quantity: '-9.000', count: 6 });
    expect(returned).toMatchObject({ quantity: '1.000', count: 1 });

    const products = await tenant.owner.get('/reports/products', { from: today, to: today });
    assertStatus(products, 200);
    expect(products.body.totals).toMatchObject({
      revenue: '40000.00',
      profit: '20000.00',
      quantity: '6.000',
      products: 2,
      productsSold: 2,
    });
    const widget = products.body.rows.find(
      (row: { productId: string }) => row.productId === tenant.productId,
    );
    expect(widget).toMatchObject({
      quantitySold: '2.000',
      revenue: '20000.00',
      profit: '8000.00',
      stockOnHand: '18.000',
      averageDailySales: '2.000',
      daysOfCover: 9,
    });
    const secondary = products.body.rows.find(
      (row: { productId: string }) => row.productId === tenant.secondaryProductId,
    );
    expect(secondary).toMatchObject({
      quantitySold: '4.000',
      revenue: '20000.00',
      profit: '12000.00',
      stockOnHand: '4.000',
      averageDailySales: '4.000',
      daysOfCover: 1,
    });
  });

  it('reports output tax net of refund tax and exports CSV', async () => {
    const tax = await tenant.owner.get('/reports/tax', { from: today, to: today });
    assertStatus(tax, 200);
    expect(tax.body.totals).toEqual({
      outputTax: '7200.00',
      refundTax: '1800.00',
      netOutputTax: '5400.00',
      inputTax: '0.00',
      netTaxDue: '5400.00',
    });
    expect(tax.body.rows).toEqual([
      { taxRate: '18.000', tax: '7200.00', grossSales: '47200.00', netSales: '40000.00' },
    ]);
    expect(tax.body.disclaimer).toContain('not a filed return');

    const csv = await tenant.manager.get('/reports/export', {
      report: 'tax',
      from: today,
      to: today,
    });
    assertStatus(csv, 200);
    expect(csv.body.filename).toMatch(/^tax-report-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.body.contentType).toContain('text/csv');
    expect(csv.body.content).toContain('tax_rate,gross_sales,net_sales,tax');
    expect(csv.body.content).toContain('18.000,47200.00,40000.00,7200.00');

    const customers = await tenant.owner.get('/reports/customers', { from: today, to: today });
    assertStatus(customers, 200);
    expect(customers.body.totals).toMatchObject({
      identifiedRevenue: '0.00',
      anonymousRevenue: '47200.00',
      totalCustomers: 0,
    });
    expect(customers.body.rows).toEqual([]);

    const suppliers = await tenant.owner.get('/reports/suppliers', { from: today, to: today });
    assertStatus(suppliers, 200);
    expect(suppliers.body.totals.suppliers).toBe(0);
    expect(suppliers.body.rows).toEqual([]);
  });

  it('isolates tenants and branches and enforces report permissions', async () => {
    const foreign = await other.owner.get('/reports/sales-summary', { from: today, to: today });
    assertStatus(foreign, 200);
    expect(foreign.body.totals.netSales).toBe('0.00');
    expect(foreign.body.totals.transactions).toBe(0);
    expect(foreign.body.byCashier).toEqual([]);
    expect(foreign.body.byCategory).toEqual([]);
    expect(foreign.body.byLocation).toEqual([]);

    const foreignLocation = await other.owner.get('/reports/sales-summary', {
      from: today,
      to: today,
      locationId: tenant.mainLocationId,
    });
    expect(foreignLocation.status).toBe(404);

    const otherBranch = await tenant.manager.get('/reports/sales-summary', {
      from: today,
      to: today,
      locationId: tenant.secondLocationId,
    });
    assertStatus(otherBranch, 200);
    expect(otherBranch.body.totals.transactions).toBe(0);
    expect(otherBranch.body.totals.netSales).toBe('0.00');
    expect(otherBranch.body.byCashier).toEqual([]);

    assertStatus(await tenant.cashier.get('/reports/sales-summary'), 403);
    assertStatus(await tenant.clerk.get('/reports/dashboard'), 403);
    assertStatus(await tenant.cashier.get('/reports/export', { report: 'tax' }), 403);
    assertStatus(await tenant.manager.get('/reports/sales-summary'), 200);
  });
});

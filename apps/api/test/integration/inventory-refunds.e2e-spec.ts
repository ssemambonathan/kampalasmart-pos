import type { TestContext, Tenant } from './helpers';
import {
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
  stockOf,
} from './helpers';

describe('Inventory adjustments and refund approval workflow', () => {
  let ctx: TestContext;
  let tenant: Tenant;

  const productStock = () => stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);

  const createSale = async (quantity: string) => {
    const total = (Number(quantity) * 10000 * 1.18).toFixed(2);
    const res = await tenant.cashier.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId: tenant.productId, quantity }],
      payments: [{ method: 'CASH', amount: total }],
    });
    assertStatus(res, 201);
    return res.body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Refunds');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('records an inventory adjustment with an auditable movement', async () => {
    const res = await tenant.clerk.post('/inventory/adjustments', {
      locationId: tenant.mainLocationId,
      productId: tenant.productId,
      quantity: '5',
      reason: 'Delivered by supplier outside purchase order',
      movementType: 'ADJUSTMENT_IN',
    });
    assertStatus(res, 201);
    expect(await productStock()).toBe('25.000');

    const movement = await ctx.prisma.inventoryMovement.findFirst({
      where: { productId: tenant.productId, movementType: 'ADJUSTMENT_IN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement?.quantity.toFixed(3)).toBe('5.000');
    expect(movement?.balanceAfter.toFixed(3)).toBe('25.000');
    expect(movement?.reason).toContain('supplier');

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'inventory.adjusted', entityId: tenant.productId },
    });
    expect(audit).not.toBeNull();
  });

  it('holds a cashier refund for approval, then restocks it exactly once', async () => {
    const sale = await createSale('1');
    expect(await productStock()).toBe('24.000');

    const requested = await tenant.cashier.post('/refunds', {
      saleId: sale.id,
      items: [{ saleItemId: sale.items[0].id, quantity: '1' }],
      reason: 'Customer changed their mind',
    });
    assertStatus(requested, 201);
    expect(requested.body.status).toBe('PENDING');
    expect(requested.body.total).toBe('11800.00');
    expect(requested.body.autoCompleted).toBe(false);
    expect(await productStock()).toBe('24.000');

    const selfApprove = await tenant.cashier.post(`/refunds/${requested.body.id}/approve`);
    expect(selfApprove.status).toBe(403);

    const approved = await tenant.manager.post(`/refunds/${requested.body.id}/approve`);
    assertStatus(approved, 200);
    expect(approved.body.status).toBe('APPROVED');

    const completed = await tenant.manager.post(`/refunds/${requested.body.id}/complete`);
    assertStatus(completed, 200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(await productStock()).toBe('25.000');

    const saleAfter = await tenant.manager.get(`/sales/${sale.id}`);
    expect(saleAfter.status).toBe(200);
    expect(saleAfter.body.status).toBe('REFUNDED');
    expect(saleAfter.body.items[0].refundedQuantity).toBe('1.000');

    const movements = await ctx.prisma.inventoryMovement.findMany({
      where: { referenceType: 'REFUND', referenceId: requested.body.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe('SALE_RETURN');
    expect(movements[0].quantity.toFixed(3)).toBe('1.000');
    expect(movements[0].balanceAfter.toFixed(3)).toBe('25.000');

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: requested.body.id, action: 'refund.completed' },
    });
    expect(audit).not.toBeNull();

    const again = await tenant.cashier.post('/refunds', {
      saleId: sale.id,
      items: [{ saleItemId: sale.items[0].id, quantity: '1' }],
      reason: 'Duplicate attempt',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SALE_FULLY_REFUNDED');
  });

  it('treats a repeated refund request as the same request until it is completed', async () => {
    const sale = await createSale('2');
    const before = await productStock();
    const payload = {
      saleId: sale.id,
      items: [{ saleItemId: sale.items[0].id, quantity: '1' }],
      reason: 'One item arrived damaged',
      idempotencyKey: `refund-idem-${tenant.suffix}`,
    };

    const first = await tenant.cashier.post('/refunds', payload);
    assertStatus(first, 201);
    const replay = await tenant.cashier.post('/refunds', payload);
    assertStatus(replay, 201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await productStock()).toBe(before);

    const count = await ctx.prisma.refund.count({
      where: { businessId: tenant.businessId, idempotencyKey: payload.idempotencyKey },
    });
    expect(count).toBe(1);

    const cancelled = await tenant.cashier.post(`/refunds/${first.body.id}/cancel`);
    assertStatus(cancelled, 200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await productStock()).toBe(before);
  });

  it('enforces requester/approver segregation and owner threshold override', async () => {
    const sale = await createSale('5');
    const before = await productStock();

    const requested = await tenant.manager.post('/refunds', {
      saleId: sale.id,
      items: [{ saleItemId: sale.items[0].id, quantity: '5' }],
      reason: 'Bulk order returned by customer',
    });
    assertStatus(requested, 201);
    expect(requested.body.status).toBe('PENDING');
    expect(requested.body.total).toBe('59000.00');

    const selfApprove = await tenant.manager.post(`/refunds/${requested.body.id}/approve`);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.code).toBe('REFUND_SEGREGATION');

    const ownerApprove = await tenant.owner.post(`/refunds/${requested.body.id}/approve`);
    assertStatus(ownerApprove, 200);
    expect(ownerApprove.body.status).toBe('APPROVED');

    const ownerComplete = await tenant.owner.post(`/refunds/${requested.body.id}/complete`);
    assertStatus(ownerComplete, 200);
    expect(ownerComplete.body.status).toBe('COMPLETED');
    expect(await productStock()).toBe(String(Number(before) + 5) + '.000');

    const saleAfter = await tenant.manager.get(`/sales/${sale.id}`);
    expect(saleAfter.body.status).toBe('REFUNDED');
  });
});

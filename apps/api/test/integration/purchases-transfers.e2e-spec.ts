import type { TestContext, Tenant } from './helpers';
import {
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
  stockOf,
} from './helpers';

describe('Purchases, supplier returns and branch transfers', () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let supplierId: string;
  let purchaseId: string;
  let purchaseItemWidgetId: string;
  let purchaseItemSecondaryId: string;

  const mainStock = (productId: string) =>
    stockOf(ctx.prisma, tenant.mainLocationId, productId);
  const secondStock = (productId: string) =>
    stockOf(ctx.prisma, tenant.secondLocationId, productId);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Supply');
    other = await setupTenant(ctx.server, ctx.prisma, 'SupplyOther');

    const supplier = await tenant.owner.post('/suppliers', {
      name: 'Kampala Wholesale Ltd',
      phone: '+256700000001',
    });
    assertStatus(supplier, 201);
    supplierId = supplier.body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates a purchase order, receives it in parts and refreshes replacement cost', async () => {
    const created = await tenant.clerk.post('/purchases', {
      supplierId,
      locationId: tenant.mainLocationId,
      reference: 'INV-7781',
      taxRatePercent: '18',
      items: [
        { productId: tenant.productId, quantity: '5', unitCost: '6500.00' },
        { productId: tenant.secondaryProductId, quantity: '2', unitCost: '2100.00' },
      ],
    });
    assertStatus(created, 201);
    purchaseId = created.body.id;
    expect(created.body.status).toBe('ORDERED');
    expect(created.body.purchaseNumber).toMatch(/^[A-Z]+-\d+$/);
    expect(created.body.supplierName).toBe('Kampala Wholesale Ltd');
    expect(created.body.subtotal).toBe('36700.00');
    expect(created.body.taxTotal).toBe('6606.00');
    expect(created.body.total).toBe('43306.00');

    const widgetLine = created.body.items.find(
      (item: { productId: string }) => item.productId === tenant.productId,
    );
    const secondaryLine = created.body.items.find(
      (item: { productId: string }) => item.productId === tenant.secondaryProductId,
    );
    purchaseItemWidgetId = widgetLine.id;
    purchaseItemSecondaryId = secondaryLine.id;

    const partial = await tenant.clerk.post(`/purchases/${purchaseId}/receive`, {
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '3' }],
      note: 'First delivery',
    });
    assertStatus(partial, 200);
    expect(partial.body.status).toBe('PARTIALLY_RECEIVED');
    expect(await mainStock(tenant.productId)).toBe('23.000');

    const widget = await ctx.prisma.product.findUniqueOrThrow({
      where: { id: tenant.productId },
    });
    expect(widget.costPrice.toFixed(2)).toBe('6500.00');
    const secondary = await ctx.prisma.product.findUniqueOrThrow({
      where: { id: tenant.secondaryProductId },
    });
    expect(secondary.costPrice.toFixed(2)).toBe('2000.00');
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          businessId: tenant.businessId,
          action: 'product.cost_changed',
          entityId: tenant.productId,
        },
      }),
    ).toBe(1);

    const overReceipt = await tenant.clerk.post(`/purchases/${purchaseId}/receive`, {
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '10' }],
    });
    expect(overReceipt.status).toBe(409);
    expect(overReceipt.body.error.code).toBe('OVER_RECEIPT');

    const completed = await tenant.clerk.post(`/purchases/${purchaseId}/receive`, {
      items: [
        { purchaseItemId: purchaseItemWidgetId, quantity: '2' },
        { purchaseItemId: purchaseItemSecondaryId, quantity: '2' },
      ],
    });
    assertStatus(completed, 200);
    expect(completed.body.status).toBe('RECEIVED');
    expect(completed.body.receivedAt).not.toBeNull();
    expect(await mainStock(tenant.productId)).toBe('25.000');
    expect(await mainStock(tenant.secondaryProductId)).toBe('12.000');

    const refreshedSecondary = await ctx.prisma.product.findUniqueOrThrow({
      where: { id: tenant.secondaryProductId },
    });
    expect(refreshedSecondary.costPrice.toFixed(2)).toBe('2100.00');

    const purchaseMovements = await ctx.prisma.inventoryMovement.findMany({
      where: {
        businessId: tenant.businessId,
        movementType: 'PURCHASE',
        referenceId: purchaseId,
      },
    });
    expect(purchaseMovements).toHaveLength(3);
    expect(
      purchaseMovements.reduce((total, movement) => total + movement.quantity.toNumber(), 0),
    ).toBe(7);
    expect(
      await ctx.prisma.auditLog.count({
        where: { businessId: tenant.businessId, action: 'purchase.received', entityId: purchaseId },
      }),
    ).toBe(2);

    const locked = await tenant.clerk.patch(`/purchases/${purchaseId}`, {
      reference: 'Changed after receipt',
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PURCHASE_LOCKED');

    const again = await tenant.clerk.post(`/purchases/${purchaseId}/receive`, {
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '1' }],
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PURCHASE_ALREADY_RECEIVED');
  });

  it('returns received stock to the supplier without exceeding the receipt', async () => {
    const returned = await tenant.clerk.post(`/purchases/${purchaseId}/returns`, {
      reason: 'Damaged cartons',
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '1' }],
    });
    assertStatus(returned, 201);
    expect(returned.body.returnNumber).toMatch(/^[A-Z]+-\d+$/);
    expect(returned.body.total).toBe('6500.00');
    expect(returned.body.lines).toBe(1);
    expect(await mainStock(tenant.productId)).toBe('24.000');

    const excess = await tenant.clerk.post(`/purchases/${purchaseId}/returns`, {
      reason: 'Too many',
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '25' }],
    });
    expect(excess.status).toBe(409);
    expect(excess.body.error.code).toBe('RETURN_EXCEEDS_RECEIVED');

    const rest = await tenant.clerk.post(`/purchases/${purchaseId}/returns`, {
      reason: 'Remaining damaged cartons',
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '4' }],
    });
    assertStatus(rest, 201);
    expect(rest.body.total).toBe('26000.00');
    expect(await mainStock(tenant.productId)).toBe('20.000');

    const noneLeft = await tenant.clerk.post(`/purchases/${purchaseId}/returns`, {
      reason: 'Nothing left',
      items: [{ purchaseItemId: purchaseItemWidgetId, quantity: '1' }],
    });
    expect(noneLeft.status).toBe(409);
    expect(noneLeft.body.error.code).toBe('RETURN_EXCEEDS_RECEIVED');

    const detail = await tenant.clerk.get(`/purchases/${purchaseId}`);
    assertStatus(detail, 200);
    expect(detail.body.returns).toHaveLength(2);
    expect(detail.body.returns[0].items[0].quantity).toBe('4.000');

    const list = await tenant.clerk.get('/purchases/returns');
    assertStatus(list, 200);
    expect(list.body.total).toBe(2);
    expect(list.body.data[0]).toMatchObject({
      supplierName: 'Kampala Wholesale Ltd',
      reason: 'Remaining damaged cartons',
      total: '26000.00',
    });

    expect(
      await ctx.prisma.inventoryMovement.count({
        where: {
          businessId: tenant.businessId,
          movementType: 'PURCHASE_RETURN',
          referenceType: 'PURCHASE_RETURN',
        },
      }),
    ).toBe(2);
    expect(
      await ctx.prisma.auditLog.count({
        where: { businessId: tenant.businessId, action: 'purchase.returned', entityId: purchaseId },
      }),
    ).toBe(2);
  });

  it('cancels only unreceived orders and rejects invalid purchase input', async () => {
    const order = await tenant.owner.post('/purchases', {
      supplierId,
      items: [{ productId: tenant.secondaryProductId, quantity: '1', unitCost: '2000.00' }],
    });
    assertStatus(order, 201);

    const updated = await tenant.owner.patch(`/purchases/${order.body.id}`, {
      reference: 'PO-REF-1',
      notes: 'Call before delivery',
    });
    assertStatus(updated, 200);
    expect(updated.body.reference).toBe('PO-REF-1');

    const cancelled = await tenant.owner.post(`/purchases/${order.body.id}/cancel`);
    assertStatus(cancelled, 200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const again = await tenant.owner.post(`/purchases/${order.body.id}/cancel`);
    assertStatus(again, 200);
    expect(again.body.status).toBe('CANCELLED');

    const receiveCancelled = await tenant.clerk.post(`/purchases/${order.body.id}/receive`, {
      items: [{ purchaseItemId: order.body.items[0].id, quantity: '1' }],
    });
    expect(receiveCancelled.status).toBe(409);
    expect(receiveCancelled.body.error.code).toBe('PURCHASE_CANCELLED');

    const cancelReceived = await tenant.owner.post(`/purchases/${purchaseId}/cancel`);
    expect(cancelReceived.status).toBe(409);
    expect(cancelReceived.body.error.code).toBe('PURCHASE_HAS_RECEIPTS');

    const invalidSupplier = await tenant.owner.post('/purchases', {
      supplierId: 'missing-supplier',
      items: [{ productId: tenant.productId, quantity: '1', unitCost: '6000.00' }],
    });
    expect(invalidSupplier.status).toBe(400);
    expect(invalidSupplier.body.error.code).toBe('INVALID_SUPPLIER');

    const duplicateProduct = await tenant.owner.post('/purchases', {
      supplierId,
      items: [
        { productId: tenant.productId, quantity: '1', unitCost: '6000.00' },
        { productId: tenant.productId, quantity: '2', unitCost: '6000.00' },
      ],
    });
    expect(duplicateProduct.status).toBe(400);
    expect(duplicateProduct.body.error.code).toBe('DUPLICATE_PRODUCT');

    assertStatus(
      await tenant.cashier.post('/purchases', {
        supplierId,
        items: [{ productId: tenant.productId, quantity: '1', unitCost: '6000.00' }],
      }),
      403,
    );
  });

  it('moves stock between branches only after approval, with ledger entries on both sides', async () => {
    assertStatus(
      await tenant.cashier.post('/transfers', {
        fromLocationId: tenant.mainLocationId,
        toLocationId: tenant.secondLocationId,
        items: [{ productId: tenant.secondaryProductId, quantity: '1' }],
      }),
      403,
    );

    const created = await tenant.clerk.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.secondLocationId,
      notes: 'Restock the second branch',
      items: [{ productId: tenant.secondaryProductId, quantity: '2' }],
    });
    assertStatus(created, 201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.transferNumber).toMatch(/^[A-Z]+-\d+$/);
    expect(created.body.items[0].unitCost).toBe('2100.00');
    expect(await mainStock(tenant.secondaryProductId)).toBe('12.000');
    expect(await secondStock(tenant.secondaryProductId)).toBe('0.000');

    assertStatus(await tenant.clerk.post(`/transfers/${created.body.id}/approve`), 403);

    const approved = await tenant.manager.post(`/transfers/${created.body.id}/approve`);
    assertStatus(approved, 200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedByName).not.toBeNull();

    const completed = await tenant.clerk.post(`/transfers/${created.body.id}/complete`);
    assertStatus(completed, 200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(await mainStock(tenant.secondaryProductId)).toBe('10.000');
    expect(await secondStock(tenant.secondaryProductId)).toBe('2.000');

    const movements = await ctx.prisma.inventoryMovement.findMany({
      where: { businessId: tenant.businessId, referenceType: 'TRANSFER', referenceId: created.body.id },
      orderBy: { quantity: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0].movementType).toBe('TRANSFER_OUT');
    expect(movements[0].quantity.toFixed(3)).toBe('-2.000');
    expect(movements[1].movementType).toBe('TRANSFER_IN');
    expect(movements[1].quantity.toFixed(3)).toBe('2.000');
    expect(movements[1].balanceAfter.toFixed(3)).toBe('2.000');

    const repeat = await tenant.clerk.post(`/transfers/${created.body.id}/complete`);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('TRANSFER_NOT_APPROVED');

    expect(
      await ctx.prisma.auditLog.count({
        where: {
          businessId: tenant.businessId,
          action: { in: ['transfer.approved', 'transfer.completed'] },
          entityId: created.body.id,
        },
      }),
    ).toBe(2);

    assertStatus(await other.owner.get(`/transfers/${created.body.id}`), 404);
    assertStatus(await tenant.cashier.get('/transfers'), 403);
    const list = await tenant.manager.get('/transfers');
    assertStatus(list, 200);
    expect(list.body.total).toBe(1);
  });

  it('enforces transfer segregation, cancellation and stock availability', async () => {
    const rejectedOrder = await tenant.clerk.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.secondLocationId,
      items: [{ productId: tenant.productId, quantity: '1' }],
    });
    assertStatus(rejectedOrder, 201);
    const rejected = await tenant.manager.post(`/transfers/${rejectedOrder.body.id}/reject`, {
      reason: 'Second branch has enough stock',
    });
    assertStatus(rejected, 200);
    expect(rejected.body.status).toBe('REJECTED');
    const completeRejected = await tenant.clerk.post(`/transfers/${rejectedOrder.body.id}/complete`);
    expect(completeRejected.status).toBe(409);

    const cancellable = await tenant.clerk.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.secondLocationId,
      items: [{ productId: tenant.productId, quantity: '1' }],
    });
    assertStatus(cancellable, 201);
    const managerCancel = await tenant.manager.post(`/transfers/${cancellable.body.id}/cancel`);
    expect(managerCancel.status).toBe(403);
    expect(managerCancel.body.error.code).toBe('TRANSFER_CANCEL_FORBIDDEN');
    const cancelled = await tenant.clerk.post(`/transfers/${cancellable.body.id}/cancel`);
    assertStatus(cancelled, 200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const cancelAgain = await tenant.clerk.post(`/transfers/${cancellable.body.id}/cancel`);
    expect(cancelAgain.status).toBe(409);

    const selfOrder = await tenant.manager.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.secondLocationId,
      items: [{ productId: tenant.productId, quantity: '2' }],
    });
    assertStatus(selfOrder, 201);
    const selfApprove = await tenant.manager.post(`/transfers/${selfOrder.body.id}/approve`);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.code).toBe('TRANSFER_SEGREGATION');
    const ownerApproved = await tenant.owner.post(`/transfers/${selfOrder.body.id}/approve`);
    assertStatus(ownerApproved, 200);
    const ownerCompleted = await tenant.owner.post(`/transfers/${selfOrder.body.id}/complete`);
    assertStatus(ownerCompleted, 200);
    expect(await mainStock(tenant.productId)).toBe('18.000');
    expect(await secondStock(tenant.productId)).toBe('2.000');

    const sameBranch = await tenant.owner.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.mainLocationId,
      items: [{ productId: tenant.productId, quantity: '1' }],
    });
    expect(sameBranch.status).toBe(400);
    expect(sameBranch.body.error.code).toBe('SAME_LOCATION');

    const oversized = await tenant.owner.post('/transfers', {
      fromLocationId: tenant.mainLocationId,
      toLocationId: tenant.secondLocationId,
      items: [{ productId: tenant.secondaryProductId, quantity: '999' }],
    });
    assertStatus(oversized, 201);
    assertStatus(await tenant.manager.post(`/transfers/${oversized.body.id}/approve`), 200);
    const insufficient = await tenant.clerk.post(`/transfers/${oversized.body.id}/complete`);
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await mainStock(tenant.secondaryProductId)).toBe('10.000');
    expect(await secondStock(tenant.secondaryProductId)).toBe('2.000');

    assertStatus(await other.owner.get(`/transfers/${selfOrder.body.id}`), 404);
  });
});

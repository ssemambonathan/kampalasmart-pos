import type { TestContext, Tenant } from './helpers';
import {
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
  stockOf,
} from './helpers';

describe('Offline sync: push, replay, conflicts and bootstrap', () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;

  const deviceKey = (label: string) => `device-${tenant.suffix}-${label}`;

  const offlineSale = (overrides: Record<string, unknown> = {}) => ({
    locationId: tenant.mainLocationId,
    occurredAt: new Date().toISOString(),
    items: [{ productId: tenant.productId, quantity: '1' }],
    payments: [{ method: 'CASH', amount: '11800.00' }],
    ...overrides,
  });

  const push = (
    client: Tenant['cashier'],
    events: Array<{ clientId: string; type?: string; payload: Record<string, unknown> }>,
    key = deviceKey('till'),
  ) =>
    client.post('/sync/push', {
      deviceKey: key,
      events: events.map((event) => ({ type: 'SALE', ...event })),
    });

  const count = (value: string) => Number(value);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Sync');
    other = await setupTenant(ctx.server, ctx.prisma, 'SyncOther');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('registers the same device once and refreshes its details', async () => {
    const first = await tenant.cashier.post('/sync/register', {
      deviceKey: deviceKey('register'),
      name: 'Front till',
      platform: 'android',
    });
    assertStatus(first, 201);

    const second = await tenant.cashier.post('/sync/register', {
      deviceKey: deviceKey('register'),
      name: 'Front till (renamed)',
    });
    assertStatus(second, 201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.name).toBe('Front till (renamed)');
    expect(second.body.platform).toBe('android');

    const rows = await ctx.prisma.device.findMany({
      where: { businessId: tenant.businessId, deviceKey: deviceKey('register') },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(tenant.cashierId);

    const short = await tenant.cashier.post('/sync/register', { deviceKey: 'short' });
    assertStatus(short, 400);
  });

  it('accepts an offline sale, applies server pricing and replays idempotently', async () => {
    const before = count(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId));
    const clientId = `sync-${tenant.suffix}-sale-1`;

    const accepted = await push(tenant.cashier, [
      {
        clientId,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '2' }],
          payments: [{ method: 'CASH', amount: '24000.00' }],
          notes: 'Queued while offline',
        }),
      },
    ]);
    assertStatus(accepted, 201);
    expect(accepted.body.results).toHaveLength(1);

    const result = accepted.body.results[0];
    expect(result.clientId).toBe(clientId);
    expect(result.status).toBe('SYNCED');
    expect(result.saleNumber).toMatch(/^SALE-\d+$/);
    expect(result.sale.id).toBe(result.saleId);
    expect(result.sale.isOffline).toBe(true);
    expect(result.sale.cashierId).toBe(tenant.cashierId);
    expect(result.sale.subtotal).toBe('20000.00');
    expect(result.sale.taxTotal).toBe('3600.00');
    expect(result.sale.total).toBe('23600.00');
    expect(result.sale.change).toBe('400.00');
    expect(result.sale.createdAt.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

    const snapshot = accepted.body.inventory.find(
      (level: { productId: string }) => level.productId === tenant.productId,
    );
    expect(snapshot.quantity).toBe((before - 2).toFixed(3));
    expect(accepted.body.deviceId).toBeTruthy();
    expect(typeof accepted.body.serverTime).toBe('string');

    const device = await ctx.prisma.device.findUnique({
      where: { id: accepted.body.deviceId },
    });
    expect(device?.lastSyncAt).not.toBeNull();

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: result.saleId, action: 'sale.created' },
    });
    expect((audit?.after as any).offline).toBe(true);
    expect((audit?.after as any).clientId).toBe(clientId);

    const replay = await push(tenant.cashier, [
      {
        clientId,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '2' }],
          payments: [{ method: 'CASH', amount: '24000.00' }],
        }),
      },
    ]);
    assertStatus(replay, 201);
    expect(replay.body.results[0].status).toBe('SYNCED');
    expect(replay.body.results[0].saleId).toBe(result.saleId);
    expect(replay.body.results[0].saleNumber).toBe(result.saleNumber);

    expect(
      await ctx.prisma.sale.count({
        where: { businessId: tenant.businessId, clientId },
      }),
    ).toBe(1);
    const movements = await ctx.prisma.inventoryMovement.count({
      where: { referenceType: 'SALE', referenceId: result.saleId },
    });
    expect(movements).toBe(1);
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(
      (before - 2).toFixed(3),
    );
  });

  it('rejects tampered prices from cashiers while allowing an authorised override', async () => {
    const before = count(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId));

    const tampered = await push(tenant.cashier, [
      {
        clientId: `sync-${tenant.suffix}-cheap`,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '1', unitPrice: '1.00' }],
          payments: [{ method: 'CASH', amount: '118.00' }],
        }),
      },
    ]);
    assertStatus(tampered, 201);
    expect(tampered.body.results[0].status).toBe('FAILED');
    expect(tampered.body.results[0].error.code).toBe('PRICE_OVERRIDE_FORBIDDEN');
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(
      before.toFixed(3),
    );

    const authorised = await push(tenant.manager, [
      {
        clientId: `sync-${tenant.suffix}-manager-price`,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '1', unitPrice: '9000.00' }],
          payments: [{ method: 'CASH', amount: '10620.00' }],
        }),
      },
    ]);
    assertStatus(authorised, 201);
    const result = authorised.body.results[0];
    expect(result.status).toBe('SYNCED');
    expect(result.sale.subtotal).toBe('9000.00');
    expect(result.sale.taxTotal).toBe('1620.00');
    expect(result.sale.total).toBe('10620.00');
    expect(result.sale.cashierId).toBe(tenant.managerId);
    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(
      (before - 1).toFixed(3),
    );
  });

  it('records stock and catalogue conflicts against the client event', async () => {
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);
    const stockId = `sync-${tenant.suffix}-stock`;
    const missingId = `sync-${tenant.suffix}-missing`;

    const res = await push(tenant.cashier, [
      {
        clientId: stockId,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '999' }],
          payments: [{ method: 'CASH', amount: '99999999.00' }],
        }),
      },
      {
        clientId: missingId,
        payload: offlineSale({
          items: [{ productId: 'missing-product-id', quantity: '1' }],
          payments: [{ method: 'CASH', amount: '11800.00' }],
        }),
      },
    ]);
    assertStatus(res, 201);
    expect(res.body.results.map((result: { status: string }) => result.status)).toEqual([
      'CONFLICT',
      'CONFLICT',
    ]);
    const [stockConflict, missingConflict] = res.body.results;
    expect(stockConflict.error.code).toBe('INSUFFICIENT_STOCK');
    expect(stockConflict.conflicts).toHaveLength(1);
    expect(stockConflict.conflicts[0]).toMatchObject({
      productId: tenant.productId,
      requested: '999.000',
      available: before,
    });
    expect(missingConflict.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(missingConflict.conflicts).toEqual([]);

    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(before);

    const rows = await ctx.prisma.syncConflict.findMany({
      where: { businessId: tenant.businessId, clientId: { in: [stockId, missingId] } },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('OPEN');
      expect(row.type).toBe('SALE');
      expect(row.deviceId).not.toBeNull();
    }
    expect(rows.find((row) => row.clientId === stockId)?.reason).toBe('INSUFFICIENT_STOCK');
    expect(rows.find((row) => row.clientId === missingId)?.reason).toBe('PRODUCT_UNAVAILABLE');

    const notification = await ctx.prisma.notification.findFirst({
      where: { businessId: tenant.businessId, type: 'SYNC_CONFLICT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();

    const overview = await tenant.owner.get('/sync/overview');
    assertStatus(overview, 200);
    expect(overview.body.pendingConflicts).toBe(
      await ctx.prisma.syncConflict.count({
        where: { businessId: tenant.businessId, status: 'OPEN' },
      }),
    );
    expect(overview.body.devices.length).toBeGreaterThan(0);
    expect(overview.body.lastSyncAt).not.toBeNull();
  });

  it('limits conflict resolution to sync managers and audits the decision', async () => {
    const clientId = `sync-${tenant.suffix}-approval`;
    const seeded = await push(tenant.cashier, [
      {
        clientId,
        payload: offlineSale({
          items: [{ productId: tenant.productId, quantity: '999' }],
          payments: [{ method: 'CASH', amount: '99999999.00' }],
        }),
      },
    ]);
    assertStatus(seeded, 201);
    expect(seeded.body.results[0].status).toBe('CONFLICT');

    const conflict = await ctx.prisma.syncConflict.findFirstOrThrow({
      where: { businessId: tenant.businessId, clientId },
    });
    const openBefore = await ctx.prisma.syncConflict.count({
      where: { businessId: tenant.businessId, status: 'OPEN' },
    });

    const cashierOverview = await tenant.cashier.get('/sync/overview');
    assertStatus(cashierOverview, 403);
    const cashierResolve = await tenant.cashier.post(`/sync/conflicts/${conflict.id}/resolve`, {
      resolution: 'Accepted as is',
    });
    assertStatus(cashierResolve, 403);

    const foreign = await other.owner.post(`/sync/conflicts/${conflict.id}/resolve`, {
      resolution: 'Not mine to resolve',
    });
    assertStatus(foreign, 404);

    const tooShort = await tenant.manager.post(`/sync/conflicts/${conflict.id}/resolve`, {
      resolution: 'ok',
    });
    assertStatus(tooShort, 400);

    const resolved = await tenant.manager.post(`/sync/conflicts/${conflict.id}/resolve`, {
      resolution: 'Counted the remaining stock and accepted the sale manually.',
    });
    // Action endpoints are POSTs, so Nest answers with 201 by default.
    assertStatus(resolved, 201);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect(resolved.body.resolution).toContain('Counted the remaining stock');

    expect(
      await ctx.prisma.syncConflict.count({
        where: { businessId: tenant.businessId, status: 'OPEN' },
      }),
    ).toBe(openBefore - 1);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: {
        businessId: tenant.businessId,
        action: 'sync.conflict_resolved',
        entityId: conflict.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(tenant.managerId);
    expect((audit?.after as any).status).toBe('RESOLVED');

    const again = await tenant.manager.post(`/sync/conflicts/${conflict.id}/resolve`, {
      resolution: 'Resolved a second time',
    });
    assertStatus(again, 201);
    expect(again.body.status).toBe('RESOLVED');
    expect(
      await ctx.prisma.auditLog.count({
        where: { businessId: tenant.businessId, action: 'sync.conflict_resolved', entityId: conflict.id },
      }),
    ).toBe(1);
  });

  it('fails events dated in the future or beyond the offline retention window', async () => {
    const before = await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId);

    const res = await push(tenant.cashier, [
      {
        clientId: `sync-${tenant.suffix}-future`,
        payload: offlineSale({
          occurredAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        }),
      },
      {
        clientId: `sync-${tenant.suffix}-ancient`,
        payload: offlineSale({
          occurredAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        }),
      },
    ]);
    assertStatus(res, 201);
    expect(res.body.results.map((result: { status: string }) => result.status)).toEqual([
      'FAILED',
      'FAILED',
    ]);
    expect(res.body.results[0].error.code).toBe('INVALID_TIMESTAMP');
    expect(res.body.results[1].error.code).toBe('OFFLINE_SALE_TOO_OLD');

    expect(await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId)).toBe(before);
    expect(
      await ctx.prisma.syncConflict.count({
        where: {
          businessId: tenant.businessId,
          clientId: { in: [`sync-${tenant.suffix}-future`, `sync-${tenant.suffix}-ancient`] },
        },
      }),
    ).toBe(0);
  });

  it('rejects payload fields that are not part of the offline contract', async () => {
    const res = await push(tenant.cashier, [
      {
        clientId: `sync-${tenant.suffix}-extra`,
        payload: {
          ...offlineSale(),
          clientId: `sync-${tenant.suffix}-extra`,
        },
      },
    ]);
    assertStatus(res, 400);
    expect(JSON.stringify(res.body)).toContain('clientId should not exist');
  });

  it('requires sales permission to push and scopes devices to the tenant', async () => {
    const clerk = await push(tenant.clerk, [
      { clientId: `sync-${tenant.suffix}-clerk`, payload: offlineSale() },
    ]);
    assertStatus(clerk, 403);

    const foreignOverview = await other.owner.get('/sync/overview');
    assertStatus(foreignOverview, 200);
    const foreignConflictIds = foreignOverview.body.conflicts.map(
      (conflict: { id: string }) => conflict.id,
    );
    expect(foreignConflictIds).not.toContain(
      (await ctx.prisma.syncConflict.findFirstOrThrow({
        where: { businessId: tenant.businessId, status: 'OPEN' },
      })).id,
    );
  });

  it('bootstraps role-scoped branches, stock and products, then pulls changes', async () => {
    const taxRate = await tenant.owner.post('/settings/tax-rates', {
      name: 'VAT Sync',
      rate: '18',
      isInclusive: false,
    });
    assertStatus(taxRate, 201);

    const cashierBootstrap = await tenant.cashier.get('/sync/bootstrap');
    assertStatus(cashierBootstrap, 200);
    expect(cashierBootstrap.body.locations).toHaveLength(1);
    expect(cashierBootstrap.body.locations[0].id).toBe(tenant.mainLocationId);
    expect(cashierBootstrap.body.products).toHaveLength(2);
    expect(cashierBootstrap.body.taxRates).toContainEqual(
      expect.objectContaining({ id: taxRate.body.id, name: 'VAT Sync' }),
    );
    const level = cashierBootstrap.body.inventory.find(
      (entry: { productId: string }) => entry.productId === tenant.productId,
    );
    expect(level.quantity).toBe(
      await stockOf(ctx.prisma, tenant.mainLocationId, tenant.productId),
    );

    const managerBootstrap = await tenant.manager.get('/sync/bootstrap');
    assertStatus(managerBootstrap, 200);
    expect(managerBootstrap.body.locations.map((location: { id: string }) => location.id)).toEqual(
      expect.arrayContaining([tenant.mainLocationId, tenant.secondLocationId]),
    );

    const empty = await tenant.cashier.get('/sync/pull', { since: '2999-01-01T00:00:00.000Z' });
    assertStatus(empty, 200);
    expect(empty.body.products).toEqual([]);
    expect(empty.body.inventory).toEqual([]);
    expect(empty.body.customers).toEqual([]);

    const full = await tenant.cashier.get('/sync/pull', { since: '2000-01-01T00:00:00.000Z' });
    assertStatus(full, 200);
    expect(full.body.products).toHaveLength(2);
    expect(full.body.inventory).toHaveLength(2);

    const secondBranch = await tenant.cashier.get('/sync/pull', {
      since: '2000-01-01T00:00:00.000Z',
      locationId: tenant.secondLocationId,
    });
    assertStatus(secondBranch, 403);

    const managerSecondBranch = await tenant.manager.get('/sync/pull', {
      since: '2000-01-01T00:00:00.000Z',
      locationId: tenant.secondLocationId,
    });
    assertStatus(managerSecondBranch, 200);
    expect(
      managerSecondBranch.body.inventory.map((entry: { quantity: string }) => entry.quantity),
    ).toEqual(['0.000', '0.000']);

    const invalidSince = await tenant.cashier.get('/sync/pull', { since: 'not-a-date' });
    assertStatus(invalidSince, 400);
  });
});

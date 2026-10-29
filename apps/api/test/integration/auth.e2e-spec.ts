import * as bcrypt from 'bcryptjs';
import type { TestContext, Tenant } from './helpers';
import {
  ApiClient,
  assertStatus,
  createTestApp,
  resetDatabase,
  setupTenant,
} from './helpers';

describe('Authentication, CSRF, RBAC and tenant isolation', () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    tenant = await setupTenant(ctx.server, ctx.prisma, 'Mirembe');
    other = await setupTenant(ctx.server, ctx.prisma, 'Nakawa');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('registers a business, hashes the password and returns an owner session', async () => {
    const email = `fresh-${Date.now()}@example.test`;
    const client = new ApiClient(ctx.server);
    const res = await client.post('/auth/register', {
      businessName: 'Fresh Kiosk',
      ownerName: 'Fresh Owner',
      email,
      password: 'FreshPass123!',
    });
    assertStatus(res, 201);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.user.permissions).toContain('users:manage');
    expect(res.body.locations).toHaveLength(1);

    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toContain('FreshPass123!');
    expect(stored.passwordHash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('FreshPass123!', stored.passwordHash)).toBe(true);
  });

  it('rejects duplicate emails across businesses', async () => {
    const res = await new ApiClient(ctx.server).post('/auth/register', {
      businessName: 'Duplicate Co',
      ownerName: 'Duplicate Owner',
      email: tenant.ownerEmail,
      password: 'DuplicatePass123!',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('signs in, exposes the session and requires a CSRF token for mutations', async () => {
    const me = await tenant.owner.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(tenant.ownerEmail);
    expect(me.body.business.id).toBe(tenant.businessId);
    expect(me.body.locations.length).toBe(2);

    const saved = tenant.owner.csrf;
    tenant.owner.csrf = '';
    const withoutToken = await tenant.owner.post('/categories', { name: 'No CSRF' });
    expect(withoutToken.status).toBe(403);
    expect(withoutToken.body.error.code).toBe('CSRF_TOKEN_INVALID');
    tenant.owner.csrf = saved;

    const withToken = await tenant.owner.post('/categories', { name: 'With CSRF' });
    assertStatus(withToken, 201);
  });

  it('rejects a wrong password and locks an account after repeated failures', async () => {
    const email = `lock-${tenant.suffix}@example.test`;
    const created = await tenant.owner.post('/users', {
      name: 'Lock Test',
      email,
      role: 'CASHIER',
      password: 'LockedPass123!',
      locationIds: [tenant.mainLocationId],
    });
    assertStatus(created, 201);

    const client = new ApiClient(ctx.server);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await client.post('/auth/login', { email, password: 'WrongPass123!' });
      expect(res.status).toBe(401);
    }
    const fifth = await client.post('/auth/login', { email, password: 'WrongPass123!' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');

    const correct = await new ApiClient(ctx.server).post('/auth/login', {
      email,
      password: 'LockedPass123!',
    });
    expect(correct.status).toBe(423);

    const failures = await ctx.prisma.auditLog.count({
      where: { entityId: created.body.id, action: 'auth.login_failed' },
    });
    expect(failures).toBeGreaterThanOrEqual(5);
  });

  it('revokes the session on logout', async () => {
    const email = `session-${tenant.suffix}@example.test`;
    const created = await tenant.owner.post('/users', {
      name: 'Session Test',
      email,
      role: 'CASHIER',
      password: 'SessionPass123!',
      locationIds: [tenant.mainLocationId],
    });
    assertStatus(created, 201);

    const client = new ApiClient(ctx.server);
    await client.login(email, 'SessionPass123!');
    expect((await client.get('/auth/me')).status).toBe(200);

    const logout = await client.post('/auth/logout');
    expect(logout.status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
    expect((await client.post('/auth/refresh')).status).toBe(401);
  });

  it('enforces role permissions on the server', async () => {
    const cashierReports = await tenant.cashier.get('/reports/dashboard');
    expect(cashierReports.status).toBe(403);

    const clerkSale = await tenant.clerk.post('/sales', {
      locationId: tenant.mainLocationId,
      items: [{ productId: tenant.productId, quantity: '1' }],
      payments: [{ method: 'CASH', amount: '11800.00' }],
    });
    expect(clerkSale.status).toBe(403);

    const managerUsers = await tenant.manager.post('/users', {
      name: 'Not Allowed',
      email: `nope-${tenant.suffix}@example.test`,
      role: 'CASHIER',
      password: 'NotAllowed123!',
      locationIds: [tenant.mainLocationId],
    });
    expect(managerUsers.status).toBe(403);

    const cashierAdjust = await tenant.cashier.post('/inventory/adjustments', {
      locationId: tenant.mainLocationId,
      productId: tenant.productId,
      quantity: '1',
      reason: 'Cashier should not adjust',
      movementType: 'ADJUSTMENT_IN',
    });
    expect(cashierAdjust.status).toBe(403);

    const clerkAdjust = await tenant.clerk.post('/inventory/adjustments', {
      locationId: tenant.mainLocationId,
      productId: tenant.productId,
      quantity: '1',
      reason: 'Clerk received one unit',
      movementType: 'ADJUSTMENT_IN',
    });
    assertStatus(clerkAdjust, 201);

    const ownerUsers = await tenant.owner.get('/users');
    expect(ownerUsers.status).toBe(200);
  });

  it('does not expose another tenant’s products or users', async () => {
    const foreignProduct = await other.owner.get(`/products/${tenant.productId}`);
    expect(foreignProduct.status).toBe(404);

    const foreignUpdate = await other.owner.patch(`/products/${tenant.productId}`, {
      name: 'Hijacked',
    });
    expect(foreignUpdate.status).toBe(404);

    const list = await other.owner.get('/products');
    expect(list.status).toBe(200);
    const ids = (list.body.items ?? list.body.data ?? []).map((product: any) => product.id);
    expect(ids).not.toContain(tenant.productId);

    const foreignUser = await other.owner.get(`/users/${tenant.cashierId}`);
    expect(foreignUser.status).toBe(404);

    const ownProfile = await tenant.cashier.get('/auth/me');
    expect(ownProfile.status).toBe(200);
    expect(ownProfile.body.user.email).toContain(tenant.suffix);
  });

  it('blocks branch-scoped staff from selling at a branch they are not assigned to', async () => {
    const res = await tenant.cashier.post('/sales', {
      locationId: tenant.secondLocationId,
      items: [{ productId: tenant.productId, quantity: '1' }],
      payments: [{ method: 'CASH', amount: '11800.00' }],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
  });

  it('returns 401 for unauthenticated access', async () => {
    const res = await new ApiClient(ctx.server).get('/reports/dashboard');
    expect(res.status).toBe(401);
  });
});

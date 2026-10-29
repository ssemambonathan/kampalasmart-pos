import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'http';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';

export interface ApiResponse {
  status: number;
  body: any;
  headers: Record<string, any>;
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  server: Server;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, server: app.getHttpServer() as Server };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!tables.length) return;
  const list = tables.map((row) => `"${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

/** Cookie-aware API client: keeps the session and echoes the CSRF token. */
export class ApiClient {
  private readonly agent: any;
  csrf = '';
  userId = '';

  constructor(server: Server) {
    this.agent = request.agent(server);
  }

  private track(res: any): ApiResponse {
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const cookie of cookies) {
      const match = /(?:^|,\s*)ks_csrf=([^;,\s]*)/.exec(cookie);
      if (match) this.csrf = decodeURIComponent(match[1]);
    }
    return res as ApiResponse;
  }

  get(path: string, query?: Record<string, string | number | undefined>): any {
    let req = this.agent.get(`/api/v1${path}`);
    if (query) req = req.query(query);
    return req;
  }

  async post(path: string, body?: unknown): Promise<ApiResponse> {
    const req = this.agent.post(`/api/v1${path}`);
    if (this.csrf) req.set('x-csrf-token', this.csrf);
    return this.track(await req.send((body ?? {}) as object));
  }

  async patch(path: string, body?: unknown): Promise<ApiResponse> {
    const req = this.agent.patch(`/api/v1${path}`);
    if (this.csrf) req.set('x-csrf-token', this.csrf);
    return this.track(await req.send((body ?? {}) as object));
  }

  async delete(path: string): Promise<ApiResponse> {
    const req = this.agent.delete(`/api/v1${path}`);
    if (this.csrf) req.set('x-csrf-token', this.csrf);
    return this.track(await req);
  }

  async login(email: string, password: string): Promise<ApiResponse> {
    const res = await this.post('/auth/login', { email, password });
    assertStatus(res, 200);
    this.userId = res.body.user.id;
    return res;
  }
}

export function assertStatus(res: ApiResponse, expected: number): ApiResponse {
  if (res.status !== expected) {
    throw new Error(
      `Expected HTTP ${expected} but received ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res;
}

const STAFF_PASSWORD = 'StaffPass123!';

export interface Tenant {
  suffix: string;
  owner: ApiClient;
  manager: ApiClient;
  cashier: ApiClient;
  clerk: ApiClient;
  businessId: string;
  mainLocationId: string;
  secondLocationId: string;
  ownerId: string;
  managerId: string;
  cashierId: string;
  clerkId: string;
  categoryId: string;
  productId: string;
  productSku: string;
  secondaryProductId: string;
  secondaryProductSku: string;
  ownerEmail: string;
}

const PRODUCT_PRICE = '10000.00';
const PRODUCT_COST = '6000.00';

export async function setupTenant(
  server: Server,
  prisma: PrismaService,
  label: string,
  options: { staff?: boolean } = {},
): Promise<Tenant> {
  const suffix = `${label.replace(/[^a-z0-9]/gi, '').toLowerCase()}-${Date.now()
    .toString(36)
    .slice(-4)}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const owner = new ApiClient(server);
  const registered = await owner.post('/auth/register', {
    businessName: `${label} Trading`,
    ownerName: `${label} Owner`,
    email: ownerEmail,
    password: 'OwnerPass123!',
    currency: 'UGX',
  });
  assertStatus(registered, 201);
  const businessId = registered.body.business.id;
  const mainLocationId = registered.body.locations[0].id;
  owner.userId = registered.body.user.id;

  await prisma.business.update({
    where: { id: businessId },
    data: { plan: 'GROWTH' },
  });

  const settings = await owner.patch('/settings/business', {
    taxEnabled: true,
    taxRate: '18',
    refundApprovalThreshold: '50000',
    maxCashierDiscountPercent: '10',
  });
  assertStatus(settings, 200);

  const secondLocation = await owner.post('/locations', {
    name: 'Second Branch',
    code: `B${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`,
  });
  assertStatus(secondLocation, 201);

  const category = await owner.post('/categories', { name: `${label} Category` });
  assertStatus(category, 201);

  const product = await owner.post('/products', {
    name: `${label} Widget`,
    sku: `WID-${suffix.toUpperCase()}`,
    sellingPrice: PRODUCT_PRICE,
    costPrice: PRODUCT_COST,
    categoryId: category.body.id,
    openingQuantity: '20',
    openingLocationId: mainLocationId,
  });
  assertStatus(product, 201);

  const secondaryProduct = await owner.post('/products', {
    name: `${label} Secondary`,
    sku: `SEC-${suffix.toUpperCase()}`,
    sellingPrice: '5000.00',
    costPrice: '2000.00',
    categoryId: category.body.id,
    openingQuantity: '10',
    openingLocationId: mainLocationId,
  });
  assertStatus(secondaryProduct, 201);

  const staff = options.staff !== false;
  const manager = new ApiClient(server);
  const cashier = new ApiClient(server);
  const clerk = new ApiClient(server);
  let managerId = '';
  let cashierId = '';
  let clerkId = '';

  if (staff) {
    const managerEmail = `manager-${suffix}@example.test`;
    const cashierEmail = `cashier-${suffix}@example.test`;
    const clerkEmail = `clerk-${suffix}@example.test`;

    const createdManager = await owner.post('/users', {
      name: `${label} Manager`,
      email: managerEmail,
      role: 'MANAGER',
      password: STAFF_PASSWORD,
      locationIds: [mainLocationId, secondLocation.body.id],
    });
    assertStatus(createdManager, 201);
    managerId = createdManager.body.id;

    const createdCashier = await owner.post('/users', {
      name: `${label} Cashier`,
      email: cashierEmail,
      role: 'CASHIER',
      password: STAFF_PASSWORD,
      locationIds: [mainLocationId],
    });
    assertStatus(createdCashier, 201);
    cashierId = createdCashier.body.id;

    const createdClerk = await owner.post('/users', {
      name: `${label} Clerk`,
      email: clerkEmail,
      role: 'INVENTORY_CLERK',
      password: STAFF_PASSWORD,
      locationIds: [mainLocationId],
    });
    assertStatus(createdClerk, 201);
    clerkId = createdClerk.body.id;

    await manager.login(managerEmail, STAFF_PASSWORD);
    await cashier.login(cashierEmail, STAFF_PASSWORD);
    await clerk.login(clerkEmail, STAFF_PASSWORD);
  }

  return {
    suffix,
    owner,
    manager,
    cashier,
    clerk,
    businessId,
    mainLocationId,
    secondLocationId: secondLocation.body.id,
    ownerId: registered.body.user.id,
    managerId,
    cashierId,
    clerkId,
    categoryId: category.body.id,
    productId: product.body.id,
    productSku: product.body.sku,
    secondaryProductId: secondaryProduct.body.id,
    secondaryProductSku: secondaryProduct.body.sku,
    ownerEmail,
  };
}

export function stockOf(
  prisma: PrismaService,
  locationId: string,
  productId: string,
): Promise<string> {
  return prisma.inventoryLevel
    .findUnique({ where: { locationId_productId: { locationId, productId } } })
    .then((level) => level?.quantity.toFixed(3) ?? '0.000');
}

/**
 * KampalaSmart POS — deterministic demonstration seed.
 *
 * Creates two independent tenants, a realistic 60-day trading history with a
 * chronologically consistent inventory ledger, purchases, refunds, transfers,
 * stock counts, low-stock alerts, audit events and a demo sync conflict.
 *
 * The seed is destructive by design (it rebuilds the demo dataset) and refuses
 * to run when NODE_ENV=production unless ALLOW_PROD_SEED=true is set.
 *
 * Test credentials are printed at the end and documented in docs/DEMO.md.
 */
import {
  BusinessPlan,
  MovementType,
  PaymentMethod,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
  type Product,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Decimal, dec, money, priceCart, type PriceableProduct } from '@kampalasmart/shared';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date();
START.setMilliseconds(0);

const MASTER_PASSWORD = {
  owner: 'OwnerPass123!',
  manager: 'ManagerPass123!',
  cashier: 'CashierPass123!',
  cashier2: 'Cashier2Pass123!',
  inventory: 'InventoryPass123!',
  nakawa: 'NakawaPass123!',
};

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261026);
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const chance = (probability: number) => rng() < probability;
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
function weighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let target = rng() * total;
  for (const item of items) {
    target -= weight(item);
    if (target <= 0) return item;
  }
  return items[items.length - 1] as T;
}
function daysAgo(days: number, hour = between(8, 19), minute = between(0, 59)): Date {
  const date = new Date(START.getTime() - days * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date;
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
function q3(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(3).toFixed(3);
}
function nearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
type CategoryBlueprint = {
  name: string;
  code: string;
  supplier: string;
  exempt?: boolean;
  costRange: [number, number];
  products: string[];
  brands: string[];
};

const CATEGORY_BLUEPRINTS: CategoryBlueprint[] = [
  {
    name: 'Beverages',
    code: 'BEV',
    supplier: 'Kampala Beverage Distributors',
    costRange: [700, 4200],
    brands: ['Coca-Cola', 'Pepsi', 'Rwenzori', 'Nile', 'Club', 'Mirinda', 'Novida'],
    products: [
      'Coca-Cola 500ml', 'Pepsi 500ml', 'Fanta Orange 500ml', 'Sprite 500ml',
      'Mirinda 500ml', 'Novida Pineapple 300ml', 'Rwenzori Water 500ml',
      'Nile Special 330ml', 'Club Pilsener 330ml', 'Bell Lager 330ml',
      'Predator Energy 300ml', 'Sting Energy 250ml',
    ],
  },
  {
    name: 'Bakery',
    code: 'BAK',
    supplier: 'Fresh Foods Uganda',
    costRange: [900, 4800],
    brands: ['Fresh Bakery', 'Blue Band', 'Kampala Oven', 'Golden Crust'],
    products: [
      'Fresh White Bread 400g', 'Brown Bread 400g', 'Milk Bun', 'Doughnut',
      'Samosa', 'Mandazi', 'Chapati', 'Croissant', 'Blue Band Bread 400g',
      'Whole Meal Loaf 400g', 'Cinnamon Roll', 'Queen Cake',
    ],
  },
  {
    name: 'Groceries',
    code: 'GRO',
    supplier: 'Mukono Wholesalers Ltd',
    costRange: [1100, 9000],
    brands: ['Mukono', 'Ntake', 'Uganda Grown', 'Sunseed', 'Riham'],
    products: [
      'Rice 5kg', 'Sugar 2kg', 'Table Salt 1kg', 'Cooking Oil 2L', 'Posho 5kg',
      'Beans 2kg', 'Maize Flour 2kg', 'Wheat Flour 2kg', 'Spaghetti 500g',
      'Tomato Paste 400g', 'Baking Powder 100g', 'Tea Leaves 250g',
    ],
  },
  {
    name: 'Fresh Produce',
    code: 'FRH',
    supplier: 'Fresh Foods Uganda',
    exempt: true,
    costRange: [400, 6000],
    brands: ['Local Farm', 'Uganda Fresh', 'Kampala Market'],
    products: [
      'Tomatoes 1kg', 'Red Onions 1kg', 'Irish Potatoes 1kg', 'Carrots 1kg',
      'Cabbage (Medium)', 'Matooke Bunch', 'Mangoes 1kg', 'Oranges 1kg',
      'Avocado (Each)', 'Green Peppers 500g', 'Spinach Bunch', 'Passion Fruit 500g',
    ],
  },
  {
    name: 'Dairy & Eggs',
    code: 'DRY',
    supplier: 'Fresh Foods Uganda',
    costRange: [1300, 8500],
    brands: ['Fresh Dairy', 'Jesa', 'Pearl', 'Brookside'],
    products: [
      'Fresh Milk 500ml', 'Fresh Milk 1L', 'Yogurt 250ml', 'Butter 250g',
      'Ghee 500g', 'Cheese 200g', 'Eggs Tray (30)', 'Eggs (6 Pack)',
      'Sour Cream 200g', 'Mozzarella 250g', 'Cream 250ml', 'Flavoured Milk 300ml',
    ],
  },
  {
    name: 'Personal Care',
    code: 'PER',
    supplier: 'HomeCare Supplies UG',
    costRange: [1200, 13000],
    brands: ['Geisha', 'Colgate', 'Nivea', 'Always', 'Nice & Lovely', 'Rexona'],
    products: [
      'Bathing Soap 250g', 'Toothpaste 100ml', 'Toothbrush', 'Body Lotion 400ml',
      'Shampoo 250ml', 'Sanitary Pads 10s', 'Razor Pack', 'Deodorant 150ml',
      'Tissue Roll 4s', 'Petroleum Jelly 250ml', 'Baby Wipes 80s', 'Face Wash 150ml',
    ],
  },
  {
    name: 'Household',
    code: 'HOU',
    supplier: 'HomeCare Supplies UG',
    costRange: [1500, 17000],
    brands: ['Sunlight', 'Ariel', 'Harpic', 'Vim', 'Toss'],
    products: [
      'Washing Powder 1kg', 'Dish Soap 500ml', 'Bleach 750ml', 'Mop Set',
      'Broom', 'Plastic Bucket 20L', 'Matches (10 Boxes)', 'Candles (6 Pack)',
      'Mosquito Coil 10s', 'Garbage Bags 30s', 'Scrubbing Brush', 'Clothes Line 10m',
    ],
  },
  {
    name: 'Snacks',
    code: 'SNA',
    supplier: 'Mukono Wholesalers Ltd',
    costRange: [600, 5200],
    brands: ['Riham', 'Nuvita', 'Sombe', 'Krackers'],
    products: [
      'Potato Crisps 100g', 'Glucose Biscuits 200g', 'Milk Chocolate 80g',
      'Assorted Sweets 100g', 'Roasted Peanuts 200g', 'Popcorn 80g',
      'Chewing Gum Pack', 'Cookies 150g', 'Cream Crackers 200g',
      'Pretzels 120g', 'Wafer Bar 40g', 'Groundnuts 250g',
    ],
  },
  {
    name: 'Stationery',
    code: 'STA',
    supplier: 'Quality Stationery Uganda',
    costRange: [400, 7500],
    brands: ['Bic', 'Pelikan', 'Oxford', 'Kasuku'],
    products: [
      'Exercise Book 48 Pages', 'Exercise Book 96 Pages', 'Ballpoint Pen (Blue)',
      'Pencil HB', 'Ruler 30cm', 'Eraser', 'Pencil Sharpener', 'Crayons 12s',
      'Glue Stick', 'Scissors', 'Notebook A5', 'Permanent Marker',
    ],
  },
  {
    name: 'Mobile Accessories',
    code: 'MOB',
    supplier: 'Quality Stationery Uganda',
    costRange: [1800, 26000],
    brands: ['Samsung', 'Tecno', 'Itel', 'Universal', 'Oraimo'],
    products: [
      'USB-C Charger 20W', 'Micro USB Cable 1m', 'Wired Earphones',
      'Power Bank 10000mAh', 'Phone Case (Universal)', 'Screen Protector',
      'Memory Card 32GB', 'Bluetooth Speaker', 'Selfie Ring Light',
      'Car Charger Dual Port', 'Phone Holder', 'Type-C Cable 1m',
    ],
  },
];

const CUSTOMER_BLUEPRINTS = [
  { name: 'Aisha Nakato', phone: '+256701234001' },
  { name: 'John Mugisha', phone: '+256701234002' },
  { name: 'Restaurant Namirembe', phone: '+256701234003' },
  { name: 'Florence Auma', phone: '+256701234004' },
  { name: 'Ronald Byaruhanga', phone: '+256701234005' },
  { name: 'Susan Kirabo', phone: '+256701234006' },
  { name: 'Moses Waiswa', phone: '+256701234007' },
  { name: 'Brenda Nansubuga', phone: '+256701234008' },
  { name: 'Kato Hardware', phone: '+256701234009' },
  { name: 'Hakim Ssali', phone: '+256701234010' },
  { name: 'Joy Atim', phone: '+256701234011' },
  { name: 'Peter Kaweesa', phone: '+256701234012' },
];

const SUPPLIER_BLUEPRINTS = [
  {
    name: 'Kampala Beverage Distributors',
    contactName: 'Alice Mubiru',
    phone: '+256772100101',
    email: 'orders@kampalabeverages.example',
    address: 'Plot 12, Ndeeba, Kampala',
    notes: 'Delivers every Tuesday and Friday before 10am.',
  },
  {
    name: 'Fresh Foods Uganda',
    contactName: 'Joseph Ssentongo',
    phone: '+256772100102',
    email: 'supply@freshfoodsug.example',
    address: 'Nakasero Market, Kampala',
    notes: 'Perishables delivered daily. Reject damaged crates on delivery.',
  },
  {
    name: 'Mukono Wholesalers Ltd',
    contactName: 'Hadijah Nakimuli',
    phone: '+256772100103',
    email: 'sales@mukonowholesale.example',
    address: 'Mukono Industrial Area',
    notes: 'Minimum order UGX 300,000 for free delivery.',
  },
  {
    name: 'HomeCare Supplies UG',
    contactName: 'Samuel Kigozi',
    phone: '+256772100104',
    email: 'info@homecareug.example',
    address: 'Kireka, Wakiso',
    notes: 'Household and personal care distributor.',
  },
  {
    name: 'Quality Stationery Uganda',
    contactName: 'Rita Nabirye',
    phone: '+256772100105',
    email: 'orders@qualitystationery.example',
    address: 'Kikuubo Lane, Kampala',
    notes: 'Stationery and mobile accessories. 7-day lead time.',
  },
];

const SUPPLIER_BY_CATEGORY: Record<string, string> = {
  Beverages: 'Kampala Beverage Distributors',
  Bakery: 'Fresh Foods Uganda',
  Groceries: 'Mukono Wholesalers Ltd',
  'Fresh Produce': 'Fresh Foods Uganda',
  'Dairy & Eggs': 'Fresh Foods Uganda',
  'Personal Care': 'HomeCare Supplies UG',
  Household: 'HomeCare Supplies UG',
  Snacks: 'Mukono Wholesalers Ltd',
  Stationery: 'Quality Stationery Uganda',
  'Mobile Accessories': 'Quality Stationery Uganda',
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
type Tx = Prisma.TransactionClient;
type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  categoryName: string;
  supplierId: string;
  taxRateId: string;
  taxRate: number;
  sellingPrice: string;
  costPrice: string;
  reorderLevel: number;
  safetyStock: number;
  popularity: number;
  depleted: boolean;
  lowStock: boolean;
};

async function audit(
  tx: Tx,
  input: {
    businessId: string;
    action: string;
    entityType: string;
    entityId?: string;
    actor?: { id: string; name: string; role: string } | null;
    before?: unknown;
    after?: unknown;
    reason?: string;
    createdAt?: Date;
    metadata?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      businessId: input.businessId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
      actorRole: input.actor?.role ?? null,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      reason: input.reason ?? null,
      ip: '127.0.0.1',
      userAgent: 'KampalaSmart seed',
      metadata: input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
      createdAt: input.createdAt ?? new Date(),
    },
  });
}

class Ledger {
  private levels = new Map<string, Decimal>();

  constructor(
    private readonly tx: Tx,
    private readonly businessId: string,
    private readonly allowNegative: boolean,
  ) {}

  private key(locationId: string, productId: string) {
    return `${locationId}:${productId}`;
  }

  seed(levels: Array<{ locationId: string; productId: string; quantity: string }>) {
    for (const level of levels) {
      this.levels.set(this.key(level.locationId, level.productId), dec(level.quantity));
    }
  }

  quantity(locationId: string, productId: string): Decimal {
    return this.levels.get(this.key(locationId, productId)) ?? new Decimal(0);
  }

  decimals(locationId: string): Map<string, Decimal> {
    const output = new Map<string, Decimal>();
    for (const [key, value] of this.levels) {
      const [location, product] = key.split(':');
      if (location === locationId) output.set(product as string, value);
    }
    return output;
  }

  async move(input: {
    locationId: string;
    productId: string;
    movementType: MovementType;
    quantity: number | string;
    unitCost: number | string;
    referenceType?: string;
    referenceId?: string;
    performedBy?: string | null;
    reason?: string | null;
    note?: string | null;
    at: Date;
  }) {
    const key = this.key(input.locationId, input.productId);
    const current = this.levels.get(key) ?? new Decimal(0);
    const delta = dec(input.quantity);
    if (delta.isZero()) throw new Error('Ledger movement cannot be zero');
    const next = current.plus(delta);
    if (next.isNegative() && !this.allowNegative) {
      throw new Error(
        `Seed ledger would oversell product ${input.productId} at ${input.locationId} (${next.toFixed(3)})`,
      );
    }
    this.levels.set(key, next);
    await this.tx.inventoryLevel.update({
      where: {
        locationId_productId: { locationId: input.locationId, productId: input.productId },
      },
      data: { quantity: q3(next) },
    });
    const totalCost = money(dec(input.quantity).abs().times(dec(input.unitCost)));
    await this.tx.inventoryMovement.create({
      data: {
        businessId: this.businessId,
        locationId: input.locationId,
        productId: input.productId,
        movementType: input.movementType,
        quantity: q3(input.quantity),
        unitCost: money(input.unitCost),
        totalCost,
        balanceAfter: q3(next),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        performedBy: input.performedBy ?? null,
        reason: input.reason ?? null,
        note: input.note ?? null,
        createdAt: input.at,
      },
    });
    return next;
  }
}

function counterFactory() {
  const counters = new Map<string, number>();
  const prefixes: Record<string, string> = {
    SALE: 'SALE',
    REFUND: 'REF',
    PURCHASE: 'PO',
    PURCHASE_RETURN: 'PRET',
    TRANSFER: 'TRF',
  };
  return {
    next(type: keyof typeof prefixes): string {
      const value = (counters.get(type) ?? 0) + 1;
      counters.set(type, value);
      return `${prefixes[type]}-${String(value).padStart(6, '0')}`;
    },
    async persist(tx: Tx, businessId: string) {
      for (const [docType, value] of counters) {
        await tx.documentCounter.upsert({
          where: { businessId_docType: { businessId, docType } },
          create: { businessId, docType, nextValue: value + 1 },
          update: { nextValue: value + 1 },
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant 1: Mirembe Mini Mart (three branches, 60 days of history)
// ---------------------------------------------------------------------------
async function seedMirembe() {
  const business = await prisma.business.create({
    data: {
      name: 'Mirembe Mini Mart',
      slug: 'mirembe-mini-mart',
      currency: 'UGX',
      timezone: 'Africa/Kampala',
      locale: 'en-UG',
      phone: '+256 700 123 456',
      email: 'hello@mirembeminimart.example',
      address: 'Plot 48, Kampala Road, Kampala',
      taxEnabled: true,
      taxInclusive: false,
      taxRate: 18,
      allowNegativeStock: false,
      maxCashierDiscountPercent: 5,
      maxManagerDiscountPercent: 20,
      refundApprovalThreshold: 50_000,
      defaultLeadTimeDays: 3,
      receiptFooter: 'Thank you for shopping with Mirembe Mini Mart. Goods are exchangeable within 7 days with a receipt.',
      plan: BusinessPlan.GROWTH,
      subscriptionStatus: SubscriptionStatus.TRIAL,
      trialEndsAt: addDays(START, 21),
    },
  });
  const businessId = business.id;

  const locations = await prisma.$transaction(async (tx) => {
    const main = await tx.location.create({
      data: {
        businessId,
        name: 'Main Branch',
        code: 'MAIN',
        address: 'Plot 48, Kampala Road, Kampala',
        phone: '+256 700 123 456',
        isDefault: true,
      },
    });
    const kira = await tx.location.create({
      data: {
        businessId,
        name: 'Kira Road Branch',
        code: 'KIRA',
        address: 'Kira Road, Kamwokya, Kampala',
        phone: '+256 700 123 457',
      },
    });
    const ntinda = await tx.location.create({
      data: {
        businessId,
        name: 'Ntinda Branch',
        code: 'NTINDA',
        address: 'Ntinda Trading Centre, Kampala',
        phone: '+256 700 123 458',
      },
    });
    return { main, kira, ntinda };
  });

  const passwordHashes = await Promise.all(
    Object.values(MASTER_PASSWORD).map(async (password) => [password, await bcrypt.hash(password, 12)] as const),
  );
  const hashFor = new Map(passwordHashes);

  const users = await prisma.$transaction(async (tx) => {
    const created = {
      owner: await tx.user.create({
        data: {
          businessId,
          name: 'Sarah Namusoke',
          email: 'owner@mirembe.test',
          passwordHash: hashFor.get(MASTER_PASSWORD.owner)!,
          role: 'OWNER',
          emailVerifiedAt: addDays(START, -120),
          lastLoginAt: START,
        },
      }),
      manager: await tx.user.create({
        data: {
          businessId,
          name: 'Daniel Okello',
          email: 'manager@mirembe.test',
          passwordHash: hashFor.get(MASTER_PASSWORD.manager)!,
          role: 'MANAGER',
          emailVerifiedAt: addDays(START, -118),
          lastLoginAt: addDays(START, -1),
        },
      }),
      cashier: await tx.user.create({
        data: {
          businessId,
          name: 'Grace Achieng',
          email: 'cashier@mirembe.test',
          passwordHash: hashFor.get(MASTER_PASSWORD.cashier)!,
          role: 'CASHIER',
          emailVerifiedAt: addDays(START, -110),
          lastLoginAt: START,
        },
      }),
      cashier2: await tx.user.create({
        data: {
          businessId,
          name: 'Brian Ssemakula',
          email: 'cashier2@mirembe.test',
          passwordHash: hashFor.get(MASTER_PASSWORD.cashier2)!,
          role: 'CASHIER',
          emailVerifiedAt: addDays(START, -100),
          lastLoginAt: addDays(START, -2),
        },
      }),
      inventory: await tx.user.create({
        data: {
          businessId,
          name: 'Moses Kato',
          email: 'inventory@mirembe.test',
          passwordHash: hashFor.get(MASTER_PASSWORD.inventory)!,
          role: 'INVENTORY_CLERK',
          emailVerifiedAt: addDays(START, -105),
          lastLoginAt: addDays(START, -3),
        },
      }),
    };

    const assignments: Array<[string, string[]]> = [
      [created.owner.id, [locations.main.id, locations.kira.id, locations.ntinda.id]],
      [created.manager.id, [locations.main.id, locations.kira.id, locations.ntinda.id]],
      [created.cashier.id, [locations.main.id, locations.kira.id]],
      [created.cashier2.id, [locations.ntinda.id]],
      [created.inventory.id, [locations.main.id]],
    ];
    for (const [userId, locationIds] of assignments) {
      for (const locationId of locationIds) {
        await tx.userLocation.create({ data: { userId, locationId, businessId } });
      }
    }
    return created;
  });

  const [vat, exempt] = await prisma.$transaction(async (tx) => [
    await tx.taxRate.create({
      data: { businessId, name: 'VAT 18%', rate: 18, isDefault: true },
    }),
    await tx.taxRate.create({
      data: { businessId, name: 'Exempt', rate: 0 },
    }),
  ]);

  const categories = new Map<string, { id: string; name: string; exempt?: boolean }>();
  for (const blueprint of CATEGORY_BLUEPRINTS) {
    const category = await prisma.category.create({
      data: {
        businessId,
        name: blueprint.name,
        description: `${blueprint.name} sold at Mirembe Mini Mart`,
      },
    });
    categories.set(blueprint.name, { id: category.id, name: category.name, exempt: blueprint.exempt });
  }

  const suppliers = new Map<string, string>();
  for (const supplier of SUPPLIER_BLUEPRINTS) {
    const created = await prisma.supplier.create({
      data: { businessId, ...supplier },
    });
    suppliers.set(supplier.name, created.id);
  }

  const customers = [];
  for (const customer of CUSTOMER_BLUEPRINTS) {
    customers.push(
      await prisma.customer.create({
        data: {
          businessId,
          name: customer.name,
          phone: customer.phone,
          email: `${customer.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
        },
      }),
    );
  }

  // ---- Products -----------------------------------------------------------
  const catalog: CatalogProduct[] = [];
  let productIndex = 0;
  for (const blueprint of CATEGORY_BLUEPRINTS) {
    const category = categories.get(blueprint.name)!;
    for (let i = 0; i < blueprint.products.length; i += 1) {
      const name = blueprint.products[i] as string;
      const cost = nearest(
        between(blueprint.costRange[0], blueprint.costRange[1]),
        50,
      );
      const markup = between(20, 48);
      const selling = nearest(cost * (1 + markup / 100), 100);
      const depleted = productIndex % 31 === 7;
      const lowStock = productIndex % 23 === 5;
      const popularity = i < 2 ? 6 : i < 6 ? 3 : 1;
      const sku = `MIR-${blueprint.code}-${String(i + 1).padStart(3, '0')}`;
      const barcode = String(2_000_000_000_000 + productIndex * 17);
      const created = await prisma.product.create({
        data: {
          businessId,
          categoryId: category.id,
          supplierId: suppliers.get(SUPPLIER_BY_CATEGORY[blueprint.name]!)!,
          taxRateId: blueprint.exempt ? exempt.id : vat.id,
          name,
          sku,
          barcode,
          brand: pick(blueprint.brands),
          description: `${name} — everyday low price at Mirembe Mini Mart.`,
          sellingPrice: selling.toFixed(2),
          costPrice: cost.toFixed(2),
          reorderLevel: String(between(10, 25)),
          safetyStock: String(between(5, 12)),
          leadTimeDays: between(2, 7),
          unit: blueprint.name === 'Fresh Produce' ? 'kg' : 'piece',
          trackStock: true,
        },
      });
      catalog.push({
        id: created.id,
        name: created.name,
        sku: created.sku,
        barcode,
        categoryName: blueprint.name,
        supplierId: created.supplierId!,
        taxRateId: created.taxRateId!,
        taxRate: blueprint.exempt ? 0 : 18,
        sellingPrice: selling.toFixed(2),
        costPrice: cost.toFixed(2),
        reorderLevel: Number(created.reorderLevel),
        safetyStock: Number(created.safetyStock),
        popularity,
        depleted,
        lowStock,
      });
      productIndex += 1;
    }
  }

  // ---- Opening balances (-90 days) ---------------------------------------
  const openingAt = daysAgo(90, 9, 0);
  await prisma.$transaction(async (tx) => {
    const rows: Prisma.InventoryLevelCreateManyInput[] = [];
    const movements: Prisma.InventoryMovementCreateManyInput[] = [];
    for (const product of catalog) {
      for (const location of [locations.main, locations.kira, locations.ntinda]) {
        const base = location.id === locations.main.id ? 1 : location.id === locations.kira.id ? 0.6 : 0.4;
        let quantity = 0;
        if (!product.depleted) {
          const scale = product.lowStock ? 0.06 : 1;
          quantity = Math.max(
            product.lowStock ? 4 : 10,
            Math.round(between(35, 160) * base * scale),
          );
        }
        rows.push({
          businessId,
          locationId: location.id,
          productId: product.id,
          quantity: q3(quantity),
        });
        if (quantity > 0) {
          movements.push({
            businessId,
            locationId: location.id,
            productId: product.id,
            movementType: MovementType.OPENING_BALANCE,
            quantity: q3(quantity),
            unitCost: product.costPrice,
            totalCost: money(dec(quantity).times(product.costPrice)),
            balanceAfter: q3(quantity),
            referenceType: 'OPENING',
            performedBy: users.inventory.id,
            reason: 'Opening stock count at go-live',
            createdAt: openingAt,
          });
        }
      }
    }
    await tx.inventoryLevel.createMany({ data: rows });
    await tx.inventoryMovement.createMany({ data: movements });
  });

  const counters = counterFactory();
  const ledger = new Ledger(prisma as unknown as Tx, businessId, false);

  // Load initial levels for the in-memory ledger.
  {
    const levels = await prisma.inventoryLevel.findMany({
      where: { businessId },
      select: { locationId: true, productId: true, quantity: true },
    });
    ledger.seed(
      levels.map((level) => ({
        locationId: level.locationId,
        productId: level.productId,
        quantity: level.quantity.toFixed(3),
      })),
    );
  }

  const taxEnabled = true;
  const actorFor = (role: 'owner' | 'manager' | 'cashier' | 'cashier2' | 'inventory') => {
    const user = users[role];
    return { id: user.id, name: user.name, role: user.role };
  };

  // ---- Device for offline demonstration ----------------------------------
  const device = await prisma.device.create({
    data: {
      businessId,
      deviceKey: 'seed-main-counter-1',
      name: 'Main Counter 1 (Tablet)',
      platform: 'Android tablet — Chrome PWA',
      lastSeenAt: START,
      lastSyncAt: new Date(START.getTime() - 12 * 60 * 1000),
      userId: users.cashier.id,
    },
  });

  // ---- Event stream -------------------------------------------------------
  type SeedEvent = {
    at: Date;
    order: number;
    label: string;
    run: () => Promise<void>;
  };
  const events: SeedEvent[] = [];
  let eventOrder = 0;
  const schedule = (at: Date, label: string, run: () => Promise<void>) => {
    events.push({ at, order: eventOrder++, label, run });
  };

  type SaleIntent = {
    key: string;
    at: Date;
    location: typeof locations.main;
    cashier: (typeof users)[keyof typeof users];
    itemCount: number;
    customerId: string | null;
    paymentMethod: PaymentMethod;
    cartDiscountPercent: number;
    offline: boolean;
  };

  // ---- Purchases ----------------------------------------------------------
  const purchasePlan = [
    { key: 'po-1', at: daysAgo(78, 10, 15), items: 6, received: true },
    { key: 'po-2', at: daysAgo(55, 11, 0), items: 7, received: true },
    { key: 'po-3', at: daysAgo(42, 9, 30), items: 5, received: true },
    { key: 'po-4', at: daysAgo(30, 10, 45), items: 6, received: true },
    { key: 'po-5', at: daysAgo(18, 14, 10), items: 5, received: true },
    { key: 'po-6', at: daysAgo(9, 9, 50), items: 6, received: true },
    { key: 'po-7', at: daysAgo(3, 8, 40), items: 4, received: true },
    { key: 'po-8', at: daysAgo(1, 15, 20), items: 4, received: false },
  ];
  const purchaseIds = new Map<string, string>();

  for (const plan of purchasePlan) {
    schedule(plan.at, `purchase ${plan.key}`, async () => {
      await prisma.$transaction(async (tx) => {
        const supplierName = pick(SUPPLIER_BLUEPRINTS).name;
        const supplierId = suppliers.get(supplierName)!;
        const available = catalog.filter(
          (product) => product.supplierId === supplierId && !product.depleted && !product.lowStock,
        );
        const chosen: CatalogProduct[] = [];
        const pool = [...available];
        for (let i = 0; i < plan.items && pool.length > 0; i += 1) {
          chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as CatalogProduct);
        }
        const location = chance(0.75) ? locations.main : locations.kira;
        const items = chosen.map((product) => {
          const quantity = between(40, 140);
          const unitCost = money(dec(product.costPrice).times(1 + between(0, 4) / 100));
          return {
            product,
            quantity,
            unitCost,
            lineTotal: money(dec(unitCost).times(quantity)),
          };
        });
        const subtotal = money(
          items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0)),
        );
        const status = plan.received ? 'RECEIVED' : 'ORDERED';
        const purchase = await tx.purchase.create({
          data: {
            businessId,
            locationId: location.id,
            supplierId,
            purchaseNumber: counters.next('PURCHASE'),
            status,
            reference: `SUP-${between(1000, 9999)}`,
            subtotal,
            total: subtotal,
            notes: plan.received ? 'Goods received and checked in.' : 'Awaiting delivery. Supplier confirmed dispatch.',
            createdBy: users.inventory.id,
            createdAt: plan.at,
            receivedAt: plan.received ? plan.at : null,
            items: {
              create: items.map((item) => ({
                productId: item.product.id,
                quantity: q3(item.quantity),
                receivedQuantity: plan.received ? q3(item.quantity) : '0.000',
                unitCost: item.unitCost,
                lineTotal: item.lineTotal,
              })),
            },
          },
        });
        purchaseIds.set(plan.key, purchase.id);
        if (plan.received) {
          for (const item of items) {
            await ledger.move({
              locationId: location.id,
              productId: item.product.id,
              movementType: MovementType.PURCHASE,
              quantity: item.quantity,
              unitCost: item.unitCost,
              referenceType: 'PURCHASE',
              referenceId: purchase.id,
              performedBy: users.inventory.id,
              reason: plan.received ? 'Goods received' : null,
              at: plan.at,
            });
          }
        }
        await audit(tx, {
          businessId,
          action: plan.received ? 'purchase.received' : 'purchase.created',
          entityType: 'Purchase',
          entityId: purchase.id,
          actor: actorFor('inventory'),
          after: { purchaseNumber: purchase.purchaseNumber, status: purchase.status, total: subtotal },
          createdAt: plan.at,
        });
      });
    });
  }

  // Partially received purchase, demonstrating partial receiving.
  const partialAt = daysAgo(2, 11, 25);
  schedule(partialAt, 'purchase po-9 partial receipt', async () => {
    await prisma.$transaction(async (tx) => {
      const supplierId = suppliers.get('Mukono Wholesalers Ltd')!;
      const chosen = catalog
        .filter((product) => product.supplierId === supplierId && !product.depleted && !product.lowStock)
        .slice(0, 3);
      const items = chosen.map((product, index) => {
        const ordered = 60 + index * 20;
        const received = index === 2 ? 0 : Math.floor(ordered / 2);
        return {
          product,
          ordered,
          received,
          unitCost: product.costPrice,
          lineTotal: money(dec(product.costPrice).times(ordered)),
        };
      });
      const purchase = await tx.purchase.create({
        data: {
          businessId,
          locationId: locations.main.id,
          supplierId,
          purchaseNumber: counters.next('PURCHASE'),
          status: 'PARTIALLY_RECEIVED',
          reference: 'SUP-PARTIAL-2291',
          subtotal: money(items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0))),
          total: money(items.reduce((sum, item) => sum.plus(item.lineTotal), new Decimal(0))),
          notes: 'Supplier delivered partial order. Balance promised next week.',
          createdBy: users.inventory.id,
          createdAt: partialAt,
          receivedAt: partialAt,
          items: {
            create: items.map((item) => ({
              productId: item.product.id,
              quantity: q3(item.ordered),
              receivedQuantity: q3(item.received),
              unitCost: item.unitCost,
              lineTotal: item.lineTotal,
            })),
          },
        },
      });
      purchaseIds.set('po-9', purchase.id);
      for (const item of items) {
        if (item.received > 0) {
          await ledger.move({
            locationId: locations.main.id,
            productId: item.product.id,
            movementType: MovementType.PURCHASE,
            quantity: item.received,
            unitCost: item.unitCost,
            referenceType: 'PURCHASE',
            referenceId: purchase.id,
            performedBy: users.inventory.id,
            reason: 'Partial delivery received',
            at: partialAt,
          });
        }
      }
      await audit(tx, {
        businessId,
        action: 'purchase.received',
        entityType: 'Purchase',
        entityId: purchase.id,
        actor: actorFor('inventory'),
        after: { purchaseNumber: purchase.purchaseNumber, status: purchase.status },
        createdAt: partialAt,
      });
    });
  });

  // Purchase return against po-3.
  const returnAt = addDays(daysAgo(42, 9, 30), 4);
  schedule(returnAt, 'purchase return', async () => {
    const purchaseId = purchaseIds.get('po-3');
    if (!purchaseId) return;
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { items: true },
    });
    if (!purchase) return;
    await prisma.$transaction(async (tx) => {
      const first = purchase.items[0];
      if (!first) return;
      const quantity = 3;
      const unitCost = first.unitCost.toFixed(2);
      const total = money(dec(unitCost).times(quantity));
      const created = await tx.purchaseReturn.create({
        data: {
          businessId,
          purchaseId,
          locationId: purchase.locationId,
          supplierId: purchase.supplierId,
          returnNumber: counters.next('PURCHASE_RETURN'),
          reason: 'Three units arrived damaged and were returned to the supplier.',
          total,
          createdBy: users.inventory.id,
          createdAt: returnAt,
          items: { create: [{ productId: first.productId, quantity: q3(quantity), unitCost, lineTotal: total }] },
        },
      });
      await ledger.move({
        locationId: purchase.locationId,
        productId: first.productId,
        movementType: MovementType.PURCHASE_RETURN,
        quantity: -quantity,
        unitCost,
        referenceType: 'PURCHASE_RETURN',
        referenceId: created.id,
        performedBy: users.inventory.id,
        reason: 'Damaged on delivery',
        at: returnAt,
      });
      await audit(tx, {
        businessId,
        action: 'purchase.returned',
        entityType: 'PurchaseReturn',
        entityId: created.id,
        actor: actorFor('inventory'),
        after: { returnNumber: created.returnNumber, total },
        createdAt: returnAt,
      });
    });
  });

  // ---- Sales intents ------------------------------------------------------
  const salesIntents: SaleIntent[] = [];
  let saleCounter = 0;
  for (let day = 59; day >= 0; day -= 1) {
    const weekday = new Date(START.getTime() - day * DAY_MS).getDay();
    const weekendBoost = weekday === 0 || weekday === 6 ? 2 : 0;
    const count = between(4, 7) + weekendBoost;
    for (let i = 0; i < count; i += 1) {
      const locationChooser = rng();
      const location =
        locationChooser < 0.52 ? locations.main : locationChooser < 0.82 ? locations.kira : locations.ntinda;
      const cashier =
        location.id === locations.main.id
          ? chance(0.78)
            ? users.cashier
            : chance(0.5)
              ? users.owner
              : users.manager
          : location.id === locations.kira.id
            ? users.cashier
            : users.cashier2;
      const paymentChooser = rng();
      const paymentMethod =
        paymentChooser < 0.6
          ? PaymentMethod.CASH
          : paymentChooser < 0.88
            ? PaymentMethod.MOBILE_MONEY
            : paymentChooser < 0.96
              ? PaymentMethod.CARD
              : PaymentMethod.BANK_TRANSFER;
      const key = `sale-${saleCounter++}`;
      const at = daysAgo(day, between(8, 19), between(0, 59));
      if (at.getTime() > START.getTime() - 60 * 60 * 1000) at.setTime(START.getTime() - 60 * 60 * 1000);
      salesIntents.push({
        key,
        at,
        location,
        cashier,
        itemCount: between(1, 5),
        customerId: chance(0.22) ? pick(customers).id : null,
        paymentMethod,
        cartDiscountPercent: cashier.role === 'CASHIER' ? (chance(0.09) ? between(1, 4) : 0) : chance(0.14) ? between(5, 12) : 0,
        offline: location.id === locations.main.id && chance(0.1),
      });
    }
  }

  const saleResults = new Map<
    string,
    {
      id: string;
      saleNumber: string;
      at: Date;
      locationId: string;
      cashierId: string;
      status: string;
      paymentMethod: PaymentMethod;
      items: Array<{
        id: string;
        productId: string;
        quantity: string;
        unitPrice: string;
        lineTotal: string;
        taxAmount: string;
        unitCost: string;
        refundedQuantity: Decimal;
      }>;
    }
  >();

  for (const intent of salesIntents) {
    schedule(intent.at, `sale ${intent.key}`, async () => {
      const stock = ledger.decimals(intent.location.id);
      const available = catalog.filter((product) => {
        if (product.depleted) return false;
        const quantity = stock.get(product.id);
        return quantity !== undefined && quantity.greaterThan(0);
      });
      if (available.length === 0) return;

      const lines: Array<{ product: CatalogProduct; quantity: number; stock: Decimal }> = [];
      const pool = [...available];
      const wanted = Math.min(intent.itemCount, pool.length);
      for (let i = 0; i < wanted; i += 1) {
        const product = weighted(pool, (entry) => (entry as CatalogProduct).popularity);
        pool.splice(pool.indexOf(product), 1);
        const quantity = Math.min(between(1, 3), stock.get(product.id)!.toNumber());
        if (quantity <= 0) continue;
        lines.push({ product, quantity, stock: stock.get(product.id)! });
      }
      if (lines.length === 0) return;

      const priceables = new Map<string, PriceableProduct>();
      for (const line of lines) {
        priceables.set(line.product.id, {
          id: line.product.id,
          name: line.product.name,
          sku: line.product.sku,
          sellingPrice: line.product.sellingPrice,
          costPrice: line.product.costPrice,
          taxRate: line.product.taxRate,
          taxInclusive: false,
          trackStock: true,
          stock: line.stock,
        });
      }
      const priced = priceCart(
        lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          lineDiscount: chance(0.03) ? { type: 'PERCENT' as const, value: 5 } : null,
        })),
        priceables,
        {
          taxEnabled,
          allowNegativeStock: false,
          cartDiscount: intent.cartDiscountPercent
            ? { type: 'PERCENT' as const, value: intent.cartDiscountPercent }
            : null,
        },
      );

      const paymentReference =
        intent.paymentMethod === PaymentMethod.MOBILE_MONEY
          ? `MM-${between(10000000, 99999999)}`
          : intent.paymentMethod === PaymentMethod.CARD
            ? `CARD-${between(100000, 999999)}`
            : intent.paymentMethod === PaymentMethod.BANK_TRANSFER
              ? `BT-${between(100000, 999999)}`
              : null;
      const syncedAt = intent.offline ? new Date(intent.at.getTime() + 95_000) : null;

      const sale = await prisma.$transaction(async (tx) => {
        const created = await tx.sale.create({
          data: {
            businessId,
            locationId: intent.location.id,
            saleNumber: counters.next('SALE'),
            customerId: intent.customerId,
            cashierId: intent.cashier.id,
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            taxTotal: priced.taxTotal,
            total: priced.total,
            costTotal: priced.costTotal,
            notes: intent.offline ? 'Captured offline and synchronised automatically.' : null,
            idempotencyKey: null,
            clientId: intent.offline ? `seed-client-${intent.key}` : null,
            isOffline: Boolean(intent.offline),
            deviceId: intent.offline ? device.id : null,
            syncedAt,
            createdAt: intent.at,
            updatedAt: intent.at,
            items: {
              create: priced.lines.map((line) => ({
                productId: line.productId,
                productName: line.name,
                sku: line.sku,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineDiscount: line.lineDiscount,
                cartDiscount: line.cartDiscount,
                discountAmount: line.discountAmount,
                taxRate: line.taxRate,
                taxAmount: line.taxAmount,
                lineTotal: line.lineTotal,
                unitCost: line.unitCost,
                totalCost: line.totalCost,
              })),
            },
            payments: {
              create: {
                businessId,
                method: intent.paymentMethod,
                amount: priced.total,
                reference: paymentReference,
                status: 'COMPLETED',
                provider: 'MANUAL',
                metadata: { source: intent.offline ? 'offline-sync' : 'pos' },
                createdBy: intent.cashier.id,
                createdAt: intent.at,
              },
            },
          },
          include: { items: true },
        });

        for (const line of priced.lines) {
          await ledger.move({
            locationId: intent.location.id,
            productId: line.productId,
            movementType: MovementType.SALE,
            quantity: `-${line.quantity}`,
            unitCost: line.unitCost,
            referenceType: 'SALE',
            referenceId: created.id,
            performedBy: intent.cashier.id,
            at: intent.at,
          });
        }
        await audit(tx, {
          businessId,
          action: intent.offline ? 'sale.synced_offline' : 'sale.completed',
          entityType: 'Sale',
          entityId: created.id,
          actor: { id: intent.cashier.id, name: intent.cashier.name, role: intent.cashier.role },
          after: {
            saleNumber: created.saleNumber,
            total: priced.total,
            taxTotal: priced.taxTotal,
            paymentMethod: intent.paymentMethod,
            itemCount: priced.itemCount,
            offline: Boolean(intent.offline),
          },
          createdAt: intent.at,
        });
        await tx.auditLog.create({
          data: {
            businessId,
            action: 'payment.received',
            entityType: 'Payment',
            entityId: created.id,
            actorId: intent.cashier.id,
            actorName: intent.cashier.name,
            actorRole: intent.cashier.role,
            after: { method: intent.paymentMethod, amount: priced.total, reference: paymentReference },
            createdAt: intent.at,
          },
        });
        return created;
      });

      saleResults.set(intent.key, {
        id: sale.id,
        saleNumber: sale.saleNumber,
        at: intent.at,
        locationId: intent.location.id,
        cashierId: intent.cashier.id,
        status: sale.status,
        paymentMethod: intent.paymentMethod,
        items: sale.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          quantity: item.quantity.toFixed(3),
          unitPrice: item.unitPrice.toFixed(2),
          lineTotal: item.lineTotal.toFixed(2),
          taxAmount: item.taxAmount.toFixed(2),
          unitCost: item.unitCost.toFixed(2),
          refundedQuantity: new Decimal(item.refundedQuantity.toFixed(3)),
        })),
      });
    });
  }

  // Refund intents for roughly 5% of sales, at least a day afterwards.
  const refundTargets = salesIntents.filter(() => chance(0.05));
  for (const target of refundTargets) {
    const at = addDays(target.at, between(1, 2));
    if (at.getTime() > START.getTime() - 3 * 60 * 60 * 1000) continue;
    schedule(at, `refund ${target.key}`, async () => {
      const original = saleResults.get(target.key);
      if (!original) return;
      const item = original.items.find(
        (entry) => new Decimal(entry.quantity).minus(entry.refundedQuantity).greaterThanOrEqualTo(1),
      );
      if (!item) return;
      const quantity = new Decimal(item.quantity).equals(1) ? 1 : between(1, Math.max(1, Math.floor(Number(item.quantity)) - 1));
      const ratio = new Decimal(quantity).dividedBy(item.quantity);
      const amount = money(new Decimal(item.lineTotal).times(ratio));
      const tax = money(new Decimal(item.taxAmount).times(ratio));
      const cost = money(new Decimal(item.unitCost).times(quantity));

      await prisma.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            businessId,
            saleId: original.id,
            locationId: original.locationId,
            refundNumber: counters.next('REFUND'),
            reason: pick([
              'Customer changed mind about the item.',
              'Item was damaged when opened at home.',
              'Wrong flavour selected by customer.',
              'Customer returned an item bought in error.',
            ]),
            status: 'COMPLETED',
            total: amount,
            taxTotal: tax,
            costTotal: cost,
            method: original.paymentMethod,
            reference: `REF-${between(100000, 999999)}`,
            restock: true,
            requestedBy: original.cashierId,
            approvedBy: users.manager.id,
            approvedAt: at,
            completedAt: at,
            createdAt: at,
            updatedAt: at,
            items: {
              create: [
                {
                  saleItemId: item.id,
                  productId: item.productId,
                  quantity: q3(quantity),
                  amount,
                  restock: true,
                },
              ],
            },
          },
        });
        const remaining = new Decimal(item.quantity).minus(item.refundedQuantity);
        const newRefunded = item.refundedQuantity.plus(quantity);
        await tx.saleItem.update({
          where: { id: item.id },
          data: { refundedQuantity: q3(newRefunded) },
        });
        const allRefunded = await tx.saleItem.findMany({
          where: { saleId: original.id },
          select: { quantity: true, refundedQuantity: true },
        });
        const fullyRefunded = allRefunded.every((line) =>
          new Decimal(line.refundedQuantity).greaterThanOrEqualTo(line.quantity),
        );
        await tx.sale.update({
          where: { id: original.id },
          data: { status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED', updatedAt: at },
        });
        if (remaining.greaterThanOrEqualTo(quantity)) {
          await ledger.move({
            locationId: original.locationId,
            productId: item.productId,
            movementType: MovementType.SALE_RETURN,
            quantity,
            unitCost: item.unitCost,
            referenceType: 'REFUND',
            referenceId: refund.id,
            performedBy: users.manager.id,
            reason: 'Customer refund — item restocked',
            at,
          });
        }
        await audit(tx, {
          businessId,
          action: 'refund.completed',
          entityType: 'Refund',
          entityId: refund.id,
          actor: actorFor('manager'),
          after: {
            refundNumber: refund.refundNumber,
            saleNumber: original.saleNumber,
            total: amount,
            restocked: true,
          },
          reason: 'Manager approved customer refund',
          createdAt: at,
        });
      });
    });
  }

  // ---- Completed stock transfer ------------------------------------------
  const transferAt = daysAgo(10, 15, 30);
  schedule(transferAt, 'stock transfer MAIN -> KIRA', async () => {
    const mainStock = ledger.decimals(locations.main.id);
    const candidates = catalog.filter((product) => {
      if (product.depleted || product.lowStock) return false;
      const quantity = mainStock.get(product.id);
      return quantity !== undefined && quantity.greaterThanOrEqualTo(12);
    });
    const chosen: Array<{ product: CatalogProduct; quantity: number }> = [];
    const pool = [...candidates];
    for (let i = 0; i < 4 && pool.length > 0; i += 1) {
      const product = pool.splice(Math.floor(rng() * pool.length), 1)[0] as CatalogProduct;
      chosen.push({ product, quantity: between(4, 8) });
    }
    if (chosen.length === 0) return;
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          businessId,
          transferNumber: counters.next('TRANSFER'),
          fromLocationId: locations.main.id,
          toLocationId: locations.kira.id,
          status: 'COMPLETED',
          notes: 'Weekly replenishment for Kira Road branch.',
          requestedBy: users.inventory.id,
          approvedBy: users.manager.id,
          approvedAt: transferAt,
          completedAt: transferAt,
          createdAt: transferAt,
          updatedAt: transferAt,
          items: {
            create: chosen.map((entry) => ({
              productId: entry.product.id,
              quantity: q3(entry.quantity),
              unitCost: entry.product.costPrice,
            })),
          },
        },
      });
      for (const entry of chosen) {
        await ledger.move({
          locationId: locations.main.id,
          productId: entry.product.id,
          movementType: MovementType.TRANSFER_OUT,
          quantity: -entry.quantity,
          unitCost: entry.product.costPrice,
          referenceType: 'TRANSFER',
          referenceId: transfer.id,
          performedBy: users.inventory.id,
          reason: 'Transfer to Kira Road Branch',
          at: transferAt,
        });
        await ledger.move({
          locationId: locations.kira.id,
          productId: entry.product.id,
          movementType: MovementType.TRANSFER_IN,
          quantity: entry.quantity,
          unitCost: entry.product.costPrice,
          referenceType: 'TRANSFER',
          referenceId: transfer.id,
          performedBy: users.inventory.id,
          reason: 'Transfer from Main Branch',
          at: transferAt,
        });
      }
      await audit(tx, {
        businessId,
        action: 'transfer.completed',
        entityType: 'StockTransfer',
        entityId: transfer.id,
        actor: actorFor('manager'),
        after: { transferNumber: transfer.transferNumber, items: chosen.length },
        createdAt: transferAt,
      });
    });
  });

  // Pending transfer awaiting approval (no stock movement yet).
  const pendingTransferAt = daysAgo(1, 14, 5);
  schedule(pendingTransferAt, 'pending stock transfer', async () => {
    const mainStock = ledger.decimals(locations.main.id);
    const product = catalog.find(
      (entry) => !entry.depleted && (mainStock.get(entry.id)?.greaterThan(20) ?? false),
    );
    if (!product) return;
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          businessId,
          transferNumber: counters.next('TRANSFER'),
          fromLocationId: locations.main.id,
          toLocationId: locations.ntinda.id,
          status: 'PENDING',
          notes: 'Requested by Ntinda branch for weekend demand.',
          requestedBy: users.inventory.id,
          createdAt: pendingTransferAt,
          updatedAt: pendingTransferAt,
          items: {
            create: [{ productId: product.id, quantity: '6.000', unitCost: product.costPrice }],
          },
        },
      });
      await audit(tx, {
        businessId,
        action: 'transfer.created',
        entityType: 'StockTransfer',
        entityId: transfer.id,
        actor: actorFor('inventory'),
        after: { transferNumber: transfer.transferNumber, status: 'PENDING' },
        createdAt: pendingTransferAt,
      });
      await tx.notification.create({
        data: {
          businessId,
          userId: users.manager.id,
          type: 'TRANSFER_PENDING',
          severity: 'WARNING',
          title: 'Stock transfer awaiting approval',
          body: `${transfer.transferNumber} requests ${product.name} from Main Branch to Ntinda.`,
          data: { transferId: transfer.id },
          createdAt: pendingTransferAt,
        },
      });
    });
  });

  // ---- Stock adjustments / reconciliation --------------------------------
  const damageAt = daysAgo(6, 16, 10);
  schedule(damageAt, 'damage adjustment', async () => {
    const mainStock = ledger.decimals(locations.main.id);
    const candidates = catalog.filter((product) => {
      const quantity = mainStock.get(product.id);
      return !product.depleted && quantity !== undefined && quantity.greaterThan(5);
    });
    const chosen = candidates.slice(0, 2);
    if (chosen.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const product of chosen) {
        const before = ledger.quantity(locations.main.id, product.id);
        const quantity = Math.min(between(2, 4), before.toNumber() - 1);
        if (quantity <= 0) continue;
        const after = await ledger.move({
          locationId: locations.main.id,
          productId: product.id,
          movementType: MovementType.DAMAGE,
          quantity: -quantity,
          unitCost: product.costPrice,
          performedBy: users.inventory.id,
          reason: 'Packaging damaged during shelf restocking',
          note: 'Written off after supervisor inspection.',
          at: damageAt,
        });
        await audit(tx, {
          businessId,
          action: 'inventory.adjusted',
          entityType: 'InventoryMovement',
          entityId: product.id,
          actor: actorFor('inventory'),
          before: { product: product.name, quantity: before.toFixed(3) },
          after: { product: product.name, quantity: after.toFixed(3) },
          reason: 'Damaged goods write-off',
          createdAt: damageAt,
        });
      }
    });
  });

  const countAt = daysAgo(2, 18, 0);
  schedule(countAt, 'stock count reconciliation', async () => {
    const mainStock = ledger.decimals(locations.main.id);
    const candidates = catalog.filter((product) => {
      const quantity = mainStock.get(product.id);
      return !product.depleted && quantity !== undefined && quantity.greaterThan(10);
    });
    const chosen = candidates.slice(-2);
    if (chosen.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const [index, product] of chosen.entries()) {
        const before = ledger.quantity(locations.main.id, product.id);
        const variance = index === 0 ? -between(1, 3) : between(1, 2);
        const after = await ledger.move({
          locationId: locations.main.id,
          productId: product.id,
          movementType: variance > 0 ? MovementType.ADJUSTMENT_IN : MovementType.ADJUSTMENT_OUT,
          quantity: variance,
          unitCost: product.costPrice,
          performedBy: users.manager.id,
          reason: index === 0 ? 'Physical count lower than system stock' : 'Physical count higher than system stock',
          note: 'Monthly reconciliation count',
          at: countAt,
        });
        await audit(tx, {
          businessId,
          action: 'inventory.reconciled',
          entityType: 'InventoryMovement',
          entityId: product.id,
          actor: actorFor('manager'),
          before: { product: product.name, quantity: before.toFixed(3) },
          after: { product: product.name, quantity: after.toFixed(3) },
          reason: index === 0 ? 'Stock count shortage' : 'Stock count surplus',
          createdAt: countAt,
        });
      }
    });
  });

  // ---- Execute in chronological order ------------------------------------
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);
  for (const event of events) {
    try {
      await event.run();
    } catch (error) {
      console.error(`Seed event failed: ${event.label}`);
      throw error;
    }
  }

  // ---- Pending refunds for the approval workflow -------------------------
  const recentSales = [...saleResults.values()]
    .filter((sale) => sale.status === 'COMPLETED' && START.getTime() - sale.at.getTime() > DAY_MS)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 2);
  for (const [index, sale] of recentSales.entries()) {
    const requestedAt = new Date(Math.min(START.getTime() - 45 * 60 * 1000, sale.at.getTime() + 7 * 60 * 60 * 1000));
    const item = sale.items[0];
    if (!item) continue;
    const amount = money(item.lineTotal);
    await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          businessId,
          saleId: sale.id,
          locationId: sale.locationId,
          refundNumber: counters.next('REFUND'),
          reason: index === 0 ? 'Customer reports the product was expired.' : 'Customer returned an unwanted item.',
          status: 'PENDING',
          total: amount,
          taxTotal: item.taxAmount,
          costTotal: money(dec(item.unitCost).times(item.quantity)),
          method: sale.paymentMethod,
          restock: index === 0,
          requestedBy: sale.cashierId,
          createdAt: requestedAt,
          updatedAt: requestedAt,
          items: {
            create: [
              {
                saleItemId: item.id,
                productId: item.productId,
                quantity: item.quantity,
                amount,
                restock: index === 0,
              },
            ],
          },
        },
      });
      await tx.notification.create({
        data: {
          businessId,
          userId: users.manager.id,
          type: 'REFUND_PENDING',
          severity: 'WARNING',
          title: 'Refund awaiting approval',
          body: `${refund.refundNumber} for ${amount} UGX needs manager approval.`,
          data: { refundId: refund.id, saleId: sale.id },
          createdAt: requestedAt,
        },
      });
      await audit(tx, {
        businessId,
        action: 'refund.requested',
        entityType: 'Refund',
        entityId: refund.id,
        actor: actorFor('cashier'),
        after: { refundNumber: refund.refundNumber, total: amount, status: 'PENDING' },
        createdAt: requestedAt,
      });
    });
  }

  // ---- Low stock notifications -------------------------------------------
  const finalLevels = await prisma.inventoryLevel.findMany({
    where: { businessId, locationId: locations.main.id },
    include: { product: { select: { id: true, name: true, reorderLevel: true, safetyStock: true } } },
  });
  const low = finalLevels
    .filter((level) => level.quantity.lessThanOrEqualTo(level.product.reorderLevel))
    .sort((a, b) => a.quantity.comparedTo(b.quantity));
  for (const level of low.slice(0, 6)) {
    const critical = level.quantity.lessThanOrEqualTo(level.product.safetyStock);
    await prisma.notification.create({
      data: {
        businessId,
        type: critical ? 'CRITICAL_STOCK' : 'LOW_STOCK',
        severity: critical ? 'CRITICAL' : 'WARNING',
        title: critical ? `Out of stock risk: ${level.product.name}` : `Low stock: ${level.product.name}`,
        body: `${level.product.name} has ${level.quantity.toFixed(0)} units at Main Branch (reorder level ${level.product.reorderLevel.toFixed(0)}).`,
        data: {
          productId: level.product.id,
          locationId: locations.main.id,
          quantity: level.quantity.toFixed(3),
          reorderLevel: level.product.reorderLevel.toFixed(3),
        },
        createdAt: new Date(START.getTime() - 30 * 60 * 1000),
      },
    });
  }

  // ---- Demo sync conflict ------------------------------------------------
  const conflictProduct = catalog.find((product) => !product.depleted) ?? catalog[0]!;
  await prisma.syncConflict.create({
    data: {
      businessId,
      deviceId: device.id,
      clientId: 'seed-offline-conflict-1',
      type: 'STOCK_SHORTAGE',
      reason:
        'An offline sale recorded 7 units while only 4 remained on the server at sync time. Nothing was overwritten; a manager must decide how to reconcile.',
      details: {
        sales: [
          { clientId: 'seed-offline-sale-a', quantity: 4, recordedAt: daysAgo(1, 12, 15).toISOString() },
          { clientId: 'seed-offline-sale-b', quantity: 3, recordedAt: daysAgo(1, 12, 40).toISOString() },
        ],
        productId: conflictProduct.id,
        productName: conflictProduct.name,
        locationId: locations.main.id,
        locationName: 'Main Branch',
        serverAvailableAtSync: 4,
        requestedTotal: 7,
      },
      createdAt: daysAgo(1, 13, 5),
    },
  });
  await prisma.notification.create({
    data: {
      businessId,
      userId: users.manager.id,
      type: 'SYNC_CONFLICT',
      severity: 'CRITICAL',
      title: 'Offline sync conflict needs review',
      body: `Main Counter 1 synced sales that exceed recorded stock for ${conflictProduct.name}. Stock history was preserved.`,
      data: { clientId: 'seed-offline-conflict-1' },
      createdAt: daysAgo(1, 13, 6),
    },
  });

  // ---- Tenant-level audit trail ------------------------------------------
  await audit(prisma as unknown as Tx, {
    businessId,
    action: 'business.created',
    entityType: 'Business',
    entityId: businessId,
    actor: actorFor('owner'),
    after: { name: business.name, plan: business.plan, currency: business.currency },
    createdAt: daysAgo(130, 10, 0),
  });
  for (const role of ['owner', 'manager', 'cashier', 'cashier2', 'inventory'] as const) {
    await audit(prisma as unknown as Tx, {
      businessId,
      action: 'user.created',
      entityType: 'User',
      entityId: users[role].id,
      actor: actorFor('owner'),
      after: { email: users[role].email, role: users[role].role },
      createdAt: daysAgo(129, 11, 0),
    });
  }
  const priceChangeProduct = catalog[0]!;
  await audit(prisma as unknown as Tx, {
    businessId,
    action: 'product.price_changed',
    entityType: 'Product',
    entityId: priceChangeProduct.id,
    actor: actorFor('manager'),
    before: { sellingPrice: '3000.00' },
    after: { sellingPrice: priceChangeProduct.sellingPrice },
    reason: 'Supplier price reduction passed to customers',
    createdAt: daysAgo(20, 16, 30),
  });
  await audit(prisma as unknown as Tx, {
    businessId,
    action: 'settings.updated',
    entityType: 'Business',
    entityId: businessId,
    actor: actorFor('owner'),
    before: { maxCashierDiscountPercent: '3.00', refundApprovalThreshold: '30000.00' },
    after: { maxCashierDiscountPercent: '5.00', refundApprovalThreshold: '50000.00' },
    reason: 'Quarterly policy review',
    createdAt: daysAgo(45, 9, 15),
  });

  await prisma.notification.create({
    data: {
      businessId,
      type: 'SYSTEM',
      severity: 'INFO',
      title: 'Welcome to KampalaSmart POS',
      body: 'Your demonstration workspace is ready. Open the POS to start selling, or review the seeded reports.',
      createdAt: daysAgo(90, 8, 0),
    },
  });

  await counters.persist(prisma as unknown as Tx, businessId);
  return {
    business,
    users,
    locations: Object.values(locations),
    productCount: catalog.length,
    sales: saleResults.size,
  };
}

// ---------------------------------------------------------------------------
// Tenant 2: Nakawa Electronics Hub (isolation proof)
// ---------------------------------------------------------------------------
async function seedNakawa() {
  const business = await prisma.business.create({
    data: {
      name: 'Nakawa Electronics Hub',
      slug: 'nakawa-electronics-hub',
      currency: 'UGX',
      timezone: 'Africa/Kampala',
      locale: 'en-UG',
      phone: '+256 780 555 222',
      email: 'shop@nakawaelectronics.example',
      address: 'Nakawa Market, Block B, Kampala',
      taxEnabled: true,
      taxRate: 18,
      maxCashierDiscountPercent: 3,
      maxManagerDiscountPercent: 15,
      refundApprovalThreshold: 100_000,
      receiptFooter: 'Nakawa Electronics Hub — genuine electronics, fair prices.',
      plan: BusinessPlan.STARTER,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
  });

  const location = await prisma.location.create({
    data: {
      businessId: business.id,
      name: 'Nakawa Shop',
      code: 'SHOP',
      address: 'Nakawa Market, Block B, Kampala',
      isDefault: true,
    },
  });

  const passwordHash = await bcrypt.hash(MASTER_PASSWORD.nakawa, 12);
  const owner = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Peter Lubega',
      email: 'owner@nakawa.test',
      passwordHash,
      role: 'OWNER',
      emailVerifiedAt: daysAgo(200, 9, 0),
      lastLoginAt: daysAgo(0, 8, 0),
    },
  });
  await prisma.userLocation.create({
    data: { userId: owner.id, locationId: location.id, businessId: business.id },
  });

  const vat = await prisma.taxRate.create({
    data: { businessId: business.id, name: 'VAT 18%', rate: 18, isDefault: true },
  });
  const category = await prisma.category.create({
    data: { businessId: business.id, name: 'Consumer Electronics' },
  });
  const supplier = await prisma.supplier.create({
    data: {
      businessId: business.id,
      name: 'Nakawa Import Partners',
      contactName: 'Winnie Nakabugo',
      phone: '+256 780 555 333',
      email: 'supply@nakawaimports.example',
    },
  });
  const customer = await prisma.customer.create({
    data: { businessId: business.id, name: 'Walk-in Customer', phone: null },
  });

  const catalog = [
    { name: 'LED Bulb 9W', cost: 2800, price: 4500, barcode: '2000000900001' },
    { name: 'Extension Socket 4-Way', cost: 9500, price: 15000, barcode: '2000000900002' },
    { name: 'Rechargeable Torch', cost: 14000, price: 22000, barcode: '2000000900003' },
    { name: 'Phone Charger 20W', cost: 12000, price: 20000, barcode: '2000000900004' },
    { name: 'USB Cable Type-C', cost: 4000, price: 8000, barcode: '2000000900005' },
    { name: 'Earphones Wired', cost: 7000, price: 12000, barcode: '2000000900006' },
    { name: 'Power Bank 10000mAh', cost: 45000, price: 68000, barcode: '2000000900007' },
    { name: 'Bluetooth Speaker Mini', cost: 38000, price: 58000, barcode: '2000000900008' },
    { name: 'Memory Card 32GB', cost: 18000, price: 28000, barcode: '2000000900009' },
    { name: 'Phone Screen Protector', cost: 3000, price: 7000, barcode: '2000000900010' },
  ];

  const products: Product[] = [];
  for (const [index, item] of catalog.entries()) {
    products.push(
      await prisma.product.create({
        data: {
          businessId: business.id,
          categoryId: category.id,
          supplierId: supplier.id,
          taxRateId: vat.id,
          name: item.name,
          sku: `NAK-ELC-${String(index + 1).padStart(3, '0')}`,
          barcode: item.barcode,
          brand: 'Generic',
          sellingPrice: item.price.toFixed(2),
          costPrice: item.cost.toFixed(2),
          reorderLevel: '5.000',
          safetyStock: '2.000',
          trackStock: true,
        },
      }),
    );
  }

  const openingAt = daysAgo(30, 9, 0);
  const openingQty = [24, 16, 12, 20, 30, 18, 8, 6, 14, 25];
  await prisma.$transaction(async (tx) => {
    await tx.inventoryLevel.createMany({
      data: products.map((product, index) => ({
        businessId: business.id,
        locationId: location.id,
        productId: product.id,
        quantity: q3(openingQty[index] ?? 10),
      })),
    });
    await tx.inventoryMovement.createMany({
      data: products.map((product, index) => ({
        businessId: business.id,
        locationId: location.id,
        productId: product.id,
        movementType: MovementType.OPENING_BALANCE,
        quantity: q3(openingQty[index] ?? 10),
        unitCost: product.costPrice.toFixed(2),
        totalCost: money(dec(product.costPrice).times(openingQty[index] ?? 10)),
        balanceAfter: q3(openingQty[index] ?? 10),
        referenceType: 'OPENING',
        performedBy: owner.id,
        reason: 'Opening stock count',
        createdAt: openingAt,
      })),
    });
  });

  const counters = counterFactory();
  const ledger = new Ledger(prisma as unknown as Tx, business.id, false);
  ledger.seed(
    products.map((product, index) => ({
      locationId: location.id,
      productId: product.id,
      quantity: q3(openingQty[index] ?? 10),
    })),
  );

  const saleDays = [10, 9, 8, 6, 5, 3, 2, 1, 0];
  for (const [index, day] of saleDays.entries()) {
    const at = daysAgo(day, between(9, 18), between(0, 59));
    const itemCount = between(1, 2);
    const chosen = products.slice((index * 2) % 8, ((index * 2) % 8) + itemCount);
    const priceables = new Map<string, PriceableProduct>();
    for (const product of chosen) {
      priceables.set(product.id, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        sellingPrice: product.sellingPrice.toFixed(2),
        costPrice: product.costPrice.toFixed(2),
        taxRate: 18,
        taxInclusive: false,
        trackStock: true,
        stock: ledger.quantity(location.id, product.id),
      });
    }
    const priced = priceCart(
      chosen.map((product) => ({ productId: product.id, quantity: 1 })),
      priceables,
      { taxEnabled: true },
    );
    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          businessId: business.id,
          locationId: location.id,
          saleNumber: counters.next('SALE'),
          customerId: index % 3 === 0 ? customer.id : null,
          cashierId: owner.id,
          subtotal: priced.subtotal,
          discountTotal: priced.discountTotal,
          taxTotal: priced.taxTotal,
          total: priced.total,
          costTotal: priced.costTotal,
          createdAt: at,
          updatedAt: at,
          items: {
            create: priced.lines.map((line) => ({
              productId: line.productId,
              productName: line.name,
              sku: line.sku,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineDiscount: line.lineDiscount,
              cartDiscount: line.cartDiscount,
              discountAmount: line.discountAmount,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              unitCost: line.unitCost,
              totalCost: line.totalCost,
            })),
          },
          payments: {
            create: {
              businessId: business.id,
              method: index % 4 === 0 ? 'MOBILE_MONEY' : 'CASH',
              amount: priced.total,
              reference: index % 4 === 0 ? `MM-${between(10000000, 99999999)}` : null,
              status: 'COMPLETED',
              provider: 'MANUAL',
              createdBy: owner.id,
              createdAt: at,
            },
          },
        },
      });
      for (const line of priced.lines) {
        await ledger.move({
          locationId: location.id,
          productId: line.productId,
          movementType: MovementType.SALE,
          quantity: `-${line.quantity}`,
          unitCost: line.unitCost,
          referenceType: 'SALE',
          referenceId: sale.id,
          performedBy: owner.id,
          at,
        });
      }
      await audit(tx, {
        businessId: business.id,
        action: 'sale.completed',
        entityType: 'Sale',
        entityId: sale.id,
        actor: { id: owner.id, name: owner.name, role: owner.role },
        after: { saleNumber: sale.saleNumber, total: priced.total },
        createdAt: at,
      });
    });
  }

  await audit(prisma as unknown as Tx, {
    businessId: business.id,
    action: 'business.created',
    entityType: 'Business',
    entityId: business.id,
    actor: { id: owner.id, name: owner.name, role: owner.role },
    after: { name: business.name, plan: business.plan },
    createdAt: daysAgo(60, 10, 0),
  });
  await counters.persist(prisma as unknown as Tx, business.id);
  return { business, owner, productCount: products.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to run the destructive demo seed in production. Set ALLOW_PROD_SEED=true only on a disposable demonstration database.',
    );
  }

  console.log('Clearing existing demo data (TRUNCATE Business CASCADE)…');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Business" CASCADE;');

  console.log('Seeding Mirembe Mini Mart (3 branches, 60 days of trading)…');
  const mirembe = await seedMirembe();
  console.log(
    `  ✓ ${mirembe.productCount} products, ${mirembe.sales} sales, ${mirembe.locations.length} branches`,
  );

  console.log('Seeding Nakawa Electronics Hub (second tenant for isolation)…');
  const nakawa = await seedNakawa();
  console.log(`  ✓ ${nakawa.productCount} products, 1 branch`);

  const counts = await prisma.$transaction(async (tx) => ({
    sales: await tx.sale.count(),
    movements: await tx.inventoryMovement.count(),
    purchases: await tx.purchase.count(),
    refunds: await tx.refund.count(),
    audits: await tx.auditLog.count(),
  }));

  console.log('\nSeed complete.');
  console.log(
    `  Sales: ${counts.sales} · Ledger movements: ${counts.movements} · Purchases: ${counts.purchases} · Refunds: ${counts.refunds} · Audit events: ${counts.audits}`,
  );
  console.log('\nDemo credentials');
  console.log('  Mirembe Mini Mart (owner)      owner@mirembe.test       OwnerPass123!');
  console.log('  Mirembe Mini Mart (manager)    manager@mirembe.test     ManagerPass123!');
  console.log('  Mirembe Mini Mart (cashier)    cashier@mirembe.test     CashierPass123!');
  console.log('  Mirembe Mini Mart (cashier 2)  cashier2@mirembe.test    Cashier2Pass123!');
  console.log('  Mirembe Mini Mart (inventory)  inventory@mirembe.test   InventoryPass123!');
  console.log('  Nakawa Electronics (owner)     owner@nakawa.test        NakawaPass123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

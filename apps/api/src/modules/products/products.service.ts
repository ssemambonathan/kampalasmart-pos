import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, money } from '@kampalasmart/shared';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryLedgerService } from '../../common/inventory/inventory-ledger.service';
import { AccessService } from '../../common/access/access.service';
import { ApiException } from '../../common/errors/api-exception';
import { toProductDto } from '../../common/serializers';
import { csvToObjects, toCsv } from '../../common/csv';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateProductDto, ProductImportDto, ProductQueryDto, UpdateProductDto } from './products.dto';

const productInclude = {
  category: { select: { name: true } },
  supplier: { select: { name: true } },
  taxRate: { select: { rate: true, isInclusive: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: InventoryLedgerService,
    private readonly access: AccessService,
  ) {}

  async list(auth: AuthUser, query: ProductQueryDto) {
    const { skip, take } = skipTake(query);
    const location = await this.access.resolveLocation(auth, query.locationId ?? null);
    const where: Prisma.ProductWhereInput = {
      businessId: auth.businessId,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { barcode: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortable: Record<string, keyof Prisma.ProductOrderByWithRelationInput> = {
      name: 'name',
      sku: 'sku',
      sellingprice: 'sellingPrice',
      costprice: 'costPrice',
      createdat: 'createdAt',
      updatedat: 'updatedAt',
    };
    const sortField = sortable[(query.sort ?? '').toLowerCase()] ?? 'name';
    const direction = (query.sort ? query.direction : 'asc') as Prisma.SortOrder;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          ...productInclude,
          inventoryLevels: { where: { locationId: location.id }, select: { quantity: true } },
        },
        orderBy: { [sortField]: direction },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      ...paginate(
        rows.map((product) =>
          toProductDto(product, product.inventoryLevels[0]?.quantity.toFixed(3) ?? '0.000'),
        ),
        total,
        query,
      ),
      locationId: location.id,
    };
  }

  async get(auth: AuthUser, id: string, locationId?: string) {
    const location = await this.access.resolveLocation(auth, locationId ?? null);
    const product = await this.prisma.product.findFirst({
      where: { id, businessId: auth.businessId },
      include: {
        ...productInclude,
        inventoryLevels: { where: { locationId: location.id }, select: { quantity: true } },
      },
    });
    if (!product) throw ApiException.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    return toProductDto(product, product.inventoryLevels[0]?.quantity.toFixed(3) ?? '0.000');
  }

  async findByBarcode(auth: AuthUser, barcode: string, locationId?: string) {
    const location = await this.access.resolveLocation(auth, locationId ?? null);
    const product = await this.prisma.product.findFirst({
      where: { businessId: auth.businessId, barcode, isActive: true },
      include: {
        ...productInclude,
        inventoryLevels: { where: { locationId: location.id }, select: { quantity: true } },
      },
    });
    if (!product) throw ApiException.notFound('No product matches this barcode.', 'PRODUCT_NOT_FOUND');
    return toProductDto(product, product.inventoryLevels[0]?.quantity.toFixed(3) ?? '0.000');
  }

  async create(auth: AuthUser, dto: CreateProductDto, actor: AuditActor) {
    await this.assertReferences(auth.businessId, dto);
    const taxRateId = await this.resolveTaxRateId(auth.businessId, dto.taxRateId ?? null);
    const openingQuantity = dec(dto.openingQuantity ?? 0);
    if (openingQuantity.isNegative()) {
      throw ApiException.badRequest('Opening quantity cannot be negative.', 'INVALID_QUANTITY');
    }

    try {
      const created = await this.prisma.criticalTransaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            businessId: auth.businessId,
            categoryId: dto.categoryId ?? null,
            supplierId: dto.supplierId ?? null,
            taxRateId,
            name: dto.name.trim(),
            sku: dto.sku.trim(),
            barcode: dto.barcode ?? null,
            brand: dto.brand ?? null,
            description: dto.description ?? null,
            sellingPrice: money(dto.sellingPrice),
            costPrice: money(dto.costPrice),
            reorderLevel: dto.reorderLevel ?? '0',
            safetyStock: dto.safetyStock ?? '0',
            leadTimeDays: dto.leadTimeDays ?? 3,
            unit: dto.unit ?? 'piece',
            isActive: dto.isActive ?? true,
            imageUrl: dto.imageUrl ?? null,
          },
        });

        const locations = await tx.location.findMany({
          where: { businessId: auth.businessId, isActive: true },
          select: { id: true },
        });
        if (locations.length) {
          await tx.inventoryLevel.createMany({
            data: locations.map((location) => ({
              businessId: auth.businessId,
              locationId: location.id,
              productId: product.id,
              quantity: '0.000',
            })),
          });
        }

        if (openingQuantity.greaterThan(0)) {
          const location = await this.access.resolveLocation(auth, dto.openingLocationId ?? null);
          await this.ledger.apply(tx, {
            businessId: auth.businessId,
            locationId: location.id,
            productId: product.id,
            movementType: 'OPENING_BALANCE',
            quantity: openingQuantity.toFixed(3),
            unitCost: money(dto.costPrice),
            referenceType: 'OPENING',
            performedBy: auth.id,
            reason: 'Opening stock recorded with product',
          });
        }

        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'product.created',
            entityType: 'Product',
            entityId: product.id,
            actor,
            after: {
              name: product.name,
              sku: product.sku,
              sellingPrice: product.sellingPrice.toFixed(2),
              costPrice: product.costPrice.toFixed(2),
              openingQuantity: openingQuantity.toFixed(3),
            },
          },
          tx,
        );
        return product;
      });
      return this.get(auth, created.id);
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async update(auth: AuthUser, id: string, dto: UpdateProductDto, actor: AuditActor) {
    const existing = await this.prisma.product.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    await this.assertReferences(auth.businessId, dto);
    const taxRateId =
      dto.taxRateId === undefined
        ? undefined
        : await this.resolveTaxRateId(auth.businessId, dto.taxRateId ?? null);

    try {
      const updated = await this.prisma.criticalTransaction(async (tx) => {
        const product = await tx.product.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
            ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
            ...(dto.brand !== undefined ? { brand: dto.brand } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
            ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
            ...(dto.sellingPrice !== undefined ? { sellingPrice: money(dto.sellingPrice) } : {}),
            ...(dto.costPrice !== undefined ? { costPrice: money(dto.costPrice) } : {}),
            ...(taxRateId !== undefined ? { taxRateId } : {}),
            ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
            ...(dto.safetyStock !== undefined ? { safetyStock: dto.safetyStock } : {}),
            ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
            ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          },
        });

        await this.audit.record(
          {
            businessId: auth.businessId,
            action: 'product.updated',
            entityType: 'Product',
            entityId: product.id,
            actor,
            before: {
              name: existing.name,
              sku: existing.sku,
              sellingPrice: existing.sellingPrice.toFixed(2),
              costPrice: existing.costPrice.toFixed(2),
              isActive: existing.isActive,
            },
            after: {
              name: product.name,
              sku: product.sku,
              sellingPrice: product.sellingPrice.toFixed(2),
              costPrice: product.costPrice.toFixed(2),
              isActive: product.isActive,
            },
          },
          tx,
        );

        if (dto.sellingPrice !== undefined && !dec(dto.sellingPrice).equals(existing.sellingPrice)) {
          await this.audit.record(
            {
              businessId: auth.businessId,
              action: 'product.price_changed',
              entityType: 'Product',
              entityId: product.id,
              actor,
              before: { sellingPrice: existing.sellingPrice.toFixed(2) },
              after: { sellingPrice: product.sellingPrice.toFixed(2) },
              reason: 'Selling price updated',
            },
            tx,
          );
        }
        if (dto.costPrice !== undefined && !dec(dto.costPrice).equals(existing.costPrice)) {
          await this.audit.record(
            {
              businessId: auth.businessId,
              action: 'product.cost_changed',
              entityType: 'Product',
              entityId: product.id,
              actor,
              before: { costPrice: existing.costPrice.toFixed(2) },
              after: { costPrice: product.costPrice.toFixed(2) },
              reason: 'Cost price updated',
            },
            tx,
          );
        }
        return product;
      });
      return this.get(auth, updated.id);
    } catch (error) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async archive(auth: AuthUser, id: string, actor: AuditActor) {
    const existing = await this.prisma.product.findFirst({
      where: { id, businessId: auth.businessId },
    });
    if (!existing) throw ApiException.notFound('Product not found.', 'PRODUCT_NOT_FOUND');
    if (!existing.isActive && existing.deletedAt) return { success: true };
    const product = await this.prisma.product.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await this.audit.record({
      businessId: auth.businessId,
      action: 'product.archived',
      entityType: 'Product',
      entityId: product.id,
      actor,
      before: { isActive: existing.isActive, sku: existing.sku },
      after: { isActive: false, archived: true },
      reason: 'Product archived; sales and stock history retained',
    });
    return { success: true };
  }

  async exportCsv(auth: AuthUser, query: ProductQueryDto): Promise<{ filename: string; contentType: string; content: string }> {
    const location = await this.access.resolveLocation(auth, query.locationId ?? null);
    const rows = await this.prisma.product.findMany({
      where: {
        businessId: auth.businessId,
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      include: {
        category: { select: { name: true } },
        supplier: { select: { name: true } },
        taxRate: { select: { rate: true } },
        inventoryLevels: { where: { locationId: location.id }, select: { quantity: true } },
      },
      orderBy: { name: 'asc' },
    });
    const csv = toCsv(
      [
        'sku',
        'name',
        'barcode',
        'brand',
        'category',
        'supplier',
        'cost_price',
        'selling_price',
        'tax_rate',
        'reorder_level',
        'safety_stock',
        'lead_time_days',
        'unit',
        'is_active',
        'stock_at_location',
      ],
      rows.map((product) => [
        product.sku,
        product.name,
        product.barcode ?? '',
        product.brand ?? '',
        product.category?.name ?? '',
        product.supplier?.name ?? '',
        product.costPrice.toFixed(2),
        product.sellingPrice.toFixed(2),
        product.taxRate?.rate.toFixed(2) ?? '0.00',
        product.reorderLevel.toFixed(3),
        product.safetyStock.toFixed(3),
        product.leadTimeDays,
        product.unit,
        product.isActive ? 'true' : 'false',
        product.inventoryLevels[0]?.quantity.toFixed(3) ?? '0.000',
      ]),
    );
    return {
      filename: `products-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csv,
    };
  }

  async importCsv(auth: AuthUser, dto: ProductImportDto, actor: AuditActor) {
    const rows = csvToObjects(dto.csv);
    if (rows.length === 0) {
      throw ApiException.badRequest('The CSV file has no data rows.', 'EMPTY_IMPORT');
    }
    if (rows.length > 1000) {
      throw ApiException.badRequest('Import at most 1000 rows at a time.', 'IMPORT_TOO_LARGE');
    }
    const categories = await this.prisma.category.findMany({
      where: { businessId: auth.businessId, deletedAt: null },
      select: { id: true, name: true },
    });
    const suppliers = await this.prisma.supplier.findMany({
      where: { businessId: auth.businessId, deletedAt: null },
      select: { id: true, name: true },
    });
    const taxRates = await this.prisma.taxRate.findMany({
      where: { businessId: auth.businessId, isActive: true },
      select: { id: true, name: true, rate: true },
    });
    const defaultTax = taxRates.find((rate) => rate.name.toLowerCase() === 'vat 18%') ?? taxRates[0];
    const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
    const supplierByName = new Map(suppliers.map((supplier) => [supplier.name.toLowerCase(), supplier]));
    const taxByName = new Map(taxRates.map((rate) => [rate.name.toLowerCase(), rate]));

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = (row.name ?? '').trim();
      const sku = (row.sku ?? '').trim();
      const sellingPrice = (row.selling_price ?? '').trim();
      const costPrice = (row.cost_price ?? '').trim();
      if (!name || !sku) {
        errors.push({ row: rowNumber, message: 'Both name and sku are required.' });
        skipped += 1;
        continue;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(sellingPrice) || !/^\d+(\.\d{1,2})?$/.test(costPrice)) {
        errors.push({
          row: rowNumber,
          message: 'cost_price and selling_price must be non-negative amounts with up to 2 decimals.',
        });
        skipped += 1;
        continue;
      }
      const category = row.category ? categoryByName.get(row.category.toLowerCase()) : undefined;
      if (row.category && !category) {
        errors.push({ row: rowNumber, message: `Unknown category: ${row.category}` });
        skipped += 1;
        continue;
      }
      const supplier = row.supplier ? supplierByName.get(row.supplier.toLowerCase()) : undefined;
      if (row.supplier && !supplier) {
        errors.push({ row: rowNumber, message: `Unknown supplier: ${row.supplier}` });
        skipped += 1;
        continue;
      }
      const taxRate = row.tax_rate
        ? taxByName.get(row.tax_rate.toLowerCase()) ??
          taxRates.find((rate) => rate.rate.toString() === row.tax_rate)
        : defaultTax;

      try {
        const existing = await this.prisma.product.findUnique({
          where: { businessId_sku: { businessId: auth.businessId, sku } },
        });
        const data = {
          name,
          barcode: row.barcode ? row.barcode : null,
          brand: row.brand || null,
          categoryId: category?.id ?? null,
          supplierId: supplier?.id ?? null,
          taxRateId: taxRate?.id ?? null,
          sellingPrice: money(sellingPrice),
          costPrice: money(costPrice),
          reorderLevel: row.reorder_level || '0',
          safetyStock: row.safety_stock || '0',
          leadTimeDays: row.lead_time_days ? Math.max(0, Math.min(365, Number(row.lead_time_days))) : 3,
          unit: row.unit || 'piece',
          isActive: row.is_active ? row.is_active.toLowerCase() !== 'false' : true,
        };
        if (existing) {
          await this.prisma.product.update({ where: { id: existing.id }, data });
          updated += 1;
        } else {
          const product = await this.prisma.product.create({
            data: { businessId: auth.businessId, sku, ...data },
          });
          const locations = await this.prisma.location.findMany({
            where: { businessId: auth.businessId, isActive: true },
            select: { id: true },
          });
          if (locations.length) {
            await this.prisma.inventoryLevel.createMany({
              data: locations.map((location) => ({
                businessId: auth.businessId,
                locationId: location.id,
                productId: product.id,
                quantity: '0.000',
              })),
            });
          }
          imported += 1;
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          errors.push({ row: rowNumber, message: 'SKU or barcode already belongs to another product.' });
        } else {
          errors.push({ row: rowNumber, message: 'The row could not be imported.' });
        }
        skipped += 1;
      }
    }

    await this.audit.record({
      businessId: auth.businessId,
      action: 'products.imported',
      entityType: 'Product',
      actor,
      metadata: { imported, updated, skipped, errors: errors.slice(0, 20) },
    });
    return { imported, updated, skipped, errors };
  }

  private async assertReferences(
    businessId: string,
    dto: Partial<Pick<CreateProductDto, 'categoryId' | 'supplierId' | 'taxRateId'>>,
  ) {
    if (dto.categoryId) {
      const count = await this.prisma.category.count({
        where: { id: dto.categoryId, businessId, deletedAt: null },
      });
      if (!count) throw ApiException.badRequest('Category not found.', 'INVALID_CATEGORY');
    }
    if (dto.supplierId) {
      const count = await this.prisma.supplier.count({
        where: { id: dto.supplierId, businessId, deletedAt: null },
      });
      if (!count) throw ApiException.badRequest('Supplier not found.', 'INVALID_SUPPLIER');
    }
    if (dto.taxRateId) {
      const count = await this.prisma.taxRate.count({
        where: { id: dto.taxRateId, businessId, isActive: true },
      });
      if (!count) throw ApiException.badRequest('Tax rate not found.', 'INVALID_TAX_RATE');
    }
  }

  private async resolveTaxRateId(businessId: string, taxRateId: string | null): Promise<string | null> {
    if (taxRateId) return taxRateId;
    const fallback = await this.prisma.taxRate.findFirst({
      where: { businessId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  private rethrowDuplicate(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'SKU or barcode';
      throw ApiException.conflict(`A product with this ${target} already exists.`, 'DUPLICATE_PRODUCT');
    }
  }
}

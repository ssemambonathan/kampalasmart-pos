import { Injectable } from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { dec, money, OUTBOUND_MOVEMENTS, quantity as qty } from '@kampalasmart/shared';
import type { Decimal } from '@kampalasmart/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ApiException } from '../errors/api-exception';

export interface ApplyMovementInput {
  businessId: string;
  locationId: string;
  productId: string;
  movementType: MovementType;
  /** Signed change: inbound movements positive, outbound movements negative. */
  quantity: string | number | Decimal;
  unitCost: string | number | Decimal;
  referenceType?: string | null;
  referenceId?: string | null;
  performedBy?: string | null;
  reason?: string | null;
  note?: string | null;
  createdAt?: Date;
}

export interface ApplyMovementResult {
  movementId: string;
  previousQuantity: string;
  balanceAfter: string;
}

/**
 * The single write path for stock. Every change is applied to the current
 * balance and appended to the immutable movement ledger inside the caller's
 * database transaction, so a product's stock can always be explained.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(
    tx: Tx,
    input: ApplyMovementInput,
    options: { allowNegative?: boolean } = {},
  ): Promise<ApplyMovementResult> {
    const delta = dec(input.quantity);
    if (delta.isZero()) {
      throw ApiException.badRequest('A stock movement cannot be zero.', 'INVALID_QUANTITY');
    }
    const isOutbound = OUTBOUND_MOVEMENTS.includes(input.movementType as never);
    if (isOutbound && !delta.isNegative()) {
      throw ApiException.badRequest(
        `${input.movementType} requires a negative quantity.`,
        'INVALID_MOVEMENT_DIRECTION',
      );
    }
    if (!isOutbound && delta.isNegative()) {
      throw ApiException.badRequest(
        `${input.movementType} requires a positive quantity.`,
        'INVALID_MOVEMENT_DIRECTION',
      );
    }
    if (dec(input.unitCost).isNegative()) {
      throw ApiException.badRequest('Unit cost cannot be negative.', 'INVALID_COST');
    }

    const level = await tx.inventoryLevel.upsert({
      where: { locationId_productId: { locationId: input.locationId, productId: input.productId } },
      create: {
        businessId: input.businessId,
        locationId: input.locationId,
        productId: input.productId,
        quantity: '0.000',
      },
      update: {},
    });

    const previous = dec(level.quantity);
    const next = previous.plus(delta);
    if (next.isNegative() && !options.allowNegative) {
      throw ApiException.conflict(
        `Insufficient stock. Available: ${qty(previous)}, requested: ${qty(delta.abs())}.`,
        'INSUFFICIENT_STOCK',
        {
          productId: input.productId,
          locationId: input.locationId,
          available: qty(previous),
          requested: qty(delta.abs()),
        },
      );
    }

    await tx.inventoryLevel.update({
      where: { id: level.id },
      data: { quantity: qty(next) },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        businessId: input.businessId,
        locationId: input.locationId,
        productId: input.productId,
        movementType: input.movementType,
        quantity: qty(delta),
        unitCost: money(input.unitCost),
        totalCost: money(delta.abs().times(dec(input.unitCost))),
        balanceAfter: qty(next),
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        performedBy: input.performedBy ?? null,
        reason: input.reason ?? null,
        note: input.note ?? null,
        createdAt: input.createdAt ?? new Date(),
      },
    });

    return { movementId: movement.id, previousQuantity: qty(previous), balanceAfter: qty(next) };
  }

  /** Current stock for a set of products at one location (missing rows = 0). */
  async levelsAt(
    businessId: string,
    locationId: string,
    productIds: string[],
  ): Promise<Map<string, Decimal>> {
    const rows = await this.prisma.inventoryLevel.findMany({
      where: { businessId, locationId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    });
    return new Map(rows.map((row) => [row.productId, dec(row.quantity)]));
  }

  async levelAt(locationId: string, productId: string): Promise<Decimal> {
    const row = await this.prisma.inventoryLevel.findUnique({
      where: { locationId_productId: { locationId, productId } },
      select: { quantity: true },
    });
    return dec(row?.quantity ?? 0);
  }
}

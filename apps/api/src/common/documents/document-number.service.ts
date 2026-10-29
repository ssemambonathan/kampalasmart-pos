import { Injectable } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';

const PREFIXES: Record<string, string> = {
  SALE: 'SALE',
  REFUND: 'REF',
  PURCHASE: 'PO',
  PURCHASE_RETURN: 'PRET',
  TRANSFER: 'TRF',
};

@Injectable()
export class DocumentNumberService {
  /**
   * Atomically allocates the next per-tenant document number. Uses an
   * INSERT ... ON CONFLICT increment so concurrent sales can never share a
   * number, even across multiple API instances.
   */
  async next(tx: Tx, businessId: string, docType: keyof typeof PREFIXES | string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
      INSERT INTO "DocumentCounter" ("businessId", "docType", "nextValue")
      VALUES (${businessId}, ${docType}, 2)
      ON CONFLICT ("businessId", "docType")
      DO UPDATE SET "nextValue" = "DocumentCounter"."nextValue" + 1
      RETURNING "nextValue"
    `;
    const nextValue = rows[0]?.nextValue;
    if (!nextValue) throw new Error('Failed to allocate document number');
    const sequence = nextValue - 1;
    const prefix = PREFIXES[docType] ?? docType;
    return `${prefix}-${String(sequence).padStart(6, '0')}`;
  }
}

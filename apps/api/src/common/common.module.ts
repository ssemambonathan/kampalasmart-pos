import { Global, Module } from '@nestjs/common';
import { AccessService } from './access/access.service';
import { AppLogger } from './logging/app-logger.service';
import { DocumentNumberService } from './documents/document-number.service';
import { InventoryLedgerService } from './inventory/inventory-ledger.service';

@Global()
@Module({
  providers: [AppLogger, AccessService, DocumentNumberService, InventoryLedgerService],
  exports: [AppLogger, AccessService, DocumentNumberService, InventoryLedgerService],
})
export class CommonModule {}

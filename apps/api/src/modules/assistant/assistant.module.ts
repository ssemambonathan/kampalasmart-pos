import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportsModule } from '../reports/reports.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [ReportsModule, InventoryModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}

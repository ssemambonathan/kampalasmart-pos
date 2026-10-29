import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [SalesModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}

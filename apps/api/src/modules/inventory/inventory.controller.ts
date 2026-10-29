import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import {
  AdjustmentDto,
  InventoryQueryDto,
  LowStockQueryDto,
  MovementQueryDto,
  ReconciliationDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('levels')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock on hand by product and branch, with status' })
  levels(@CurrentAuth() auth: AuthUser, @Query() query: InventoryQueryDto) {
    return this.inventory.levels(auth, query);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Immutable stock movement ledger' })
  movements(@CurrentAuth() auth: AuthUser, @Query() query: MovementQueryDto) {
    return this.inventory.movements(auth, query);
  }

  @Get('low-stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Low and critical stock with reorder recommendations' })
  lowStock(@CurrentAuth() auth: AuthUser, @Query() query: LowStockQueryDto) {
    return this.inventory.lowStock(auth, query);
  }

  @Get('insights')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Low stock, overstock and slow-moving stock' })
  insights(@CurrentAuth() auth: AuthUser, @Query() query: LowStockQueryDto) {
    return this.inventory.insights(auth, query);
  }

  @Get('valuation')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Inventory value by branch and category' })
  valuation(@CurrentAuth() auth: AuthUser, @Query('locationId') locationId?: string) {
    return this.inventory.valuation(auth, locationId);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'Export stock levels or movements as CSV' })
  exportCsv(
    @CurrentAuth() auth: AuthUser,
    @Query('type') type: 'levels' | 'movements' = 'levels',
    @Query() query: MovementQueryDto = new MovementQueryDto(),
  ) {
    return this.inventory.exportCsv(auth, type === 'movements' ? 'movements' : 'levels', query);
  }

  @Get('product/:productId/ledger')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Complete stock history explaining a product balance' })
  ledger(
    @CurrentAuth() auth: AuthUser,
    @Param('productId') productId: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.inventory.productLedger(auth, productId, locationId);
  }

  @Post('adjustments')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Record a stock adjustment with a mandatory reason' })
  adjust(@CurrentAuth() auth: AuthUser, @Body() dto: AdjustmentDto, @Req() req: Request) {
    return this.inventory.adjust(auth, dto, auditActor(auth, req));
  }

  @Post('reconcile')
  @RequirePermissions(PERMISSIONS.INVENTORY_RECONCILE)
  @ApiOperation({ summary: 'Reconcile a physical stock count against system stock' })
  reconcile(@CurrentAuth() auth: AuthUser, @Body() dto: ReconciliationDto, @Req() req: Request) {
    return this.inventory.reconcile(auth, dto, auditActor(auth, req));
  }
}

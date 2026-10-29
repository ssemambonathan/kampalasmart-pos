import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateSaleDto, SaleQueryDto } from './sales.dto';
import { SalesService } from './sales.service';

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SALES_READ_OWN)
  @ApiOperation({ summary: 'List sales, scoped to the signed-in cashier when required' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: SaleQueryDto) {
    return this.sales.list(auth, query);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.SALES_READ_ALL, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'Export sale lines as CSV' })
  export(@CurrentAuth() auth: AuthUser, @Query() query: SaleQueryDto) {
    return this.sales.exportCsv(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SALES_CREATE)
  @ApiOperation({ summary: 'Complete a sale with server-authoritative pricing and stock' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateSaleDto, @Req() req: Request) {
    return this.sales.create(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SALES_READ_OWN)
  @ApiOperation({ summary: 'Sale detail with payments and refunds' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.sales.get(auth, id);
  }

  @Get(':id/receipt')
  @RequirePermissions(PERMISSIONS.SALES_READ_OWN)
  @ApiOperation({ summary: 'Receipt payload for printing or sharing' })
  receipt(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.sales.receipt(auth, id);
  }
}

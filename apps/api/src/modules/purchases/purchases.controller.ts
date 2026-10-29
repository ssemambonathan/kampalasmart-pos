import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import {
  CreatePurchaseDto,
  CreatePurchaseReturnDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './purchases.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List purchase orders with filters' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: PurchaseQueryDto) {
    return this.purchases.list(auth, query);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'Export purchase order lines as CSV' })
  export(@CurrentAuth() auth: AuthUser, @Query() query: PurchaseQueryDto) {
    return this.purchases.exportCsv(auth, query);
  }

  @Get('returns')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List supplier returns' })
  returns(@CurrentAuth() auth: AuthUser, @Query() query: PurchaseQueryDto) {
    return this.purchases.listReturns(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  @ApiOperation({ summary: 'Create a purchase order' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreatePurchaseDto, @Req() req: Request) {
    return this.purchases.create(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Purchase order detail with receipts and returns' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.purchases.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  @ApiOperation({ summary: 'Edit an unreceived purchase order' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
    @Req() req: Request,
  ) {
    return this.purchases.update(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PURCHASES_RECEIVE)
  @ApiOperation({ summary: 'Receive full or partial stock for an order' })
  receive(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseDto,
    @Req() req: Request,
  ) {
    return this.purchases.receive(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  @ApiOperation({ summary: 'Cancel an order that has no receipts' })
  cancel(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.purchases.cancel(auth, id, auditActor(auth, req));
  }

  @Post(':id/returns')
  @RequirePermissions(PERMISSIONS.PURCHASES_WRITE)
  @ApiOperation({ summary: 'Return received stock to the supplier' })
  createReturn(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseReturnDto,
    @Req() req: Request,
  ) {
    return this.purchases.createReturn(auth, id, dto, auditActor(auth, req));
  }
}

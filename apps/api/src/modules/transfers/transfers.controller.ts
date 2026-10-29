import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateTransferDto, RejectTransferDto, TransferQueryDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'List inter-branch stock transfers' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: TransferQueryDto) {
    return this.transfers.list(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Request a stock transfer between branches' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateTransferDto, @Req() req: Request) {
    return this.transfers.create(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Transfer detail' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.transfers.get(auth, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER_APPROVE)
  @ApiOperation({ summary: 'Approve a pending transfer' })
  approve(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.transfers.approve(auth, id, auditActor(auth, req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Move stock for an approved transfer' })
  complete(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.transfers.complete(auth, id, auditActor(auth, req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER_APPROVE)
  @ApiOperation({ summary: 'Reject a pending transfer' })
  reject(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectTransferDto,
    @Req() req: Request,
  ) {
    return this.transfers.reject(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Cancel your own pending transfer' })
  cancel(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.transfers.cancel(auth, id, auditActor(auth, req));
  }
}

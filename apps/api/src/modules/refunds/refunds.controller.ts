import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateRefundDto, RefundQueryDto, RejectRefundDto } from './refunds.dto';
import { RefundsService } from './refunds.service';

@ApiTags('refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REFUNDS_READ)
  @ApiOperation({ summary: 'List refund requests with filters' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: RefundQueryDto) {
    return this.refunds.list(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.REFUNDS_CREATE)
  @ApiOperation({ summary: 'Request a refund; small refunds by approvers complete immediately' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateRefundDto, @Req() req: Request) {
    return this.refunds.request(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REFUNDS_READ)
  @ApiOperation({ summary: 'Refund detail' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.refunds.get(auth, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.REFUNDS_APPROVE)
  @ApiOperation({ summary: 'Approve a pending refund' })
  approve(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.refunds.approve(auth, id, auditActor(auth, req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.REFUNDS_APPROVE)
  @ApiOperation({ summary: 'Complete an approved refund and restore stock' })
  complete(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.refunds.complete(auth, id, auditActor(auth, req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.REFUNDS_APPROVE)
  @ApiOperation({ summary: 'Reject a pending refund with a reason' })
  reject(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectRefundDto,
    @Req() req: Request,
  ) {
    return this.refunds.reject(auth, id, dto, auditActor(auth, req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.REFUNDS_CREATE)
  @ApiOperation({ summary: 'Cancel your own pending refund request' })
  cancel(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.refunds.cancel(auth, id, auditActor(auth, req));
  }
}

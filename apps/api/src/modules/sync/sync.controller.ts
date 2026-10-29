import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import {
  RegisterDeviceDto,
  ResolveConflictDto,
  SyncBootstrapQueryDto,
  SyncPullQueryDto,
  SyncPushDto,
} from './sync.dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('register')
  @RequirePermissions(PERMISSIONS.SYNC_READ)
  @ApiOperation({ summary: 'Register or refresh an offline device' })
  register(@CurrentAuth() auth: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.sync.registerDevice(auth, dto);
  }

  @Get('bootstrap')
  @RequirePermissions(PERMISSIONS.SYNC_READ)
  @ApiOperation({ summary: 'Download the catalogue, stock, settings and customers for offline use' })
  bootstrap(@CurrentAuth() auth: AuthUser, @Query() query: SyncBootstrapQueryDto) {
    return this.sync.bootstrap(auth, query);
  }

  @Get('pull')
  @RequirePermissions(PERMISSIONS.SYNC_READ)
  @ApiOperation({ summary: 'Pull products, stock and customers changed since a timestamp' })
  pull(@CurrentAuth() auth: AuthUser, @Query() query: SyncPullQueryDto) {
    return this.sync.pull(auth, query);
  }

  @Post('push')
  @RequirePermissions(PERMISSIONS.SYNC_READ, PERMISSIONS.SALES_CREATE)
  @ApiOperation({ summary: 'Push queued offline sales, with server-authoritative pricing and conflicts' })
  push(@CurrentAuth() auth: AuthUser, @Body() dto: SyncPushDto, @Req() req: Request) {
    return this.sync.push(auth, dto, auditActor(auth, req));
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  @ApiOperation({ summary: 'Device activity, last sync and unresolved conflicts' })
  overview(@CurrentAuth() auth: AuthUser) {
    return this.sync.overview(auth);
  }

  @Post('conflicts/:id/resolve')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  @ApiOperation({ summary: 'Record the decision taken for a sync conflict' })
  resolve(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveConflictDto,
    @Req() req: Request,
  ) {
    return this.sync.resolve(auth, id, dto, auditActor(auth, req));
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateLocationDto, UpdateLocationDto } from './locations.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  @ApiOperation({ summary: 'List branches visible to the signed-in user' })
  list(@CurrentAuth() auth: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.locations.list(auth, includeInactive === 'true' || includeInactive === '1');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a branch' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateLocationDto, @Req() req: Request) {
    return this.locations.create(auth, dto, auditActor(auth, req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  @ApiOperation({ summary: 'Update or deactivate a branch' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
    @Req() req: Request,
  ) {
    return this.locations.update(auth, id, dto, auditActor(auth, req));
  }
}

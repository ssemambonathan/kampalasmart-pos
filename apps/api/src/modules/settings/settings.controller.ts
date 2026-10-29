import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateTaxRateDto, UpdateBusinessDto, UpdateTaxRateDto } from './settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'Business profile, policies, tax rates, plan usage and subscription' })
  get(@CurrentAuth() auth: AuthUser) {
    return this.settings.get(auth);
  }

  @Patch('business')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update business profile, tax and discount policy' })
  updateBusiness(
    @CurrentAuth() auth: AuthUser,
    @Body() dto: UpdateBusinessDto,
    @Req() req: Request,
  ) {
    return this.settings.updateBusiness(auth, dto, auditActor(auth, req));
  }

  @Get('plans')
  @RequirePermissions(PERMISSIONS.BUSINESS_READ)
  @ApiOperation({ summary: 'Available plans and current subscription' })
  plans(@CurrentAuth() auth: AuthUser) {
    return this.settings.plans(auth);
  }

  @Get('tax-rates')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'List tax rates' })
  taxRates(@CurrentAuth() auth: AuthUser) {
    return this.settings.taxRates(auth);
  }

  @Post('tax-rates')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create a tax rate' })
  createTaxRate(
    @CurrentAuth() auth: AuthUser,
    @Body() dto: CreateTaxRateDto,
    @Req() req: Request,
  ) {
    return this.settings.createTaxRate(auth, dto, auditActor(auth, req));
  }

  @Patch('tax-rates/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Update or archive a tax rate' })
  updateTaxRate(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaxRateDto,
    @Req() req: Request,
  ) {
    return this.settings.updateTaxRate(auth, id, dto, auditActor(auth, req));
  }

  @Delete('tax-rates/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Archive a tax rate without deleting history' })
  archiveTaxRate(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.settings.archiveTaxRate(auth, id, auditActor(auth, req));
  }
}

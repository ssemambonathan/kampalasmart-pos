import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateSupplierDto, SupplierQueryDto, UpdateSupplierDto } from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'List suppliers with purchasing statistics' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: SupplierQueryDto) {
    return this.suppliers.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'Supplier profile and recent purchase history' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.suppliers.get(auth, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Create a supplier' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateSupplierDto, @Req() req: Request) {
    return this.suppliers.create(auth, dto, auditActor(auth, req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Update or archive a supplier' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: Request,
  ) {
    return this.suppliers.update(auth, id, dto, auditActor(auth, req));
  }
}

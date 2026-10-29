import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({ summary: 'List customers with purchase statistics' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: CustomerQueryDto) {
    return this.customers.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Customer profile and recent purchase history' })
  get(@CurrentAuth() auth: AuthUser, @Param('id') id: string) {
    return this.customers.get(auth, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Create a customer' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.customers.create(auth, dto, auditActor(auth, req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Update or deactivate a customer' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    return this.customers.update(auth, id, dto, auditActor(auth, req));
  }
}

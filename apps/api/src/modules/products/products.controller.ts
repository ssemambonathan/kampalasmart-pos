import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateProductDto, ProductImportDto, ProductQueryDto, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Search and page products with location stock' })
  list(@CurrentAuth() auth: AuthUser, @Query() query: ProductQueryDto) {
    return this.products.list(auth, query);
  }

  @Get('barcode/:barcode')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Look up a product by barcode for scanner input' })
  barcode(
    @CurrentAuth() auth: AuthUser,
    @Param('barcode') barcode: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.products.findByBarcode(auth, barcode, locationId);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'Export the product catalogue as CSV' })
  exportCsv(@CurrentAuth() auth: AuthUser, @Query() query: ProductQueryDto) {
    return this.products.exportCsv(auth, query);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Import products from CSV, reporting per-row errors' })
  importCsv(@CurrentAuth() auth: AuthUser, @Body() dto: ProductImportDto, @Req() req: Request) {
    return this.products.importCsv(auth, dto, auditActor(auth, req));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Create a product, optionally with opening stock' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateProductDto, @Req() req: Request) {
    return this.products.create(auth, dto, auditActor(auth, req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get a product with its stock at a branch' })
  get(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.products.get(auth, id, locationId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_WRITE)
  @ApiOperation({ summary: 'Update a product; price and cost changes are audited separately' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    return this.products.update(auth, id, dto, auditActor(auth, req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_DELETE)
  @ApiOperation({ summary: 'Archive a product without deleting historical records' })
  archive(@CurrentAuth() auth: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.products.archive(auth, id, auditActor(auth, req));
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import type { Request } from 'express';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { auditActor } from '../../common/audit/audit-context';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  @ApiOperation({ summary: 'List product categories with product counts' })
  list(
    @CurrentAuth() auth: AuthUser,
    @Query('includeInactive') includeInactive?: string,
    @Query('search') search?: string,
  ) {
    return this.categories.list(auth, {
      includeInactive: includeInactive === 'true' || includeInactive === '1',
      search: search?.trim() || undefined,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_WRITE)
  @ApiOperation({ summary: 'Create a category' })
  create(@CurrentAuth() auth: AuthUser, @Body() dto: CreateCategoryDto, @Req() req: Request) {
    return this.categories.create(auth, dto, auditActor(auth, req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_WRITE)
  @ApiOperation({ summary: 'Rename, edit or archive a category' })
  update(
    @CurrentAuth() auth: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categories.update(auth, id, dto, auditActor(auth, req));
  }
}

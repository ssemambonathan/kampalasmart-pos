import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, type AuditActor } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api-exception';
import { toCategoryDto } from '../../common/serializers';
import type { AuthUser } from '../../common/auth/auth-user';
import type { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, options: { includeInactive?: boolean; search?: string } = {}) {
    const categories = await this.prisma.category.findMany({
      where: {
        businessId: auth.businessId,
        deletedAt: null,
        ...(options.includeInactive ? {} : { isActive: true }),
        ...(options.search
          ? { name: { contains: options.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
    const counts = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { businessId: auth.businessId, deletedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((row) => [row.categoryId, row._count._all]));
    return categories.map((category) => toCategoryDto(category, countMap.get(category.id) ?? 0));
  }

  async create(auth: AuthUser, dto: CreateCategoryDto, actor: AuditActor) {
    try {
      const category = await this.prisma.category.create({
        data: {
          businessId: auth.businessId,
          name: dto.name,
          description: dto.description ?? null,
        },
      });
      await this.audit.record({
        businessId: auth.businessId,
        action: 'category.created',
        entityType: 'Category',
        entityId: category.id,
        actor,
        after: { name: category.name },
      });
      return toCategoryDto(category, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw ApiException.conflict('A category with this name already exists.', 'DUPLICATE_CATEGORY');
      }
      throw error;
    }
  }

  async update(auth: AuthUser, id: string, dto: UpdateCategoryDto, actor: AuditActor) {
    const existing = await this.prisma.category.findFirst({
      where: { id, businessId: auth.businessId, deletedAt: null },
    });
    if (!existing) throw ApiException.notFound('Category not found.', 'CATEGORY_NOT_FOUND');
    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record({
        businessId: auth.businessId,
        action: 'category.updated',
        entityType: 'Category',
        entityId: category.id,
        actor,
        before: toCategoryDto(existing),
        after: toCategoryDto(category),
      });
      return toCategoryDto(category);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw ApiException.conflict('A category with this name already exists.', 'DUPLICATE_CATEGORY');
      }
      throw error;
    }
  }
}

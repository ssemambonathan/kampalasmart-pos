import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Paginated } from '@kampalasmart/shared';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
}

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export function paginate<T>(data: T[], total: number, input: PaginationInput = {}): Paginated<T> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function skipTake(input: PaginationInput = {}): { skip: number; take: number } {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageOf(input: PaginationInput = {}): { page: number; pageSize: number } {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}

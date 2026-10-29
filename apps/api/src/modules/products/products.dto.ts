import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const money = /^\d+(\.\d{1,2})?$/;
const quantity = /^\d+(\.\d{1,3})?$/;

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'SKU may only contain letters, numbers, dot, dash and underscore.' })
  sku!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]*$/, { message: 'Barcode contains unsupported characters.' })
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string | null;

  @IsNumberString()
  @Matches(money, { message: 'Selling price must be a non-negative amount with at most 2 decimals.' })
  sellingPrice!: string;

  @IsNumberString()
  @Matches(money, { message: 'Cost price must be a non-negative amount with at most 2 decimals.' })
  costPrice!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxRateId?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(quantity, { message: 'Reorder level must have at most 3 decimals.' })
  reorderLevel?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(quantity, { message: 'Safety stock must have at most 3 decimals.' })
  safetyStock?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(quantity, { message: 'Opening quantity must have at most 3 decimals.' })
  openingQuantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  openingLocationId?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'SKU may only contain letters, numbers, dot, dash and underscore.' })
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]*$/, { message: 'Barcode contains unsupported characters.' })
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierId?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(money, { message: 'Selling price must be a non-negative amount with at most 2 decimals.' })
  sellingPrice?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(money, { message: 'Cost price must be a non-negative amount with at most 2 decimals.' })
  costPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxRateId?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(quantity, { message: 'Reorder level must have at most 3 decimals.' })
  reorderLevel?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(quantity, { message: 'Safety stock must have at most 3 decimals.' })
  safetyStock?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;
}

export class ProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  stockStatus?: 'out' | 'low' | 'ok';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean;
}

export class ProductImportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv!: string;
}

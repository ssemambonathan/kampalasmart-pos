import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class InventoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['all', 'out', 'critical', 'low', 'ok'])
  status?: 'all' | 'out' | 'critical' | 'low' | 'ok';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  includeInactive?: boolean;
}

export class MovementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  movementType?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class LowStockQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AdjustmentDto {
  @IsString()
  locationId!: string;

  @IsString()
  productId!: string;

  @IsNumberString()
  @Matches(/^-?\d+(\.\d{1,3})?$/, { message: 'Quantity must have at most 3 decimals.' })
  quantity!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsIn(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'OPENING_BALANCE'])
  movementType!: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE' | 'EXPIRY' | 'OPENING_BALANCE';
}

export class ReconciliationCountDto {
  @IsString()
  productId!: string;

  @IsNumberString()
  @Matches(/^\d+(\.\d{1,3})?$/, { message: 'Counted quantity must be non-negative with at most 3 decimals.' })
  countedQuantity!: string;
}

export class ReconciliationDto {
  @IsString()
  locationId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReconciliationCountDto)
  counts!: ReconciliationCountDto[];
}

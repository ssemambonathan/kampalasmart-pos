import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS, REFUND_STATUSES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const QUANTITY = /^\d+(\.\d{1,3})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class RefundItemInputDto {
  @IsString()
  @MinLength(1)
  saleItemId!: string;

  @Matches(QUANTITY, { message: 'Quantity must be a positive number with up to 3 decimals.' })
  quantity!: string;
}

export class CreateRefundDto {
  @IsString()
  @MinLength(1)
  saleId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RefundItemInputDto)
  items!: RefundItemInputDto[];

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method?: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(120)(value))
  @IsString()
  @MaxLength(120)
  reference?: string | null;

  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}

export class RejectRefundDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class RefundQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REFUND_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  saleId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

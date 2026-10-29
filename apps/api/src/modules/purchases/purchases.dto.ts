import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PURCHASE_STATUSES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const MONEY = /^\d+(\.\d{1,2})?$/;
const QUANTITY = /^\d+(\.\d{1,3})?$/;
const RATE = /^\d{1,3}(\.\d{1,3})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class PurchaseItemInputDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @Matches(QUANTITY, { message: 'quantity must be a positive number with up to 3 decimals' })
  quantity!: string;

  @Matches(MONEY, { message: 'unitCost must be a non-negative amount with up to 2 decimals' })
  unitCost!: string;
}

export class CreatePurchaseDto {
  @IsString()
  @MinLength(1)
  supplierId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(80)(value))
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @Matches(RATE, { message: 'taxRatePercent must be between 0 and 100 with up to 3 decimals' })
  taxRatePercent?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items!: PurchaseItemInputDto[];
}

export class UpdatePurchaseDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(80)(value))
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ReceivePurchaseItemDto {
  @IsString()
  @MinLength(1)
  purchaseItemId!: string;

  @Matches(QUANTITY, { message: 'quantity must be a positive number with up to 3 decimals' })
  quantity!: string;
}

export class ReceivePurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseItemDto)
  items!: ReceivePurchaseItemDto[];

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(500)(value))
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class PurchaseReturnItemDto {
  @IsString()
  @MinLength(1)
  purchaseItemId!: string;

  @Matches(QUANTITY, { message: 'quantity must be a positive number with up to 3 decimals' })
  quantity!: string;
}

export class CreatePurchaseReturnDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(80)(value))
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items!: PurchaseReturnItemDto[];
}

export class PurchaseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PURCHASE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

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

export class PurchaseReturnQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;
}

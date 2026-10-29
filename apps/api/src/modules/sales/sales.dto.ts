import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS, SALE_STATUSES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const MONEY = /^\d+(\.\d{1,2})?$/;
const QUANTITY = /^\d+(\.\d{1,3})?$/;
const DECIMAL = /^\d+(\.\d{1,3})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class DiscountDto {
  @IsIn(['PERCENT', 'AMOUNT'])
  type!: 'PERCENT' | 'AMOUNT';

  @Matches(DECIMAL, { message: 'Discount value must be a non-negative number.' })
  value!: string;
}

export class SaleLineDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @Matches(QUANTITY, { message: 'Quantity must be a positive number with up to 3 decimals.' })
  quantity!: string;

  @IsOptional()
  @Matches(MONEY, { message: 'Unit price must be an amount with up to 2 decimals.' })
  unitPrice?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  lineDiscount?: DiscountDto | null;
}

export class SalePaymentDto {
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method!: string;

  @Matches(MONEY, { message: 'Payment amount must be a non-negative amount with up to 2 decimals.' })
  amount!: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(120)(value))
  @IsString()
  @MaxLength(120)
  reference?: string | null;
}

export class CreateSaleDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  items!: SaleLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  cartDiscount?: DiscountDto | null;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientId?: string | null;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsBoolean()
  isOffline?: boolean;
}

export class SaleQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SALE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS as unknown as string[])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

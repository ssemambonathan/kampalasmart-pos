import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS } from '@kampalasmart/shared';
import { DiscountDto } from '../sales/sales.dto';

const MONEY = /^\d+(\.\d{1,2})?$/;
const QUANTITY = /^\d+(\.\d{1,3})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class RegisterDeviceDto {
  @IsString()
  @MinLength(6)
  @MaxLength(120)
  deviceKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;
}

export class OfflineSaleLineDto {
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

export class OfflineSalePaymentDto {
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

export class OfflineSalePayloadDto {
  @IsString()
  @MinLength(1)
  locationId!: string;

  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsISO8601()
  occurredAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleLineDto)
  items!: OfflineSaleLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  cartDiscount?: DiscountDto | null;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OfflineSalePaymentDto)
  payments!: OfflineSalePaymentDto[];

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class SyncPushEventDto {
  @IsString()
  @MinLength(6)
  @MaxLength(80)
  clientId!: string;

  @IsIn(['SALE'])
  type!: 'SALE';

  @ValidateNested()
  @Type(() => OfflineSalePayloadDto)
  payload!: OfflineSalePayloadDto;
}

export class SyncPushDto {
  @IsString()
  @MinLength(6)
  @MaxLength(120)
  deviceKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncPushEventDto)
  events!: SyncPushEventDto[];
}

export class SyncBootstrapQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;
}

export class SyncPullQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsISO8601()
  since?: string;
}

export class ResolveConflictDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  resolution!: string;
}

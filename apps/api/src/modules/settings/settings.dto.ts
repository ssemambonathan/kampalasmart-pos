import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CURRENCIES } from '@kampalasmart/shared';

const RATE = /^\d{1,3}(\.\d{1,3})?$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(30)(value))
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(255)(value))
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(300)(value))
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(500)(value))
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @IsOptional()
  @IsBoolean()
  taxEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  @IsOptional()
  @Matches(RATE, { message: 'Tax rate must be between 0 and 100.' })
  taxRate?: string;

  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @IsOptional()
  @Matches(RATE, { message: 'Cashier discount limit must be between 0 and 100.' })
  maxCashierDiscountPercent?: string;

  @IsOptional()
  @Matches(RATE, { message: 'Manager discount limit must be between 0 and 100.' })
  maxManagerDiscountPercent?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'Refund threshold must be a non-negative amount.' })
  refundApprovalThreshold?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultLeadTimeDays?: number;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(500)(value))
  @IsString()
  @MaxLength(500)
  receiptFooter?: string | null;
}

export class CreateTaxRateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @Matches(RATE, { message: 'Rate must be between 0 and 100.' })
  rate!: string;

  @IsOptional()
  @IsBoolean()
  isInclusive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateTaxRateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(RATE, { message: 'Rate must be between 0 and 100.' })
  rate?: string;

  @IsOptional()
  @IsBoolean()
  isInclusive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

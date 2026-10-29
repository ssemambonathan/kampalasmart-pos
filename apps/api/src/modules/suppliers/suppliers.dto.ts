import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const optionalTrimmed = (max: number) => (value: unknown) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => optionalTrimmed(120)(value))
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => optionalTrimmed(30)(value))
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => optionalTrimmed(255)(value))
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => optionalTrimmed(300)(value))
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  notes?: string | null;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => optionalTrimmed(120)(value))
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => optionalTrimmed(30)(value))
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => optionalTrimmed(255)(value))
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => optionalTrimmed(300)(value))
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SupplierQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean;
}

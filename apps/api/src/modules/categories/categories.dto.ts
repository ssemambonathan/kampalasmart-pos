import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimmed = (max: number) => (value: unknown) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => trimmed(500)(value))
  description?: string | null;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => trimmed(500)(value))
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

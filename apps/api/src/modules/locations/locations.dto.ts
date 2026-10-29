import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const optionalText = (max: number) => (value: unknown) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Code may only contain letters, numbers, dash and underscore.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => optionalText(300)(value))
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => optionalText(30)(value))
  phone?: string | null;
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Code may only contain letters, numbers, dash and underscore.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => optionalText(300)(value))
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => optionalText(30)(value))
  phone?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

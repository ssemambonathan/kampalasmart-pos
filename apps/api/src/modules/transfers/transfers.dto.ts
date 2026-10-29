import { Transform, Type } from 'class-transformer';
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
import { TRANSFER_STATUSES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const QUANTITY = /^\d+(\.\d{1,3})?$/;

const optionalTrimmed =
  (max: number) =>
  (value: unknown): unknown =>
    typeof value === 'string' ? (value.trim() === '' ? null : value.trim().slice(0, max)) : value;

export class TransferItemInputDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  @Matches(QUANTITY, { message: 'Quantity must be a positive number with up to 3 decimals.' })
  quantity!: string;
}

export class CreateTransferDto {
  @IsString()
  @MinLength(1)
  fromLocationId!: string;

  @IsString()
  @MinLength(1)
  toLocationId!: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmed(1000)(value))
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TransferItemInputDto)
  items!: TransferItemInputDto[];
}

export class RejectTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TransferQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TRANSFER_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  fromLocationId?: string;

  @IsOptional()
  @IsString()
  toLocationId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

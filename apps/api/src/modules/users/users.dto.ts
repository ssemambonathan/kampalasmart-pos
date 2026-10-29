import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_ROLES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsIn(USER_ROLES as unknown as string[])
  role!: string;

  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters.' })
  @MaxLength(200)
  @Matches(PASSWORD_RULE, {
    message: 'Use at least one uppercase letter, one lowercase letter and one number.',
  })
  password!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Assign at least one branch.' })
  @IsString({ each: true })
  locationIds!: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(USER_ROLES as unknown as string[])
  role?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Assign at least one branch.' })
  @IsString({ each: true })
  locationIds?: string[];
}

export class ResetUserPasswordDto {
  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters.' })
  @MaxLength(200)
  @Matches(PASSWORD_RULE, {
    message: 'Use at least one uppercase letter, one lowercase letter and one number.',
  })
  password!: string;
}

export class UserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(USER_ROLES as unknown as string[])
  role?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  includeInactive?: boolean;
}

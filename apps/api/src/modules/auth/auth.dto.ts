import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class RegisterBusinessDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  businessName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName!: string;

  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter.' })
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter.' })
  @Matches(/[0-9]/, { message: 'Password must include a number.' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsIn(['UGX', 'KES', 'TZS', 'USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'GHS', 'RWF'])
  currency?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter.' })
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter.' })
  @Matches(/[0-9]/, { message: 'Password must include a number.' })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter.' })
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter.' })
  @Matches(/[0-9]/, { message: 'Password must include a number.' })
  newPassword!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(20)
  @MaxLength(300)
  token!: string;
}

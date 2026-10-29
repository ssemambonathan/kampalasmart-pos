import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AskAssistantDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  question!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}

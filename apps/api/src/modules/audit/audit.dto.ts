import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  actorId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { NOTIFICATION_SEVERITIES, NOTIFICATION_TYPES } from '@kampalasmart/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_SEVERITIES as unknown as string[])
  severity?: string;
}

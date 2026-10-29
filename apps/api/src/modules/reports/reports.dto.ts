import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const REPORT_GRANULARITIES = ['day', 'week', 'month'] as const;
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number];

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  trendDays?: number;
}

export class ReportRangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn(REPORT_GRANULARITIES)
  granularity?: ReportGranularity;
}

export class ProductReportQueryDto extends ReportRangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ReportExportQueryDto extends ReportRangeDto {
  @IsIn(['products', 'stock', 'customers', 'suppliers', 'tax'])
  report!: 'products' | 'stock' | 'customers' | 'suppliers' | 'tax';
}

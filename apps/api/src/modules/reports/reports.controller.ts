import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@kampalasmart/shared';
import { CurrentAuth, RequirePermissions } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  DashboardQueryDto,
  ProductReportQueryDto,
  ReportExportQueryDto,
  ReportRangeDto,
} from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Branch-aware dashboard computed from recorded sales and stock' })
  dashboard(@CurrentAuth() auth: AuthUser, @Query() query: DashboardQueryDto) {
    return this.reports.dashboard(auth, query);
  }

  @Get('sales-summary')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Sales, profit and breakdowns for an inclusive date range' })
  salesSummary(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.salesSummary(auth, query);
  }

  @Get('profit-explanation')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Explain the profit change against the previous comparable period' })
  profitExplanation(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.profitExplanation(auth, query);
  }

  @Get('products')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Product sales, margin and cover report' })
  products(@CurrentAuth() auth: AuthUser, @Query() query: ProductReportQueryDto) {
    return this.reports.products(auth, query);
  }

  @Get('stock')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Stock valuation, status counts and movement summary' })
  stock(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.stock(auth, query);
  }

  @Get('customers')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Customer spend, frequency and new-customer report' })
  customers(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.customers(auth, query);
  }

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Supplier purchases and returns report' })
  suppliers(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.suppliers(auth, query);
  }

  @Get('tax')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({ summary: 'Output tax by rate, refunds and purchase input tax' })
  tax(@CurrentAuth() auth: AuthUser, @Query() query: ReportRangeDto) {
    return this.reports.tax(auth, query);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.REPORTS_READ, PERMISSIONS.EXPORTS_DATA)
  @ApiOperation({ summary: 'CSV export of a report for the selected range' })
  export(@CurrentAuth() auth: AuthUser, @Query() query: ReportExportQueryDto) {
    return this.reports.exportCsv(auth, query);
  }
}

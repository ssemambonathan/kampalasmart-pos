import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  dec,
  money,
  quantity as qty,
  type DashboardData,
  type PaymentMethod,
  type ProfitExplanation,
  type SaleSummary,
  type SalesSummaryReport,
} from '@kampalasmart/shared';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { toCsv } from '../../common/csv';
import {
  businessDayBounds,
  dayKey,
  parseDateRange,
  previousRange,
  timezoneOffsetMinutes,
  type DateRange,
} from '../../common/date-range';
import type { AuthUser } from '../../common/auth/auth-user';
import type {
  DashboardQueryDto,
  ProductReportQueryDto,
  ReportExportQueryDto,
  ReportRangeDto,
} from './reports.dto';

interface Scope {
  timezone: string;
  ids: string[];
  locations: Array<{ id: string; name: string }>;
}

interface PeriodFinancials {
  subtotal: ReturnType<typeof dec>;
  total: ReturnType<typeof dec>;
  tax: ReturnType<typeof dec>;
  discount: ReturnType<typeof dec>;
  cost: ReturnType<typeof dec>;
  transactions: number;
  refundTotal: ReturnType<typeof dec>;
  refundTax: ReturnType<typeof dec>;
  refundCost: ReturnType<typeof dec>;
  refundNet: ReturnType<typeof dec>;
  refundCount: number;
  netRevenue: ReturnType<typeof dec>;
  cogs: ReturnType<typeof dec>;
  profit: ReturnType<typeof dec>;
}

function changePercent(current: ReturnType<typeof dec>, previous: ReturnType<typeof dec>): number | null {
  if (previous.isZero()) return current.isZero() ? 0 : null;
  return Number(current.minus(previous).dividedBy(previous.abs()).times(100).toFixed(1));
}

function marginPercent(profit: ReturnType<typeof dec>, revenue: ReturnType<typeof dec>): number {
  if (revenue.isZero()) return 0;
  return Number(profit.dividedBy(revenue).times(100).toFixed(1));
}

function directionOf(value: ReturnType<typeof dec>): 'UP' | 'DOWN' | 'NEUTRAL' {
  if (value.isZero()) return 'NEUTRAL';
  return value.isNegative() ? 'DOWN' : 'UP';
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly inventory: InventoryService,
  ) {}

  private async scope(auth: AuthUser, locationId?: string): Promise<Scope> {
    const [business, locations] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({
        where: { id: auth.businessId },
        select: { timezone: true },
      }),
      this.access.listScopedLocations(auth),
    ]);
    let scoped = locations;
    if (locationId) {
      await this.access.assertLocation(auth, locationId);
      scoped = locations.filter((location) => location.id === locationId);
    }
    return {
      timezone: business.timezone,
      ids: scoped.map((location) => location.id),
      locations: scoped.map((location) => ({ id: location.id, name: location.name })),
    };
  }

  private range(query: ReportRangeDto, timezone: string): DateRange {
    return parseDateRange(query.from, query.to, { timezone, defaultDays: 30 });
  }

  private saleWhere(businessId: string, ids: string[], range: DateRange): Prisma.SaleWhereInput {
    return {
      businessId,
      locationId: { in: ids },
      createdAt: { gte: range.from, lte: range.to },
    };
  }

  private refundWhere(businessId: string, ids: string[], range: DateRange): Prisma.RefundWhereInput {
    return {
      businessId,
      locationId: { in: ids },
      status: 'COMPLETED',
      OR: [
        { completedAt: { gte: range.from, lte: range.to } },
        { completedAt: null, createdAt: { gte: range.from, lte: range.to } },
      ],
    };
  }

  private async financials(
    businessId: string,
    ids: string[],
    range: DateRange,
  ): Promise<PeriodFinancials> {
    const [sales, refunds] = await Promise.all([
      this.prisma.sale.aggregate({
        where: this.saleWhere(businessId, ids, range),
        _sum: {
          subtotal: true,
          total: true,
          taxTotal: true,
          discountTotal: true,
          costTotal: true,
        },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: this.refundWhere(businessId, ids, range),
        _sum: { total: true, taxTotal: true, costTotal: true },
        _count: { _all: true },
      }),
    ]);
    const subtotal = dec(sales._sum.subtotal ?? 0);
    const total = dec(sales._sum.total ?? 0);
    const tax = dec(sales._sum.taxTotal ?? 0);
    const discount = dec(sales._sum.discountTotal ?? 0);
    const cost = dec(sales._sum.costTotal ?? 0);
    const refundTotal = dec(refunds._sum.total ?? 0);
    const refundTax = dec(refunds._sum.taxTotal ?? 0);
    const refundCost = dec(refunds._sum.costTotal ?? 0);
    const refundNet = refundTotal.minus(refundTax);
    const netRevenue = total.minus(tax).minus(refundNet);
    const cogs = cost.minus(refundCost);
    return {
      subtotal,
      total,
      tax,
      discount,
      cost,
      transactions: sales._count._all,
      refundTotal,
      refundTax,
      refundCost,
      refundNet,
      refundCount: refunds._count._all,
      netRevenue,
      cogs,
      profit: netRevenue.minus(cogs),
    };
  }

  async dashboard(auth: AuthUser, query: DashboardQueryDto): Promise<DashboardData> {
    const scope = await this.scope(auth, query.locationId);
    const trendDays = query.trendDays ?? 7;
    const todayBounds = businessDayBounds(new Date(), scope.timezone);
    const previousBounds = businessDayBounds(
      new Date(todayBounds.start.getTime() - 1),
      scope.timezone,
    );
    const trendStart = new Date(todayBounds.start.getTime() - (trendDays - 1) * 86_400_000);
    const todayRange: DateRange = {
      from: todayBounds.start,
      to: todayBounds.end,
      days: 1,
    };
    const previousRangeValue: DateRange = {
      from: previousBounds.start,
      to: previousBounds.end,
      days: 1,
    };
    const trendRange: DateRange = { from: trendStart, to: todayBounds.end, days: trendDays };
    const offset = timezoneOffsetMinutes(scope.timezone);

    const locationSql = scope.ids.length
      ? Prisma.sql`AND r."locationId" IN (${Prisma.join(scope.ids)})`
      : Prisma.sql`AND FALSE`;

    const [
      today,
      previous,
      trendSales,
      trendRefundRows,
      paymentRows,
      branchSales,
      branchRefunds,
      topRows,
      inventoryLevels,
      recentSales,
      pendingRefunds,
      pendingTransfers,
      pendingConflicts,
      lowStock,
    ] = await Promise.all([
      this.financials(auth.businessId, scope.ids, todayRange),
      this.financials(auth.businessId, scope.ids, previousRangeValue),
      this.prisma.sale.findMany({
        where: this.saleWhere(auth.businessId, scope.ids, trendRange),
        select: { createdAt: true, total: true, taxTotal: true, costTotal: true },
      }),
      this.prisma.$queryRaw<Array<{ period: string; revenueImpact: string; profitImpact: string }>>`
        SELECT to_char(
                 date_trunc('day', COALESCE(r."completedAt", r."createdAt") + make_interval(mins => ${offset}::int)),
                 'YYYY-MM-DD'
               ) AS period,
               COALESCE(SUM(r."total" - r."taxTotal"), 0)::text AS "revenueImpact",
               COALESCE(SUM(r."total" - r."taxTotal" - r."costTotal"), 0)::text AS "profitImpact"
        FROM "Refund" r
        WHERE r."businessId" = ${auth.businessId}
          AND r."status" = 'COMPLETED'
          AND COALESCE(r."completedAt", r."createdAt") >= ${trendStart}
          AND COALESCE(r."completedAt", r."createdAt") <= ${todayBounds.end}
          ${locationSql}
        GROUP BY 1
      `,
      this.prisma.payment.groupBy({
        by: ['method'],
        where: {
          businessId: auth.businessId,
          // Payment methods are reported in the business period of their sale,
          // which may differ from when an offline sale reached the server.
          sale: {
            locationId: { in: scope.ids },
            createdAt: { gte: todayRange.from, lte: todayRange.to },
          },
        },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      this.prisma.sale.groupBy({
        by: ['locationId'],
        where: this.saleWhere(auth.businessId, scope.ids, todayRange),
        _sum: { total: true, taxTotal: true, costTotal: true },
        _count: { _all: true },
      }),
      this.prisma.refund.groupBy({
        by: ['locationId'],
        where: this.refundWhere(auth.businessId, scope.ids, todayRange),
        _sum: { total: true, taxTotal: true, costTotal: true },
      }),
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
          sale: {
            businessId: auth.businessId,
            locationId: { in: scope.ids },
            createdAt: { gte: todayRange.from, lte: todayRange.to },
          },
        },
        _sum: { quantity: true, lineTotal: true, taxAmount: true, totalCost: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
      this.prisma.inventoryLevel.findMany({
        where: { businessId: auth.businessId, locationId: { in: scope.ids } },
        select: { quantity: true, product: { select: { costPrice: true } } },
      }),
      this.prisma.sale.findMany({
        where: this.saleWhere(auth.businessId, scope.ids, todayRange),
        include: {
          location: { select: { name: true } },
          cashier: { select: { name: true } },
          customer: { select: { name: true } },
          payments: { select: { method: true }, orderBy: { amount: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.refund.count({
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          status: 'PENDING',
        },
      }),
      this.prisma.stockTransfer.count({
        where: {
          businessId: auth.businessId,
          status: 'PENDING',
          OR: [
            { fromLocationId: { in: scope.ids } },
            { toLocationId: { in: scope.ids } },
          ],
        },
      }),
      this.prisma.syncConflict.count({
        where: { businessId: auth.businessId, status: 'OPEN' },
      }),
      this.inventory.lowStock(auth, { locationId: query.locationId, limit: 5 }),
    ]);

    const trendBuckets = new Map<
      string,
      { date: string; sales: ReturnType<typeof dec>; profit: ReturnType<typeof dec>; transactions: number }
    >();
    for (let index = 0; index < trendDays; index += 1) {
      const date = dayKey(new Date(trendStart.getTime() + index * 86_400_000), scope.timezone);
      trendBuckets.set(date, { date, sales: dec(0), profit: dec(0), transactions: 0 });
    }
    for (const sale of trendSales) {
      const bucket = trendBuckets.get(dayKey(sale.createdAt, scope.timezone));
      if (!bucket) continue;
      bucket.sales = bucket.sales.plus(sale.total.minus(sale.taxTotal));
      bucket.profit = bucket.profit.plus(sale.total.minus(sale.taxTotal).minus(sale.costTotal));
      bucket.transactions += 1;
    }
    for (const row of trendRefundRows) {
      const bucket = trendBuckets.get(row.period);
      if (!bucket) continue;
      bucket.sales = bucket.sales.minus(dec(row.revenueImpact));
      bucket.profit = bucket.profit.minus(dec(row.profitImpact));
    }

    const topProducts = await this.productNames(topRows.map((row) => row.productId));
    const refundByBranch = new Map(branchRefunds.map((row) => [row.locationId, row]));
    const branches = new Map(scope.locations.map((location) => [location.id, location.name]));

    const inventoryValue = inventoryLevels.reduce(
      (total, level) => total.plus(level.quantity.times(level.product.costPrice)),
      dec(0),
    );

    return {
      today: {
        sales: money(today.netRevenue),
        transactions: today.transactions,
        profit: money(today.profit),
        refunds: money(today.refundTotal),
        discounts: money(today.discount),
        averageSale: money(
          today.transactions > 0 ? today.total.dividedBy(today.transactions) : dec(0),
        ),
      },
      comparison: {
        salesChangePercent: changePercent(today.netRevenue, previous.netRevenue),
        profitChangePercent: changePercent(today.profit, previous.profit),
        transactionChangePercent: changePercent(
          dec(today.transactions),
          dec(previous.transactions),
        ),
      },
      trend: [...trendBuckets.values()].map((bucket) => ({
        date: bucket.date,
        sales: money(bucket.sales),
        profit: money(bucket.profit),
        transactions: bucket.transactions,
      })),
      topProducts: topRows.map((row) => {
        const revenue = dec(row._sum.lineTotal ?? 0).minus(dec(row._sum.taxAmount ?? 0));
        const profit = revenue.minus(dec(row._sum.totalCost ?? 0));
        return {
          productId: row.productId,
          name: topProducts.get(row.productId)?.name ?? 'Removed product',
          quantity: qty(row._sum.quantity ?? 0),
          revenue: money(revenue),
          profit: money(profit),
        };
      }),
      paymentBreakdown: paymentRows.map((row) => ({
        method: row.method as PaymentMethod,
        amount: money(row._sum.amount ?? 0),
        count: row._count._all,
      })),
      branchPerformance: branchSales
        .map((row) => {
          const refund = refundByBranch.get(row.locationId);
          const refundRevenue = refund
            ? dec(refund._sum.total ?? 0).minus(dec(refund._sum.taxTotal ?? 0))
            : dec(0);
          const refundImpact = refund
            ? dec(refund._sum.total ?? 0)
                .minus(dec(refund._sum.taxTotal ?? 0))
                .minus(dec(refund._sum.costTotal ?? 0))
            : dec(0);
          const profit = dec(row._sum.total ?? 0)
            .minus(dec(row._sum.taxTotal ?? 0))
            .minus(dec(row._sum.costTotal ?? 0))
            .minus(refundImpact);
          return {
            locationId: row.locationId,
            name: branches.get(row.locationId) ?? 'Branch',
            sales: money(
              dec(row._sum.total ?? 0).minus(dec(row._sum.taxTotal ?? 0)).minus(refundRevenue),
            ),
            transactions: row._count._all,
            profit: money(profit),
          };
        })
        .sort((a, b) => Number(b.sales) - Number(a.sales)),
      lowStock,
      recentSales: recentSales.map<SaleSummary>((sale) => ({
        id: sale.id,
        saleNumber: sale.saleNumber,
        locationName: sale.location.name,
        cashierName: sale.cashier.name,
        customerName: sale.customer?.name ?? null,
        status: sale.status,
        total: sale.total.toFixed(2),
        paymentMethod: (sale.payments[0]?.method as PaymentMethod | undefined) ?? null,
        createdAt: sale.createdAt.toISOString(),
      })),
      inventoryValue: money(inventoryValue),
      pending: {
        refunds: pendingRefunds,
        transfers: pendingTransfers,
        syncConflicts: pendingConflicts,
      },
    };
  }

  async salesSummary(auth: AuthUser, query: ReportRangeDto): Promise<SalesSummaryReport> {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const financials = await this.financials(auth.businessId, scope.ids, range);
    const granularity = query.granularity ?? 'day';
    const offset = timezoneOffsetMinutes(scope.timezone);
    const format = granularity === 'day' ? 'YYYY-MM-DD' : granularity === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM';
    const locationSql = scope.ids.length
      ? Prisma.sql`AND s."locationId" IN (${Prisma.join(scope.ids)})`
      : Prisma.sql`AND FALSE`;
    const refundLocationSql = scope.ids.length
      ? Prisma.sql`AND r."locationId" IN (${Prisma.join(scope.ids)})`
      : Prisma.sql`AND FALSE`;

    const [seriesRows, refundSeries, paymentRows, locationRows, refundLocationRows, cashierRows, cashierRefundRows, categoryRows, categoryRefundRows, topRows, discountRows, soldItems, refundedItems] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ period: string; sales: string; profit: string; transactions: number }>>`
          SELECT to_char(
                   date_trunc(${granularity}::text, s."createdAt" + make_interval(mins => ${offset}::int)),
                   ${format}::text
                 ) AS period,
                 COALESCE(SUM(s."total" - s."taxTotal"), 0)::text AS sales,
                 COALESCE(SUM(s."total" - s."taxTotal" - s."costTotal"), 0)::text AS profit,
                 COUNT(*)::int AS transactions
          FROM "Sale" s
          WHERE s."businessId" = ${auth.businessId}
            AND s."createdAt" >= ${range.from}
            AND s."createdAt" <= ${range.to}
            ${locationSql}
          GROUP BY 1
          ORDER BY 1
        `,
        this.prisma.$queryRaw<Array<{ period: string; revenueImpact: string; profitImpact: string }>>`
          SELECT to_char(
                   date_trunc(${granularity}::text, COALESCE(r."completedAt", r."createdAt") + make_interval(mins => ${offset}::int)),
                   ${format}::text
                 ) AS period,
                 COALESCE(SUM(r."total" - r."taxTotal"), 0)::text AS "revenueImpact",
                 COALESCE(SUM(r."total" - r."taxTotal" - r."costTotal"), 0)::text AS "profitImpact"
          FROM "Refund" r
          WHERE r."businessId" = ${auth.businessId}
            AND r."status" = 'COMPLETED'
            AND COALESCE(r."completedAt", r."createdAt") >= ${range.from}
            AND COALESCE(r."completedAt", r."createdAt") <= ${range.to}
            ${refundLocationSql}
          GROUP BY 1
        `,
        this.prisma.payment.groupBy({
          by: ['method'],
          where: {
            businessId: auth.businessId,
            sale: {
              locationId: { in: scope.ids },
              createdAt: { gte: range.from, lte: range.to },
            },
          },
          _sum: { amount: true },
          _count: { _all: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
        this.prisma.sale.groupBy({
          by: ['locationId'],
          where: this.saleWhere(auth.businessId, scope.ids, range),
          _sum: { total: true, taxTotal: true, costTotal: true },
          _count: { _all: true },
        }),
        this.prisma.refund.groupBy({
          by: ['locationId'],
          where: this.refundWhere(auth.businessId, scope.ids, range),
          _sum: { total: true, taxTotal: true, costTotal: true },
        }),
        this.prisma.sale.groupBy({
          by: ['cashierId'],
          where: this.saleWhere(auth.businessId, scope.ids, range),
          _sum: { total: true, taxTotal: true, costTotal: true },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<
          Array<{ cashierId: string; total: string; taxTotal: string; costTotal: string }>
        >`
          SELECT s."cashierId" AS "cashierId",
                 COALESCE(SUM(r."total"), 0)::text AS "total",
                 COALESCE(SUM(r."taxTotal"), 0)::text AS "taxTotal",
                 COALESCE(SUM(r."costTotal"), 0)::text AS "costTotal"
          FROM "Refund" r
          JOIN "Sale" s ON s.id = r."saleId"
          WHERE r."businessId" = ${auth.businessId}
            AND r."status" = 'COMPLETED'
            AND COALESCE(r."completedAt", r."createdAt") >= ${range.from}
            AND COALESCE(r."completedAt", r."createdAt") <= ${range.to}
            ${refundLocationSql}
          GROUP BY s."cashierId"
        `,
        this.prisma.$queryRaw<
          Array<{ categoryId: string | null; name: string; sales: string; profit: string; quantity: string }>
        >`
          SELECT p."categoryId" AS "categoryId",
                 COALESCE(c.name, 'Uncategorised') AS name,
                 COALESCE(SUM(si."lineTotal" - si."taxAmount"), 0)::text AS sales,
                 COALESCE(SUM(si."lineTotal" - si."taxAmount" - si."totalCost"), 0)::text AS profit,
                 COALESCE(SUM(si.quantity), 0)::text AS quantity
          FROM "SaleItem" si
          JOIN "Sale" s ON s.id = si."saleId"
          LEFT JOIN "Product" p ON p.id = si."productId"
          LEFT JOIN "Category" c ON c.id = p."categoryId"
          WHERE s."businessId" = ${auth.businessId}
            AND s."createdAt" >= ${range.from}
            AND s."createdAt" <= ${range.to}
            ${locationSql}
          GROUP BY p."categoryId", c.name
          ORDER BY SUM(si."lineTotal" - si."taxAmount") DESC
        `,
        this.prisma.$queryRaw<
          Array<{
            categoryId: string | null;
            name: string;
            sales: string;
            profit: string;
            quantity: string;
          }>
        >`
          SELECT p."categoryId" AS "categoryId",
                 COALESCE(c.name, 'Uncategorised') AS name,
                 COALESCE(SUM(ri."amount" - si."taxAmount" * (ri.quantity / si.quantity)), 0)::text AS sales,
                 COALESCE(SUM(
                   ri."amount" - si."taxAmount" * (ri.quantity / si.quantity)
                   - si."totalCost" * (ri.quantity / si.quantity)
                 ), 0)::text AS profit,
                 COALESCE(SUM(ri.quantity), 0)::text AS quantity
          FROM "RefundItem" ri
          JOIN "Refund" r ON r.id = ri."refundId"
          JOIN "SaleItem" si ON si.id = ri."saleItemId"
          LEFT JOIN "Product" p ON p.id = si."productId"
          LEFT JOIN "Category" c ON c.id = p."categoryId"
          WHERE r."businessId" = ${auth.businessId}
            AND r."status" = 'COMPLETED'
            AND COALESCE(r."completedAt", r."createdAt") >= ${range.from}
            AND COALESCE(r."completedAt", r."createdAt") <= ${range.to}
            ${refundLocationSql}
          GROUP BY p."categoryId", c.name
        `,
        this.prisma.saleItem.groupBy({
          by: ['productId', 'productName', 'sku'],
          where: { sale: this.saleWhere(auth.businessId, scope.ids, range) },
          _sum: { quantity: true, lineTotal: true, taxAmount: true, totalCost: true },
          orderBy: { _sum: { lineTotal: 'desc' } },
          take: 10,
        }),
        this.prisma.sale.findMany({
          where: {
            ...this.saleWhere(auth.businessId, scope.ids, range),
            discountTotal: { gt: 0 },
          },
          include: { cashier: { select: { name: true } } },
          orderBy: { discountTotal: 'desc' },
          take: 20,
        }),
        this.prisma.saleItem.aggregate({
          where: { sale: this.saleWhere(auth.businessId, scope.ids, range) },
          _sum: { quantity: true },
        }),
        this.prisma.refundItem.aggregate({
          where: {
            refund: this.refundWhere(auth.businessId, scope.ids, range),
          },
          _sum: { quantity: true },
        }),
      ]);

    const seriesMap = new Map(
      seriesRows.map((row) => [
        row.period,
        { period: row.period, sales: dec(row.sales), profit: dec(row.profit), transactions: row.transactions },
      ]),
    );
    for (const refund of refundSeries) {
      const bucket = seriesMap.get(refund.period);
      if (!bucket) continue;
      bucket.sales = bucket.sales.minus(dec(refund.revenueImpact));
      bucket.profit = bucket.profit.minus(dec(refund.profitImpact));
    }

    const refundByLocation = new Map(refundLocationRows.map((row) => [row.locationId, row]));
    const refundByCashier = new Map(cashierRefundRows.map((row) => [row.cashierId, row]));
    const cashierIds = [
      ...new Set([
        ...cashierRows.map((row) => row.cashierId),
        ...cashierRefundRows.map((row) => row.cashierId),
      ]),
    ];
    const [locationRowsData, cashiers] = await Promise.all([
      this.prisma.location.findMany({
        where: { id: { in: locationRows.map((row) => row.locationId) } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: cashierIds } },
        select: { id: true, name: true },
      }),
    ]);
    const locationNames = new Map(locationRowsData.map((row) => [row.id, row.name]));
    const cashierNames = new Map(cashiers.map((row) => [row.id, row.name]));
    const itemsSold = dec(soldItems._sum.quantity ?? 0).minus(
      dec(refundedItems._sum.quantity ?? 0),
    );

    return {
      totals: {
        grossSales: money(financials.subtotal),
        netSales: money(financials.netRevenue),
        discounts: money(financials.discount),
        tax: money(financials.tax.minus(financials.refundTax)),
        refunds: money(financials.refundTotal),
        costOfGoods: money(financials.cogs),
        grossProfit: money(financials.profit),
        transactions: financials.transactions,
        averageSale: money(
          financials.transactions > 0
            ? financials.total.dividedBy(financials.transactions)
            : dec(0),
        ),
        itemsSold: qty(itemsSold),
      },
      series: [...seriesMap.values()].map((row) => ({
        period: row.period,
        sales: money(row.sales),
        profit: money(row.profit),
        transactions: row.transactions,
      })),
      byPaymentMethod: paymentRows.map((row) => ({
        method: row.method as PaymentMethod,
        amount: money(row._sum.amount ?? 0),
        count: row._count._all,
      })),
      byLocation: locationRows
        .map((row) => {
          const refund = refundByLocation.get(row.locationId);
          const impact = refund
            ? dec(refund._sum.total ?? 0)
                .minus(dec(refund._sum.taxTotal ?? 0))
                .minus(dec(refund._sum.costTotal ?? 0))
            : dec(0);
          return {
            locationId: row.locationId,
            name: locationNames.get(row.locationId) ?? 'Branch',
            sales: money(
              dec(row._sum.total ?? 0)
                .minus(dec(row._sum.taxTotal ?? 0))
                .minus(dec(refund?._sum.total ?? 0).minus(dec(refund?._sum.taxTotal ?? 0))),
            ),
            profit: money(
              dec(row._sum.total ?? 0)
                .minus(dec(row._sum.taxTotal ?? 0))
                .minus(dec(row._sum.costTotal ?? 0))
                .minus(impact),
            ),
            transactions: row._count._all,
          };
        })
        .sort((a, b) => Number(b.sales) - Number(a.sales)),
      byCashier: cashierIds
        .map((cashierId) => {
          const row = cashierRows.find((entry) => entry.cashierId === cashierId);
          const refund = refundByCashier.get(cashierId);
          const refundNet = refund
            ? dec(refund.total).minus(dec(refund.taxTotal))
            : dec(0);
          const refundProfit = refund
            ? dec(refund.total).minus(dec(refund.taxTotal)).minus(dec(refund.costTotal))
            : dec(0);
          return {
            userId: cashierId,
            name: cashierNames.get(cashierId) ?? 'Unknown user',
            sales: money(
              dec(row?._sum.total ?? 0).minus(dec(row?._sum.taxTotal ?? 0)).minus(refundNet),
            ),
            profit: money(
              dec(row?._sum.total ?? 0)
                .minus(dec(row?._sum.taxTotal ?? 0))
                .minus(dec(row?._sum.costTotal ?? 0))
                .minus(refundProfit),
            ),
            transactions: row?._count._all ?? 0,
          };
        })
        .sort((a, b) => Number(b.sales) - Number(a.sales)),
      byCategory: this.categoryPerformance(categoryRows, categoryRefundRows)
        .map((row) => ({
          categoryId: row.categoryId,
          name: row.name,
          sales: money(row.sales),
          profit: money(row.profit),
          quantity: qty(row.quantity),
        }))
        .sort((a, b) => Number(b.sales) - Number(a.sales)),
      topProducts: topRows.map((row) => {
        const revenue = dec(row._sum.lineTotal ?? 0).minus(dec(row._sum.taxAmount ?? 0));
        return {
          productId: row.productId,
          name: row.productName,
          sku: row.sku,
          quantity: qty(row._sum.quantity ?? 0),
          revenue: money(revenue),
          profit: money(revenue.minus(dec(row._sum.totalCost ?? 0))),
        };
      }),
      discounts: discountRows.map((sale) => ({
        saleNumber: sale.saleNumber,
        cashierName: sale.cashier.name,
        discount: sale.discountTotal.toFixed(2),
        total: sale.total.toFixed(2),
        createdAt: sale.createdAt.toISOString(),
      })),
    };
  }

  /** Nets completed refunds into the per-category sales, profit and units. */
  private categoryPerformance(
    sales: Array<{ categoryId: string | null; name: string; sales: string; profit: string; quantity: string }>,
    refunds: Array<{ categoryId: string | null; name: string; sales: string; profit: string; quantity: string }>,
  ) {
    const entries = new Map<
      string,
      {
        categoryId: string | null;
        name: string;
        sales: ReturnType<typeof dec>;
        profit: ReturnType<typeof dec>;
        quantity: ReturnType<typeof dec>;
      }
    >();
    const add = (
      row: { categoryId: string | null; name: string; sales: string; profit: string; quantity: string },
      sign: 1 | -1,
    ) => {
      const key = row.categoryId ?? '__uncategorised__';
      const entry = entries.get(key) ?? {
        categoryId: row.categoryId,
        name: row.name,
        sales: dec(0),
        profit: dec(0),
        quantity: dec(0),
      };
      entry.sales = sign === 1 ? entry.sales.plus(row.sales) : entry.sales.minus(row.sales);
      entry.profit = sign === 1 ? entry.profit.plus(row.profit) : entry.profit.minus(row.profit);
      entry.quantity =
        sign === 1 ? entry.quantity.plus(row.quantity) : entry.quantity.minus(row.quantity);
      entries.set(key, entry);
    };
    for (const row of sales) add(row, 1);
    for (const row of refunds) add(row, -1);
    return [...entries.values()];
  }

  async profitExplanation(auth: AuthUser, query: ReportRangeDto): Promise<ProfitExplanation> {    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const previous = previousRange(range);
    const [current, prior] = await Promise.all([
      this.financials(auth.businessId, scope.ids, range),
      this.financials(auth.businessId, scope.ids, previous),
    ]);

    const [currentProducts, priorProducts] = await Promise.all([
      this.productProfit(auth.businessId, scope.ids, range),
      this.productProfit(auth.businessId, scope.ids, previous),
    ]);

    const preCurrent = current.netRevenue.plus(current.discount);
    const prePrevious = prior.netRevenue.plus(prior.discount);
    const avgPreCurrent = current.transactions > 0 ? preCurrent.dividedBy(current.transactions) : dec(0);
    const avgPrePrevious = prior.transactions > 0 ? prePrevious.dividedBy(prior.transactions) : dec(0);
    const volumeImpact = dec(current.transactions - prior.transactions).times(avgPrePrevious);
    const basketImpact = dec(current.transactions).times(avgPreCurrent.minus(avgPrePrevious));
    const discountImpact = prior.discount.minus(current.discount);
    const refundImpact = prior.refundNet
      .minus(current.refundNet)
      .minus(prior.refundCost.minus(current.refundCost));
    const cogsImpact = prior.cogs.minus(current.cogs);
    const profitChange = current.profit.minus(prior.profit);

    const reasons: ProfitExplanation['reasons'] = [
      {
        title: 'Sales volume',
        detail:
          current.transactions === prior.transactions
            ? `Transactions were unchanged at ${current.transactions}.`
            : `Transactions moved from ${prior.transactions} to ${current.transactions}. At the previous average basket this ${current.transactions > prior.transactions ? 'added' : 'reduced'} ${money(volumeImpact.abs())} of pre-discount revenue.`,
        impact: money(volumeImpact),
        direction: directionOf(volumeImpact),
      },
      {
        title: 'Average basket',
        detail: `Average pre-discount net revenue per sale moved from ${money(avgPrePrevious)} to ${money(avgPreCurrent)} across ${current.transactions} sales.`,
        impact: money(basketImpact),
        direction: directionOf(basketImpact),
      },
      {
        title: 'Discounts given',
        detail: `Discounts were ${money(current.discount)} against ${money(prior.discount)} in the previous period.`,
        impact: money(discountImpact),
        direction: directionOf(discountImpact),
      },
      {
        title: 'Refunds and returns',
        detail: `Completed refunds returned ${money(current.refundNet)} of net revenue in this period versus ${money(prior.refundNet)} previously, with ${money(current.refundCost)} and ${money(prior.refundCost)} of goods restocked.`,
        impact: money(refundImpact),
        direction: directionOf(refundImpact),
      },
      {
        title: 'Cost of goods sold',
        detail: `Cost of goods sold was ${money(current.cogs)} this period against ${money(prior.cogs)} previously.`,
        impact: money(cogsImpact),
        direction: directionOf(cogsImpact),
      },
    ];

    const productIds = new Set([...currentProducts.keys(), ...priorProducts.keys()]);
    let largest: { productId: string; name: string; profitChange: ReturnType<typeof dec> } | null = null;
    let largestAbs = dec(0);
    for (const productId of productIds) {
      const currentProfit = currentProducts.get(productId)?.profit ?? dec(0);
      const priorProfit = priorProducts.get(productId)?.profit ?? dec(0);
      const difference = currentProfit.minus(priorProfit);
      if (difference.abs().greaterThan(largestAbs)) {
        largestAbs = difference.abs();
        largest = {
          productId,
          name:
            currentProducts.get(productId)?.name ??
            priorProducts.get(productId)?.name ??
            'Removed product',
          profitChange: difference,
        };
      }
    }

    const negative = reasons
      .filter((reason) => reason.direction === 'DOWN')
      .sort((a, b) => Number(a.impact) - Number(b.impact));
    let suggestedAction: string;
    if (negative.length > 0) {
      const worst = negative[0]!;
      suggestedAction =
        worst.title === 'Cost of goods sold'
          ? 'Review supplier prices for your highest-cost products and renegotiate or reprice before the next purchase order. The explanation above shows exactly how much margin the cost change absorbed.'
          : worst.title === 'Discounts given'
            ? 'Review who approved discounts this period. Set a lower cashier discount limit or require manager approval for anything above your normal promotion depth.'
            : worst.title === 'Refunds and returns'
              ? 'Open the refund reasons for this period, check whether the top refunded products have a quality or description problem, and tighten receipt checks.'
              : worst.title === 'Sales volume'
                ? 'Transactions fell. Check branch opening hours and stock availability of your best sellers, then run a targeted promotion on the products that drove this period last time.'
                : 'Average basket value fell. Train cashiers to suggest complements at the till and bundle the products customers already buy together.';
    } else if (profitChange.isNegative()) {
      suggestedAction =
        'Protect the margin you have: review supplier costs and hold discounts until profit recovers. The reasons above show which component moved profit.';
    } else {
      suggestedAction =
        'Profit is up. Keep the current pricing and purchasing mix, and confirm the products behind the increase are well stocked so the trend continues.';
    }

    return {
      currentPeriod: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        revenue: money(current.netRevenue),
        profit: money(current.profit),
        marginPercent: marginPercent(current.profit, current.netRevenue),
      },
      previousPeriod: {
        from: dayKey(previous.from, scope.timezone),
        to: dayKey(previous.to, scope.timezone),
        revenue: money(prior.netRevenue),
        profit: money(prior.profit),
        marginPercent: marginPercent(prior.profit, prior.netRevenue),
      },
      profitChange: money(profitChange),
      profitChangePercent: changePercent(current.profit, prior.profit),
      reasons,
      largestContributor: largest
        ? {
            productId: largest.productId,
            name: largest.name,
            profitChange: money(largest.profitChange),
          }
        : null,
      suggestedAction,
      basedOn: `${current.transactions} sales from ${dayKey(range.from, scope.timezone)} to ${dayKey(range.to, scope.timezone)} compared with ${prior.transactions} sales from ${dayKey(previous.from, scope.timezone)} to ${dayKey(previous.to, scope.timezone)} (${scope.timezone}). Amounts exclude tax.`,
    };
  }

  async products(auth: AuthUser, query: ProductReportQueryDto) {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const [products, soldRows, stockRows] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          businessId: auth.businessId,
          deletedAt: null,
          isActive: true,
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { sku: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: {
          category: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        take: 2000,
      }),
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: this.saleWhere(auth.businessId, scope.ids, range) },
        _sum: { quantity: true, lineTotal: true, taxAmount: true, totalCost: true },
      }),
      this.prisma.inventoryLevel.groupBy({
        by: ['productId'],
        where: { businessId: auth.businessId, locationId: { in: scope.ids } },
        _sum: { quantity: true },
      }),
    ]);

    const sold = new Map(soldRows.map((row) => [row.productId, row]));
    const stock = new Map(stockRows.map((row) => [row.productId, dec(row._sum.quantity ?? 0)]));
    const rows = products
      .map((product) => {
        const saleRow = sold.get(product.id);
        const quantitySold = dec(saleRow?._sum.quantity ?? 0);
        const revenue = dec(saleRow?._sum.lineTotal ?? 0).minus(dec(saleRow?._sum.taxAmount ?? 0));
        const cost = dec(saleRow?._sum.totalCost ?? 0);
        const profit = revenue.minus(cost);
        const onHand = stock.get(product.id) ?? dec(0);
        const averageDaily = quantitySold.dividedBy(range.days);
        return {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          categoryName: product.category?.name ?? null,
          supplierName: product.supplier?.name ?? null,
          unit: product.unit,
          quantitySold: qty(quantitySold),
          revenue: money(revenue),
          cost: money(cost),
          profit: money(profit),
          marginPercent: marginPercent(profit, revenue),
          stockOnHand: qty(onHand),
          averageDailySales: qty(averageDaily),
          daysOfCover:
            averageDaily.greaterThan(0) && onHand.greaterThan(0)
              ? Math.round(onHand.dividedBy(averageDaily).toNumber() * 10) / 10
              : null,
        };
      })
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));

    return {
      range: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        days: range.days,
      },
      totals: {
        revenue: money(rows.reduce((total, row) => total.plus(row.revenue), dec(0))),
        profit: money(rows.reduce((total, row) => total.plus(row.profit), dec(0))),
        quantity: qty(rows.reduce((total, row) => total.plus(row.quantitySold), dec(0))),
        products: rows.length,
        productsSold: rows.filter((row) => !dec(row.quantitySold).isZero()).length,
      },
      rows,
    };
  }

  async stock(auth: AuthUser, query: ReportRangeDto) {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const [levels, movements] = await Promise.all([
      this.prisma.inventoryLevel.findMany({
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          product: { deletedAt: null },
        },
        include: {
          product: {
            select: {
              name: true,
              sku: true,
              costPrice: true,
              reorderLevel: true,
              safetyStock: true,
              category: { select: { name: true } },
            },
          },
          location: { select: { name: true } },
        },
      }),
      this.prisma.inventoryMovement.groupBy({
        by: ['movementType'],
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { quantity: true, totalCost: true },
        _count: { _all: true },
      }),
    ]);

    const byLocation = new Map<
      string,
      { locationId: string; name: string; value: ReturnType<typeof dec>; quantity: ReturnType<typeof dec>; skuCount: number }
    >();
    const byCategory = new Map<
      string,
      { name: string; value: ReturnType<typeof dec>; quantity: ReturnType<typeof dec>; skuCount: number }
    >();
    const rows = levels.map((level) => {
      const value = level.quantity.times(level.product.costPrice);
      const quantity = level.quantity;
      const locationEntry = byLocation.get(level.locationId) ?? {
        locationId: level.locationId,
        name: level.location.name,
        value: dec(0),
        quantity: dec(0),
        skuCount: 0,
      };
      locationEntry.value = locationEntry.value.plus(value);
      locationEntry.quantity = locationEntry.quantity.plus(quantity);
      locationEntry.skuCount += 1;
      byLocation.set(level.locationId, locationEntry);

      const categoryName = level.product.category?.name ?? 'Uncategorised';
      const categoryEntry = byCategory.get(categoryName) ?? {
        name: categoryName,
        value: dec(0),
        quantity: dec(0),
        skuCount: 0,
      };
      categoryEntry.value = categoryEntry.value.plus(value);
      categoryEntry.quantity = categoryEntry.quantity.plus(quantity);
      categoryEntry.skuCount += 1;
      byCategory.set(categoryName, categoryEntry);

      const quantityNumber = level.quantity.toNumber();
      const reorder = level.product.reorderLevel.toNumber();
      const safety = level.product.safetyStock.toNumber();
      return {
        productId: level.productId,
        productName: level.product.name,
        sku: level.product.sku,
        categoryName: level.product.category?.name ?? null,
        locationId: level.locationId,
        locationName: level.location.name,
        quantity: qty(level.quantity),
        unitCost: level.product.costPrice.toFixed(2),
        value: money(value),
        reorderLevel: level.product.reorderLevel.toFixed(3),
        safetyStock: level.product.safetyStock.toFixed(3),
        status:
          quantityNumber <= 0
            ? 'OUT_OF_STOCK'
            : quantityNumber <= safety
              ? 'CRITICAL'
              : quantityNumber <= reorder
                ? 'LOW'
                : 'OK',
      };
    });

    const totalValue = levels.reduce(
      (total, level) => total.plus(level.quantity.times(level.product.costPrice)),
      dec(0),
    );
    const totalQuantity = levels.reduce((total, level) => total.plus(level.quantity), dec(0));

    return {
      asOf: new Date().toISOString(),
      range: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        days: range.days,
      },
      totals: {
        value: money(totalValue),
        quantity: qty(totalQuantity),
        skuCount: new Set(levels.map((level) => level.productId)).size,
        locationCount: new Set(levels.map((level) => level.locationId)).size,
        lowStock: rows.filter((row) => row.status === 'LOW').length,
        critical: rows.filter((row) => row.status === 'CRITICAL').length,
        outOfStock: rows.filter((row) => row.status === 'OUT_OF_STOCK').length,
      },
      byLocation: [...byLocation.values()]
        .map((row) => ({
          locationId: row.locationId,
          name: row.name,
          value: money(row.value),
          quantity: qty(row.quantity),
          skuCount: row.skuCount,
        }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
      byCategory: [...byCategory.values()]
        .map((row) => ({
          name: row.name,
          value: money(row.value),
          quantity: qty(row.quantity),
          skuCount: row.skuCount,
        }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
      movements: movements.map((row) => ({
        movementType: row.movementType,
        quantity: qty(row._sum.quantity ?? 0),
        value: money(row._sum.totalCost ?? 0),
        count: row._count._all,
      })),
      rows: rows.sort((a, b) => Number(b.value) - Number(a.value)),
    };
  }

  async customers(auth: AuthUser, query: ReportRangeDto) {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const [saleRows, newCustomers, totalCustomers] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: this.saleWhere(auth.businessId, scope.ids, range),
        _sum: { total: true, taxTotal: true, costTotal: true },
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 200,
      }),
      this.prisma.customer.count({
        where: {
          businessId: auth.businessId,
          deletedAt: null,
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      this.prisma.customer.count({
        where: { businessId: auth.businessId, deletedAt: null, isActive: true },
      }),
    ]);

    const identified = saleRows.filter(
      (row): row is typeof row & { customerId: string } => row.customerId !== null,
    );
    const customerIds = identified.map((row) => row.customerId);
    const customers = await this.prisma.customer.findMany({
      where: { businessId: auth.businessId, id: { in: customerIds } },
      select: { id: true, name: true, phone: true, email: true },
    });
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const anonymous = saleRows.find((row) => row.customerId === null);

    const rows = identified.map((row) => {
      const customer = customerMap.get(row.customerId);
      const spend = dec(row._sum.total ?? 0);
      return {
        customerId: row.customerId,
        name: customer?.name ?? 'Removed customer',
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        spend: money(spend),
        profit: money(
          spend.minus(dec(row._sum.taxTotal ?? 0)).minus(dec(row._sum.costTotal ?? 0)),
        ),
        transactions: row._count._all,
        averageSale: money(
          row._count._all > 0 ? spend.dividedBy(row._count._all) : dec(0),
        ),
        lastPurchaseAt: row._max.createdAt?.toISOString() ?? null,
      };
    });

    const revenue = identified.reduce((total, row) => total.plus(row._sum.total ?? 0), dec(0));
    const anonymousRevenue = dec(anonymous?._sum.total ?? 0);
    return {
      range: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        days: range.days,
      },
      totals: {
        revenue: money(revenue.plus(anonymousRevenue)),
        identifiedRevenue: money(revenue),
        anonymousRevenue: money(anonymousRevenue),
        transactions: identified.reduce((total, row) => total + row._count._all, 0) + (anonymous?._count._all ?? 0),
        newCustomers,
        repeatCustomers: rows.filter((row) => row.transactions > 1).length,
        totalCustomers,
        averageSpend: money(
          rows.length > 0 ? revenue.dividedBy(rows.length) : dec(0),
        ),
      },
      rows,
    };
  }

  async suppliers(auth: AuthUser, query: ReportRangeDto) {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const [purchaseRows, returnRows] = await Promise.all([
      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { total: true, taxTotal: true },
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _sum: { total: 'desc' } },
      }),
      this.prisma.purchaseReturn.groupBy({
        by: ['supplierId'],
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const supplierIds = [
      ...new Set([...purchaseRows.map((row) => row.supplierId), ...returnRows.map((row) => row.supplierId)]),
    ];
    const suppliers = await this.prisma.supplier.findMany({
      where: { businessId: auth.businessId, id: { in: supplierIds } },
      select: { id: true, name: true, phone: true, email: true },
    });
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const returns = new Map(returnRows.map((row) => [row.supplierId, row]));

    const rows = supplierIds
      .map((supplierId) => {
        const purchase = purchaseRows.find((row) => row.supplierId === supplierId);
        const returned = returns.get(supplierId);
        const spend = dec(purchase?._sum.total ?? 0);
        const returnTotal = dec(returned?._sum.total ?? 0);
        return {
          supplierId,
          name: supplierMap.get(supplierId)?.name ?? 'Removed supplier',
          phone: supplierMap.get(supplierId)?.phone ?? null,
          email: supplierMap.get(supplierId)?.email ?? null,
          purchases: purchase?._count._all ?? 0,
          spend: money(spend),
          tax: money(purchase?._sum.taxTotal ?? 0),
          returns: money(returnTotal),
          returnCount: returned?._count._all ?? 0,
          netSpend: money(spend.minus(returnTotal)),
          lastPurchaseAt: purchase?._max.createdAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => Number(b.netSpend) - Number(a.netSpend));

    const totals = rows.reduce(
      (total, row) => ({
        spend: total.spend.plus(row.spend),
        netSpend: total.netSpend.plus(row.netSpend),
        returns: total.returns.plus(row.returns),
      }),
      { spend: dec(0), netSpend: dec(0), returns: dec(0) },
    );

    return {
      range: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        days: range.days,
      },
      totals: {
        spend: money(totals.spend),
        netSpend: money(totals.netSpend),
        purchases: rows.reduce((total, row) => total + row.purchases, 0),
        returns: money(totals.returns),
        suppliers: rows.length,
      },
      rows,
    };
  }

  async tax(auth: AuthUser, query: ReportRangeDto) {
    const scope = await this.scope(auth, query.locationId);
    const range = this.range(query, scope.timezone);
    const [rateRows, refunds, purchases] = await Promise.all([
      this.prisma.saleItem.groupBy({
        by: ['taxRate'],
        where: { sale: this.saleWhere(auth.businessId, scope.ids, range) },
        _sum: { taxAmount: true, lineTotal: true },
      }),
      this.prisma.refund.aggregate({
        where: this.refundWhere(auth.businessId, scope.ids, range),
        _sum: { taxTotal: true },
      }),
      this.prisma.purchase.aggregate({
        where: {
          businessId: auth.businessId,
          locationId: { in: scope.ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { taxTotal: true },
      }),
    ]);

    const rows = rateRows
      .map((row) => {
        const tax = dec(row._sum.taxAmount ?? 0);
        const gross = dec(row._sum.lineTotal ?? 0);
        return {
          taxRate: row.taxRate.toFixed(3),
          tax: money(tax),
          grossSales: money(gross),
          netSales: money(gross.minus(tax)),
        };
      })
      .sort((a, b) => Number(b.taxRate) - Number(a.taxRate));

    const outputTax = rateRows.reduce((total, row) => total.plus(row._sum.taxAmount ?? 0), dec(0));
    const refundTax = dec(refunds._sum.taxTotal ?? 0);
    const inputTax = dec(purchases._sum.taxTotal ?? 0);
    const netOutputTax = outputTax.minus(refundTax);
    return {
      range: {
        from: dayKey(range.from, scope.timezone),
        to: dayKey(range.to, scope.timezone),
        days: range.days,
      },
      totals: {
        outputTax: money(outputTax),
        refundTax: money(refundTax),
        netOutputTax: money(netOutputTax),
        inputTax: money(inputTax),
        netTaxDue: money(netOutputTax.minus(inputTax)),
      },
      rows,
      disclaimer:
        'This statement is computed from the tax amounts recorded on sales, refunds and purchases in KampalaSmart. It is a bookkeeping aid, not a filed return; confirm treatment with your tax adviser.',
    };
  }

  async exportCsv(auth: AuthUser, query: ReportExportQueryDto) {
    const filenameDate = new Date().toISOString().slice(0, 10);
    if (query.report === 'products') {
      const report = await this.products(auth, query);
      const csv = toCsv(
        [
          'sku',
          'name',
          'category',
          'supplier',
          'quantity_sold',
          'revenue',
          'cost',
          'profit',
          'margin_percent',
          'stock_on_hand',
          'average_daily_sales',
          'days_of_cover',
        ],
        report.rows.map((row) => [
          row.sku,
          row.name,
          row.categoryName ?? '',
          row.supplierName ?? '',
          row.quantitySold,
          row.revenue,
          row.cost,
          row.profit,
          row.marginPercent.toFixed(1),
          row.stockOnHand,
          row.averageDailySales,
          row.daysOfCover ?? '',
        ]),
      );
      return {
        filename: `product-report-${filenameDate}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: csv,
      };
    }
    if (query.report === 'stock') {
      const report = await this.stock(auth, query);
      const csv = toCsv(
        ['sku', 'product', 'category', 'location', 'quantity', 'unit_cost', 'value', 'status'],
        report.rows.map((row) => [
          row.sku,
          row.productName,
          row.categoryName ?? '',
          row.locationName,
          row.quantity,
          row.unitCost,
          row.value,
          row.status,
        ]),
      );
      return {
        filename: `stock-valuation-${filenameDate}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: csv,
      };
    }
    if (query.report === 'customers') {
      const report = await this.customers(auth, query);
      const csv = toCsv(
        ['customer', 'phone', 'email', 'spend', 'profit', 'transactions', 'average_sale', 'last_purchase'],
        report.rows.map((row) => [
          row.name,
          row.phone ?? '',
          row.email ?? '',
          row.spend,
          row.profit,
          row.transactions,
          row.averageSale,
          row.lastPurchaseAt ?? '',
        ]),
      );
      return {
        filename: `customer-report-${filenameDate}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: csv,
      };
    }
    if (query.report === 'suppliers') {
      const report = await this.suppliers(auth, query);
      const csv = toCsv(
        ['supplier', 'phone', 'email', 'purchases', 'spend', 'tax', 'returns', 'net_spend', 'last_purchase'],
        report.rows.map((row) => [
          row.name,
          row.phone ?? '',
          row.email ?? '',
          row.purchases,
          row.spend,
          row.tax,
          row.returns,
          row.netSpend,
          row.lastPurchaseAt ?? '',
        ]),
      );
      return {
        filename: `supplier-report-${filenameDate}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: csv,
      };
    }
    const report = await this.tax(auth, query);
    const csv = toCsv(
      ['tax_rate', 'gross_sales', 'net_sales', 'tax'],
      report.rows.map((row) => [row.taxRate, row.grossSales, row.netSales, row.tax]),
    );
    return {
      filename: `tax-report-${filenameDate}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: csv,
    };
  }

  private async productNames(productIds: string[]) {
    if (productIds.length === 0) return new Map<string, { name: string }>();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  private async productProfit(businessId: string, ids: string[], range: DateRange) {
    const rows = await this.prisma.saleItem.groupBy({
      by: ['productId', 'productName'],
      where: { sale: this.saleWhere(businessId, ids, range) },
      _sum: { quantity: true, lineTotal: true, taxAmount: true, totalCost: true },
    });
    return new Map(
      rows.map((row) => [
        row.productId,
        {
          name: row.productName,
          profit: dec(row._sum.lineTotal ?? 0)
            .minus(dec(row._sum.taxAmount ?? 0))
            .minus(dec(row._sum.totalCost ?? 0)),
        },
      ]),
    );
  }
}

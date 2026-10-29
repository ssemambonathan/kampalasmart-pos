import { Injectable } from '@nestjs/common';
import { dec, money, type AssistantAnswer } from '@kampalasmart/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  businessDayBounds,
  dayKey,
  parseDateRange,
  timezoneOffsetMinutes,
} from '../../common/date-range';
import { InventoryService } from '../inventory/inventory.service';
import { ReportsService } from '../reports/reports.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { AskAssistantDto } from './assistant.dto';

interface Period {
  from: string;
  to: string;
  label: string;
}

type Intent =
  | 'LOW_STOCK'
  | 'PROFIT'
  | 'TOP_PRODUCTS'
  | 'CASHIER'
  | 'REFUNDS'
  | 'DISCOUNTS'
  | 'SUPPLIERS'
  | 'TAX'
  | 'BRANCHES'
  | 'CUSTOMERS'
  | 'SALES';

const COMMERCE_TERMS =
  /(sale|revenue|profit|margin|stock|inventory|product|refund|discount|cashier|staff|supplier|purchase|tax|vat|customer|branch|location|order|sell|cost|money|shop|business|performance|doing)/;
const DAY_MS = 86_400_000;

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
  ) {}

  capabilities() {
    return {
      engine: 'RULES_ENGINE',
      externalProvider: false,
      description:
        'Answers are computed directly from this business’s recorded sales, purchases, stock movements and customer data. No external AI provider is called, and the assistant does not invent metrics.',
      examples: [
        'How much did we sell today?',
        'Why did profit change this month?',
        'What are my top products this week?',
        'Which products should I reorder?',
        'Who is my best cashier this month?',
        'How much did we refund last month?',
        'Which discounts did we give this week?',
        'How much tax is due this month?',
      ],
      limitations: [
        'It understands a fixed set of business questions; anything else returns this capability list instead of a guess.',
        'It reports only what is recorded. If stock was never received or a sale was never entered, it cannot see it.',
        'Tax figures are bookkeeping aids, not a filed return.',
      ],
    };
  }

  async ask(auth: AuthUser, dto: AskAssistantDto): Promise<AssistantAnswer> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { timezone: true },
    });
    const timezone = business.timezone;
    const question = dto.question.trim();
    const normalized = question.toLowerCase();
    if (!COMMERCE_TERMS.test(normalized)) {
      const capabilities = this.capabilities();
      return {
        question,
        answer:
          'I can answer questions about sales, profit, stock, products, refunds, discounts, cashiers, suppliers, tax, customers and branches using the records in KampalaSmart. Try one of the suggested questions.',
        metrics: { engine: 'RULES_ENGINE', recordsUsed: 0 },
        suggestions: capabilities.examples.slice(0, 4),
        generatedBy: 'RULES_ENGINE',
      };
    }

    const period = this.resolvePeriod(normalized, timezone);
    const intent = this.detectIntent(normalized);
    const locationId = dto.locationId;

    switch (intent) {
      case 'LOW_STOCK':
        return this.lowStockAnswer(auth, question, locationId);
      case 'PROFIT':
        return this.profitAnswer(auth, question, period, locationId);
      case 'TOP_PRODUCTS':
        return this.topProductsAnswer(auth, question, period, locationId);
      case 'CASHIER':
        return this.cashierAnswer(auth, question, period, locationId);
      case 'REFUNDS':
        return this.refundAnswer(auth, question, period, locationId, timezone);
      case 'DISCOUNTS':
        return this.discountAnswer(auth, question, period, locationId);
      case 'SUPPLIERS':
        return this.supplierAnswer(auth, question, period, locationId);
      case 'TAX':
        return this.taxAnswer(auth, question, period, locationId);
      case 'BRANCHES':
        return this.branchAnswer(auth, question, period, locationId);
      case 'CUSTOMERS':
        return this.customerAnswer(auth, question, period, locationId);
      default:
        return this.salesAnswer(auth, question, period, locationId);
    }
  }

  private detectIntent(question: string): Intent {
    if (/(reorder|low stock|low on stock|out of stock|stock level|stock run|inventory|restock|expiry|\bstock\b)/.test(question)) {
      return 'LOW_STOCK';
    }
    if (/(profit|margin|why.*(change|drop|fall|rise)|explain)/.test(question)) return 'PROFIT';
    if (/(top|best|worst|popular).*(product|item|seller)|product.*(best|top|sell)/.test(question)) {
      return 'TOP_PRODUCTS';
    }
    if (/(cashier|staff|employee|attendant|salesperson)/.test(question)) return 'CASHIER';
    if (/(refund|return|money back)/.test(question)) return 'REFUNDS';
    if (/(discount|markdown|price cut)/.test(question)) return 'DISCOUNTS';
    if (/(supplier|purchase|restock cost|procurement)/.test(question)) return 'SUPPLIERS';
    if (/(tax|vat|revenue authority|ura)/.test(question)) return 'TAX';
    if (/(branch|location|shop|store).*(performance|sell|do)|which.*(branch|shop|store)/.test(question)) {
      return 'BRANCHES';
    }
    if (/(customer|client|buyer|repeat|loyal)/.test(question)) return 'CUSTOMERS';
    return 'SALES';
  }

  private resolvePeriod(question: string, timezone: string): Period {
    const now = new Date();
    const today = businessDayBounds(now, timezone);
    const offset = timezoneOffsetMinutes(timezone);
    const todayKey = dayKey(today.start, timezone);
    const yesterdayStart = new Date(today.start.getTime() - DAY_MS);
    const yesterdayKey = dayKey(yesterdayStart, timezone);

    if (/(yesterday)/.test(question)) {
      return { from: yesterdayKey, to: yesterdayKey, label: 'yesterday' };
    }
    if (/(today|so far|right now)/.test(question)) {
      return { from: todayKey, to: todayKey, label: 'today' };
    }
    const lastDays = /last\s+(\d{1,3})\s+days?/.exec(question);
    if (lastDays) {
      const days = Math.min(365, Math.max(1, Number(lastDays[1])));
      const from = dayKey(new Date(today.start.getTime() - (days - 1) * DAY_MS), timezone);
      return { from, to: todayKey, label: `the last ${days} days` };
    }
    const shifted = new Date(now.getTime() + offset * 60_000);
    const mondayOffset = (shifted.getUTCDay() + 6) % 7;
    const weekStart = new Date(today.start.getTime() - mondayOffset * DAY_MS);
    if (/(last|previous)\s+week/.test(question)) {
      const from = dayKey(new Date(weekStart.getTime() - 7 * DAY_MS), timezone);
      const to = dayKey(new Date(weekStart.getTime() - DAY_MS), timezone);
      return { from, to, label: 'last week' };
    }
    if (/(this\s+week|week|weekly)/.test(question)) {
      return { from: dayKey(weekStart, timezone), to: todayKey, label: 'this week' };
    }
    const monthStart = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - offset * 60_000,
    );
    if (/(last|previous)\s+month/.test(question)) {
      const previousMonthStart = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1) - offset * 60_000,
      );
      return {
        from: dayKey(previousMonthStart, timezone),
        to: dayKey(new Date(monthStart.getTime() - 1), timezone),
        label: 'last month',
      };
    }
    if (/(this\s+month|month|monthly)/.test(question)) {
      return { from: dayKey(monthStart, timezone), to: todayKey, label: 'this month' };
    }
    const defaultFrom = dayKey(new Date(today.start.getTime() - 29 * DAY_MS), timezone);
    return { from: defaultFrom, to: todayKey, label: 'the last 30 days' };
  }

  private async salesAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const margin =
      Number(summary.totals.netSales) > 0
        ? (Number(summary.totals.grossProfit) / Number(summary.totals.netSales)) * 100
        : 0;
    const top = summary.topProducts[0];
    const answer =
      `For ${period.label} (${period.from} to ${period.to}) you recorded ${summary.totals.transactions} sales ` +
      `with net sales of ${money(summary.totals.netSales)} after discounts and refunds. ` +
      `Gross profit was ${money(summary.totals.grossProfit)} (${margin.toFixed(1)}% margin), ` +
      `and the average sale was ${money(summary.totals.averageSale)}. ` +
      (top
        ? `Your top product was ${top.name}, selling ${top.quantity} for ${money(top.revenue)} in revenue.`
        : 'No products were sold in this period.');
    return {
      question,
      answer,
      metrics: {
        netSales: summary.totals.netSales,
        grossProfit: summary.totals.grossProfit,
        marginPercent: Number(margin.toFixed(1)),
        transactions: summary.totals.transactions,
        averageSale: summary.totals.averageSale,
        refunds: summary.totals.refunds,
        discounts: summary.totals.discounts,
        itemsSold: summary.totals.itemsSold,
      },
      suggestions: [
        'Why did profit change this month?',
        'What are my top products this week?',
        'Which products should I reorder?',
        'Which discounts did we give this week?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async profitAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const explanation = await this.reports.profitExplanation(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const biggest = explanation.reasons
      .filter((reason) => reason.direction === 'DOWN')
      .sort((a, b) => Number(a.impact) - Number(b.impact))[0];
    const answer =
      `Profit for ${period.label} (${explanation.currentPeriod.from} to ${explanation.currentPeriod.to}) was ` +
      `${money(explanation.currentPeriod.profit)} on ${money(explanation.currentPeriod.revenue)} of net revenue ` +
      `(${explanation.currentPeriod.marginPercent.toFixed(1)}% margin). ` +
      `That is ${money(explanation.profitChange)} versus the previous comparable period` +
      (explanation.profitChangePercent === null
        ? '.'
        : ` (${explanation.profitChangePercent > 0 ? '+' : ''}${explanation.profitChangePercent.toFixed(1)}%). `) +
      (biggest
        ? `The largest drag was ${biggest.title.toLowerCase()}, which moved profit by ${money(biggest.impact)}. `
        : 'No component reduced profit. ') +
      (explanation.largestContributor
        ? `${explanation.largestContributor.name} was the product with the biggest profit movement (${money(explanation.largestContributor.profitChange)}). `
        : '') +
      explanation.suggestedAction;
    return {
      question,
      answer,
      metrics: {
        revenue: explanation.currentPeriod.revenue,
        profit: explanation.currentPeriod.profit,
        marginPercent: explanation.currentPeriod.marginPercent,
        previousProfit: explanation.previousPeriod.profit,
        profitChange: explanation.profitChange,
        profitChangePercent: explanation.profitChangePercent ?? 0,
      },
      suggestions: [
        'Show my sales summary for this period.',
        'Which products drove the profit change?',
        'Which discounts did we give this week?',
        'Which products should I reorder?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async topProductsAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    if (summary.topProducts.length === 0) {
      return {
        question,
        answer: `No products were sold in ${period.label} (${period.from} to ${period.to}).`,
        metrics: { productsSold: 0 },
        suggestions: ['How much did we sell this month?', 'Which products should I reorder?'],
        generatedBy: 'RULES_ENGINE',
      };
    }
    const top = summary.topProducts.slice(0, 5);
    const answer =
      `Your top products for ${period.label} by revenue were: ` +
      top.map((product, index) =>
        `${index + 1}. ${product.name} — ${product.quantity} sold, ${money(product.revenue)} revenue, ${money(product.profit)} profit`,
      ).join('; ') + '.';
    return {
      question,
      answer,
      metrics: {
        topProduct: top[0]!.name,
        topProductRevenue: top[0]!.revenue,
        topProductProfit: top[0]!.profit,
        productsListed: top.length,
      },
      suggestions: [
        'Why did profit change this month?',
        'Which products should I reorder?',
        'How much did we sell today?',
        'Who is my best cashier this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async cashierAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    if (summary.byCashier.length === 0) {
      return {
        question,
        answer: `No sales were recorded by any cashier in ${period.label}.`,
        metrics: { cashiers: 0 },
        suggestions: ['How much did we sell this month?'],
        generatedBy: 'RULES_ENGINE',
      };
    }
    const best = summary.byCashier[0]!;
    const answer =
      `In ${period.label}, ${best.name} recorded the most sales: ${summary.byCashier.length} cashier(s) served ` +
      `${summary.totals.transactions} transactions. ${best.name} handled ${best.transactions} sales worth ` +
      `${money(best.sales)}, with ${money(best.profit)} gross profit. ` +
      `Across all cashiers the average sale was ${money(summary.totals.averageSale)}.`;
    return {
      question,
      answer,
      metrics: {
        topCashier: best.name,
        topCashierSales: best.sales,
        topCashierTransactions: best.transactions,
        cashiers: summary.byCashier.length,
        averageSale: summary.totals.averageSale,
      },
      suggestions: [
        'How much did we sell this week?',
        'Which discounts did we give this week?',
        'What are my top products this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async refundAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId: string | undefined,
    timezone: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const range = parseDateRange(period.from, period.to, { timezone });
    const refundFilter = {
      businessId: auth.businessId,
      status: 'COMPLETED' as const,
      ...(locationId ? { locationId } : {}),
      OR: [
        { completedAt: { gte: range.from, lte: range.to } },
        { completedAt: null, createdAt: { gte: range.from, lte: range.to } },
      ],
    };
    const [count, refundAggregate] = await Promise.all([
      this.prisma.refund.count({ where: refundFilter }),
      this.prisma.refund.aggregate({
        where: refundFilter,
        _sum: { taxTotal: true, costTotal: true },
      }),
    ]);
    const refundTax = dec(refundAggregate._sum.taxTotal ?? 0);
    const refundCost = dec(refundAggregate._sum.costTotal ?? 0);
    const share =
      Number(summary.totals.grossSales) > 0
        ? (Number(summary.totals.refunds) / Number(summary.totals.grossSales)) * 100
        : 0;
    return {
      question,
      answer:
        `In ${period.label} you completed ${count} refund${count === 1 ? '' : 's'} worth ` +
        `${money(summary.totals.refunds)}, which is ${share.toFixed(1)}% of gross sales. ` +
        `Of that, ${money(refundTax)} was tax and the recorded cost of returned goods was ${money(refundCost)}.`,
      metrics: {
        refunds: summary.totals.refunds,
        refundCount: count,
        refundTax: money(refundTax),
        refundCost: money(refundCost),
        refundSharePercent: Number(share.toFixed(1)),
        grossSales: summary.totals.grossSales,
      },
      suggestions: [
        'Why did profit change this month?',
        'What are my top products this week?',
        'Show my sales summary.',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async discountAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const share =
      Number(summary.totals.grossSales) > 0
        ? (Number(summary.totals.discounts) / Number(summary.totals.grossSales)) * 100
        : 0;
    const largest = summary.discounts[0];
    return {
      question,
      answer:
        `Discounts in ${period.label} totalled ${money(summary.totals.discounts)}, ` +
        `${share.toFixed(1)}% of gross sales, across ${summary.discounts.length} sale${summary.discounts.length === 1 ? '' : 's'} shown. ` +
        (largest
          ? `The largest was ${money(largest.discount)} on sale ${largest.saleNumber}, handled by ${largest.cashierName}.`
          : 'No discounted sales were recorded in this period.'),
      metrics: {
        discounts: summary.totals.discounts,
        discountSharePercent: Number(share.toFixed(1)),
        discountedSales: summary.discounts.length,
        largestDiscount: largest?.discount ?? '0.00',
      },
      suggestions: [
        'Why did profit change this month?',
        'Who is my best cashier this month?',
        'Show my sales summary.',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async supplierAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const report = await this.reports.suppliers(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const top = report.rows[0];
    return {
      question,
      answer:
        `In ${period.label} you recorded ${report.totals.purchases} purchase${report.totals.purchases === 1 ? '' : 's'} ` +
        `worth ${money(report.totals.spend)} across ${report.totals.suppliers} supplier${report.totals.suppliers === 1 ? '' : 's'}, ` +
        `with ${money(report.totals.returns)} returned. ` +
        (top
          ? `${top.name} was the largest supplier at ${money(top.netSpend)} net of returns across ${top.purchases} purchase${top.purchases === 1 ? '' : 's'}.`
          : 'No purchases were recorded in this period.'),
      metrics: {
        purchases: report.totals.purchases,
        spend: report.totals.spend,
        returns: report.totals.returns,
        netSpend: report.totals.netSpend,
        suppliers: report.totals.suppliers,
      },
      suggestions: [
        'Which products should I reorder?',
        'How much did we sell this month?',
        'How much tax is due this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async taxAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const report = await this.reports.tax(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    return {
      question,
      answer:
        `For ${period.label} the recorded output tax is ${money(report.totals.outputTax)}. ` +
        `Refunds reduced that by ${money(report.totals.refundTax)}, and purchases recorded ${money(report.totals.inputTax)} of input tax. ` +
        `The net tax due from these records is ${money(report.totals.netTaxDue)}. ${report.disclaimer}`,
      metrics: {
        outputTax: report.totals.outputTax,
        refundTax: report.totals.refundTax,
        inputTax: report.totals.inputTax,
        netTaxDue: report.totals.netTaxDue,
      },
      suggestions: [
        'Which suppliers did we buy from this month?',
        'Show my sales summary.',
        'What are my top products this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async branchAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const summary = await this.reports.salesSummary(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const best = summary.byLocation[0];
    const answer = summary.byLocation.length
      ? `In ${period.label}, ${best!.name} led with ${money(best!.sales)} across ${best!.transactions} sales and ${money(best!.profit)} gross profit. ` +
        summary.byLocation
          .slice(0, 5)
          .map((branch) => `${branch.name}: ${money(branch.sales)} (${branch.transactions} sales)`)
          .join('; ') + '.'
      : `No branch recorded sales in ${period.label}.`;
    return {
      question,
      answer,
      metrics: {
        branches: summary.byLocation.length,
        topBranch: best?.name ?? 'None',
        topBranchSales: best?.sales ?? '0.00',
        transactions: summary.totals.transactions,
      },
      suggestions: [
        'Who is my best cashier this month?',
        'Why did profit change this month?',
        'What are my top products this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async customerAnswer(
    auth: AuthUser,
    question: string,
    period: Period,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const report = await this.reports.customers(auth, {
      from: period.from,
      to: period.to,
      locationId,
    });
    const top = report.rows[0];
    return {
      question,
      answer:
        `In ${period.label} identified customers spent ${money(report.totals.identifiedRevenue)} across ${report.totals.transactions} transactions; ` +
        `anonymous sales added ${money(report.totals.anonymousRevenue)}. ` +
        `${report.totals.newCustomers} new customer${report.totals.newCustomers === 1 ? ' was' : 's were'} added and ` +
        `${report.totals.repeatCustomers} customer${report.totals.repeatCustomers === 1 ? '' : 's'} bought more than once. ` +
        (top
          ? `${top.name} was the highest-spending customer at ${money(top.spend)} over ${top.transactions} purchase${top.transactions === 1 ? '' : 's'}.`
          : 'No identified customer purchases were recorded.'),
      metrics: {
        identifiedRevenue: report.totals.identifiedRevenue,
        anonymousRevenue: report.totals.anonymousRevenue,
        newCustomers: report.totals.newCustomers,
        repeatCustomers: report.totals.repeatCustomers,
        totalCustomers: report.totals.totalCustomers,
      },
      suggestions: [
        'How much did we sell this month?',
        'What are my top products this week?',
        'Who is my best cashier this month?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }

  private async lowStockAnswer(
    auth: AuthUser,
    question: string,
    locationId?: string,
  ): Promise<AssistantAnswer> {
    const items = await this.inventory.lowStock(auth, { locationId, limit: 200 });
    if (items.length === 0) {
      return {
        question,
        answer:
          'No product is at or below its reorder level in the branches you can see. Stock cover is healthy against recorded sales over the last 30 days.',
        metrics: { lowStockItems: 0 },
        suggestions: ['How much did we sell this month?', 'What are my top products this week?'],
        generatedBy: 'RULES_ENGINE',
      };
    }
    const outOfStock = items.filter((item) => item.status === 'OUT_OF_STOCK').length;
    const critical = items.filter((item) => item.status === 'CRITICAL').length;
    const top = items.slice(0, 5);
    const answer =
      `${items.length} product${items.length === 1 ? '' : 's'} need attention: ${outOfStock} out of stock and ` +
      `${critical} at or below safety stock. ` +
      top
        .map(
          (item) =>
            `${item.productName} at ${item.locationName} has ${item.quantity} left (reorder level ${item.reorderLevel}); ` +
            `suggested order ${item.recommendedOrderQuantity}${item.supplierName ? ` from ${item.supplierName}` : ''}`,
        )
        .join('. ') +
      '. Order quantities use each product’s lead time, safety stock, sales pace over the last 30 days and stock already on order.';
    return {
      question,
      answer,
      metrics: {
        lowStockItems: items.length,
        outOfStock,
        critical,
        productsToOrder: items.filter((item) => Number(item.recommendedOrderQuantity) > 0).length,
      },
      suggestions: [
        'Which supplier should I buy from?',
        'What are my top products this week?',
        'How much stock do we have?',
      ],
      generatedBy: 'RULES_ENGINE',
    };
  }
}

import type {
  DailyProductSalesRow,
  DailySalesRow,
  ProductAnalysisSummary,
  ProductSummary,
  SalesSummary,
  WeekdaySummary,
} from '../types'
import { getDay, parseISO } from 'date-fns'

export function filterByDate<T extends { report_date: string }>(
  rows: T[],
  startDate: string,
  endDate: string,
): T[] {
  return rows.filter(
    (row) =>
      (!startDate || row.report_date >= startDate) &&
      (!endDate || row.report_date <= endDate),
  )
}

export function summarizeSales(rows: DailySalesRow[]): SalesSummary {
  const totals = rows.reduce(
    (summary, row) => ({
      reportDays: summary.reportDays + 1,
      soldQuantity: summary.soldQuantity + Number(row.sold_quantity),
      grossSalesYen: summary.grossSalesYen + Number(row.gross_sales_yen),
      discountAmountYen:
        summary.discountAmountYen + Number(row.discount_amount_yen),
      netSalesYen: summary.netSalesYen + Number(row.net_sales_yen),
      averageUnitRevenueYen: 0,
    }),
    {
      reportDays: 0,
      soldQuantity: 0,
      grossSalesYen: 0,
      discountAmountYen: 0,
      netSalesYen: 0,
      averageUnitRevenueYen: 0,
    },
  )

  totals.averageUnitRevenueYen = totals.soldQuantity
    ? Math.round(totals.netSalesYen / totals.soldQuantity)
    : 0
  return totals
}

export function aggregateProducts(
  rows: DailyProductSalesRow[],
): ProductSummary[] {
  const products = new Map<string, ProductSummary>()

  for (const row of rows) {
    const current = products.get(row.product_id) ?? {
      productId: row.product_id,
      canonicalName: row.canonical_name,
      soldQuantity: 0,
      grossSalesYen: 0,
      discountAmountYen: 0,
      netSalesYen: 0,
    }
    current.soldQuantity += Number(row.sold_quantity)
    current.grossSalesYen += Number(row.gross_sales_yen)
    current.discountAmountYen += Number(row.discount_amount_yen)
    current.netSalesYen += Number(row.net_sales_yen)
    products.set(row.product_id, current)
  }

  return [...products.values()].sort(
    (left, right) => right.netSalesYen - left.netSalesYen,
  )
}

export function summarizeProduct(
  rows: DailyProductSalesRow[],
): ProductAnalysisSummary {
  const totals = rows.reduce(
    (summary, row) => ({
      ...summary,
      sellingDays: summary.sellingDays + 1,
      soldQuantity: summary.soldQuantity + Number(row.sold_quantity),
      grossSalesYen: summary.grossSalesYen + Number(row.gross_sales_yen),
      discountAmountYen:
        summary.discountAmountYen + Number(row.discount_amount_yen),
      netSalesYen: summary.netSalesYen + Number(row.net_sales_yen),
    }),
    {
      sellingDays: 0,
      soldQuantity: 0,
      grossSalesYen: 0,
      discountAmountYen: 0,
      netSalesYen: 0,
      averageUnitRevenueYen: 0,
      averageSoldPerSellingDay: 0,
      discountRate: 0,
    },
  )

  totals.averageUnitRevenueYen = totals.soldQuantity
    ? Math.round(totals.netSalesYen / totals.soldQuantity)
    : 0
  totals.averageSoldPerSellingDay = totals.sellingDays
    ? totals.soldQuantity / totals.sellingDays
    : 0
  totals.discountRate = totals.grossSalesYen
    ? totals.discountAmountYen / totals.grossSalesYen
    : 0
  return totals
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function aggregateWeekdays(
  rows: DailyProductSalesRow[],
): WeekdaySummary[] {
  const weekdays = new Map<number, WeekdaySummary>()

  for (const row of rows) {
    const weekdayIndex = getDay(parseISO(row.report_date))
    const current = weekdays.get(weekdayIndex) ?? {
      weekdayIndex,
      weekdayLabel: `${WEEKDAYS[weekdayIndex]}曜`,
      sellingDays: 0,
      soldQuantity: 0,
      netSalesYen: 0,
      averageSoldQuantity: 0,
      averageNetSalesYen: 0,
    }
    current.sellingDays += 1
    current.soldQuantity += Number(row.sold_quantity)
    current.netSalesYen += Number(row.net_sales_yen)
    weekdays.set(weekdayIndex, current)
  }

  return WEEKDAY_ORDER.flatMap((weekdayIndex) => {
    const summary = weekdays.get(weekdayIndex)
    if (!summary) return []
    summary.averageSoldQuantity = summary.soldQuantity / summary.sellingDays
    summary.averageNetSalesYen = summary.netSalesYen / summary.sellingDays
    return [summary]
  })
}

export function calculateChangeRate(current: number, previous: number): number | null {
  return previous ? (current - previous) / previous : null
}

import type {
  DailyProductSalesRow,
  DailyProductShipmentBalanceRow,
  DailyProductWeightedPriceRow,
  DailySalesRow,
  ProductDailySeriesRow,
  ProductAnalysisSummary,
  ProductSummary,
  SalesSummary,
  ShipmentBalanceSeriesRow,
  WeightStandardDetail,
  WeightedKgPriceSummary,
  WeekdaySummary,
} from '../types'
import { getDay, parseISO } from 'date-fns'

function countUniqueReportDates(rows: Array<{ report_date: string }>): number {
  return new Set(rows.map((row) => row.report_date)).size
}

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
      ...summary,
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

  totals.reportDays = countUniqueReportDates(rows)
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

  totals.sellingDays = countUniqueReportDates(rows)
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
  const weekdays = new Map<number, WeekdaySummary & { reportDates: Set<string> }>()

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
      reportDates: new Set<string>(),
    }
    current.reportDates.add(row.report_date)
    current.sellingDays = current.reportDates.size
    current.soldQuantity += Number(row.sold_quantity)
    current.netSalesYen += Number(row.net_sales_yen)
    weekdays.set(weekdayIndex, current)
  }

  return WEEKDAY_ORDER.flatMap((weekdayIndex) => {
    const summary = weekdays.get(weekdayIndex)
    if (!summary) return []
    summary.averageSoldQuantity = summary.soldQuantity / summary.sellingDays
    summary.averageNetSalesYen = summary.netSalesYen / summary.sellingDays
    const { reportDates: _reportDates, ...result } = summary
    void _reportDates
    return [result]
  })
}

export function calculateChangeRate(current: number, previous: number): number | null {
  return previous ? (current - previous) / previous : null
}

export function buildProductDailySeries(
  rows: DailyProductSalesRow[],
  reportDates: string[],
): ProductDailySeriesRow[] {
  const rowsByDate = new Map<string, Omit<ProductDailySeriesRow, 'report_date' | 'average_unit_revenue_yen'>>()

  for (const row of rows) {
    const current = rowsByDate.get(row.report_date) ?? {
      sold_quantity: 0,
      gross_sales_yen: 0,
      discount_amount_yen: 0,
      net_sales_yen: 0,
    }
    current.sold_quantity += Number(row.sold_quantity)
    current.gross_sales_yen += Number(row.gross_sales_yen)
    current.discount_amount_yen += Number(row.discount_amount_yen)
    current.net_sales_yen += Number(row.net_sales_yen)
    rowsByDate.set(row.report_date, current)
  }

  return [...new Set(reportDates)].sort().map((reportDate) => {
    const row = rowsByDate.get(reportDate) ?? {
      sold_quantity: 0,
      gross_sales_yen: 0,
      discount_amount_yen: 0,
      net_sales_yen: 0,
    }
    return {
      report_date: reportDate,
      ...row,
      average_unit_revenue_yen: row.sold_quantity
        ? Math.round(row.net_sales_yen / row.sold_quantity)
        : null,
    }
  })
}

export function summarizeWeightedKgPrices(
  rows: DailyProductWeightedPriceRow[],
): WeightedKgPriceSummary {
  const summary = rows.reduce(
    (current, row) => ({
      soldWeightKg: current.soldWeightKg + Number(row.sold_weight_kg || 0),
      convertedNetSalesYen:
        current.convertedNetSalesYen + Number(row.converted_net_sales_yen || 0),
      unconvertedPackageQuantity:
        current.unconvertedPackageQuantity + Number(row.unconverted_package_quantity || 0),
      usesStandardWeight: current.usesStandardWeight || Boolean(row.uses_standard_weight),
    }),
    {
      soldWeightKg: 0,
      convertedNetSalesYen: 0,
      unconvertedPackageQuantity: 0,
      usesStandardWeight: false,
    },
  )

  const weightStandardDetails = Array.from(rows.reduce((details, row) => {
    for (const detail of row.weight_standard_details ?? []) {
      const normalizedDetail: WeightStandardDetail = {
        ...detail,
        grams_per_unit: Number(detail.grams_per_unit),
      }
      const key = [
        normalizedDetail.grams_per_unit,
        normalizedDetail.unit_code,
        normalizedDetail.confidence,
        normalizedDetail.source,
        normalizedDetail.notes ?? '',
      ].join('\u0000')
      details.set(key, normalizedDetail)
    }
    return details
  }, new Map<string, WeightStandardDetail>()).values()).sort((left, right) => (
    left.grams_per_unit - right.grams_per_unit
      || left.unit_code.localeCompare(right.unit_code)
      || left.source.localeCompare(right.source)
  ))

  return {
    ...summary,
    averageKgUnitRevenueYen: summary.soldWeightKg
      ? Math.round(summary.convertedNetSalesYen / summary.soldWeightKg)
      : null,
    weightStandardDetails,
  }
}

export function buildShipmentBalanceSeries(
  rows: DailyProductShipmentBalanceRow[],
): ShipmentBalanceSeriesRow[] {
  return [...rows]
    .sort((left, right) => left.shipment_date.localeCompare(right.shipment_date))
    .map((row) => {
      const shipmentQuantity = Number(row.shipment_package_quantity)
      const remainingQuantity = Number(row.remaining_package_quantity)
      return {
        shipment_date: row.shipment_date,
        shipment_package_quantity: shipmentQuantity,
        allocated_package_quantity: Number(row.allocated_package_quantity),
        remaining_package_quantity: remainingQuantity,
        remaining_rate: shipmentQuantity ? remainingQuantity / shipmentQuantity : 0,
        sales_data_through_date: row.sales_data_through_date,
      }
    })
}

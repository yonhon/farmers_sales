import type {
  DailyProductSalesRow,
  DailySalesRow,
  ProductSummary,
  SalesSummary,
} from '../types'

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
